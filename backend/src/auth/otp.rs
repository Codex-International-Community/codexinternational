//! Brevo SMTP OTP delivery & verification with 24-hour exponential backoff (`INV-16`).
//!
//! - OTP codes are 6 digits generated with `OsRng`, never stored in plaintext in Valkey:
//!   `auth:otp:{purpose}:{email_sha256}` holds SHA-256(`purpose:email:code`) + `attempts`
//!   with a 5-minute (`300s`) TTL and max 5 wrong guesses before invalidation.
//! - Resending OTP enforces exponential backoff (`60s -> 120s -> 240s -> ...`, capped
//!   at `3600s`) stored in `rl:backoff:otp_send:{email_sha256}` with a **24-hour (`86400s`)**
//!   reset window.

use std::sync::Arc;

use async_trait::async_trait;
use axum::{Json, extract::State};
use chrono::{Duration as ChronoDuration, Utc};
use fred::interfaces::{HashesInterface, KeysInterface, LuaInterface};
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor, message::header::ContentType,
    transport::smtp::authentication::Credentials,
};
use rand::{Rng, rngs::OsRng};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    auth::{
        handlers::{AuthResponse, ensure_not_suspended, normalize_platform, validate_email},
        jwt::{encode_access_token, generate_refresh_token, hash_token},
        repo::{create_device_session, find_user_by_identifier},
        turnstile::verify_turnstile,
    },
    config::AppConfig,
    error::AppError,
    state::AppState,
};

const OTP_TTL_SECS: i64 = 300;
const OTP_MAX_ATTEMPTS: i64 = 5;
const BACKOFF_RESET_SECS: u64 = 86_400; // 24 hours (`INV-16`)
const OTP_BASE_COOLDOWN_SECS: u64 = 60;
const OTP_MAX_COOLDOWN_SECS: u64 = 3_600;

/// Lua script atomically checking active OTP cooldown and incrementing strikes
/// with a 24-hour (`86400s`) TTL reset window.
///
/// KEYS[1] = `rl:backoff:otp_send:{email_sha256}`
/// ARGV[1] = current unix timestamp (secs)
/// ARGV[2] = base cooldown (60)
/// ARGV[3] = max cooldown (3600)
/// ARGV[4] = reset window TTL (86400)
///
/// Returns `[allowed (1|0), retry_after_secs, strikes]`.
const OTP_BACKOFF_LUA: &str = r#"
local key = KEYS[1]
local now = tonumber(ARGV[1])
local base = tonumber(ARGV[2])
local max_cd = tonumber(ARGV[3])
local reset_ttl = tonumber(ARGV[4])

local blocked_until = tonumber(redis.call('HGET', key, 'blocked_until') or '0')
local strikes = tonumber(redis.call('HGET', key, 'strikes') or '0')

if blocked_until > now then
    return {0, blocked_until - now, strikes}
end

strikes = strikes + 1
local cooldown = 0
if strikes > 1 then
    cooldown = math.min(base * (2 ^ (strikes - 2)), max_cd)
else
    cooldown = base
end

redis.call('HSET', key, 'strikes', tostring(strikes), 'blocked_until', tostring(now + cooldown))
redis.call('EXPIRE', key, reset_ttl)
return {1, cooldown, strikes}
"#;

/// Computes exponential backoff duration in seconds for a given strike count.
/// Strike 1 = 60s, Strike 2 = 120s, Strike 3 = 240s, ..., capped at 3600s.
pub fn compute_otp_cooldown_secs(strikes: u32) -> u64 {
    if strikes == 0 {
        return 0;
    }
    let exp = strikes.saturating_sub(1).min(16);
    OTP_BASE_COOLDOWN_SECS
        .saturating_mul(1u64 << exp)
        .min(OTP_MAX_COOLDOWN_SECS)
}

/// Outbound email abstraction so tests can assert OTP delivery without real SMTP.
#[async_trait]
pub trait EmailSender: Send + Sync {
    async fn send_otp(&self, to_email: &str, code: &str, purpose: &str) -> Result<(), AppError>;
}

/// Production Brevo SMTP Relay sender via `lettre` (`STARTTLS`).
pub struct BrevoEmailSender {
    host: String,
    port: u16,
    username: String,
    password: String,
    from: String,
    reply_to: String,
}

impl BrevoEmailSender {
    pub fn from_config(cfg: &AppConfig) -> Self {
        Self {
            host: cfg.smtp_host.clone(),
            port: cfg.smtp_port,
            username: cfg.smtp_user.expose().to_string(),
            password: cfg.smtp_pass.expose().to_string(),
            from: cfg.smtp_from.clone(),
            reply_to: cfg.smtp_reply_to.clone(),
        }
    }
}

#[async_trait]
impl EmailSender for BrevoEmailSender {
    async fn send_otp(&self, to_email: &str, code: &str, purpose: &str) -> Result<(), AppError> {
        if self.username.trim().is_empty() || self.password.trim().is_empty() {
            return Err(AppError::ServiceUnavailable {
                retry_after_secs: 60,
                message: "SMTP credentials are not configured".to_string(),
            });
        }

        let subject = match purpose {
            "login" => "Your Codexter login code",
            "verify_email" => "Verify your Codexter email address",
            _ => "Your Codexter verification code",
        };

        let body = format!(
            "Your Codexter verification code is: {code}\n\nThis code expires in 5 minutes. If you did not request this, you can safely ignore this email."
        );

        let email =
            Message::builder()
                .from(
                    self.from.parse().map_err(|e| {
                        AppError::Internal(anyhow::anyhow!("invalid SMTP_FROM: {e}"))
                    })?,
                )
                .reply_to(self.reply_to.parse().map_err(|e| {
                    AppError::Internal(anyhow::anyhow!("invalid SMTP_REPLY_TO: {e}"))
                })?)
                .to(to_email
                    .parse()
                    .map_err(|_| AppError::BadRequest("invalid recipient email".to_string()))?)
                .subject(subject)
                .header(ContentType::TEXT_PLAIN)
                .body(body)
                .map_err(|e| AppError::Internal(anyhow::anyhow!("failed to build email: {e}")))?;

        let mailer = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&self.host)
            .map_err(|e| AppError::Internal(anyhow::anyhow!("SMTP relay init failed: {e}")))?
            .port(self.port)
            .credentials(Credentials::new(
                self.username.clone(),
                self.password.clone(),
            ))
            .build();

        mailer
            .send(email)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("Brevo SMTP send failed: {e}")))?;

        Ok(())
    }
}

#[derive(Debug, Deserialize)]
pub struct SendOtpRequest {
    pub email: String,
    pub purpose: Option<String>,
    pub turnstile_token: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SendOtpResponse {
    pub sent: bool,
    pub expires_in_secs: i64,
    pub next_retry_after_secs: i64,
}

#[derive(Debug, Deserialize)]
pub struct VerifyOtpRequest {
    pub email: String,
    pub code: String,
    pub purpose: Option<String>,
    pub device_name: Option<String>,
    pub platform: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum VerifyOtpResponse {
    Auth(Box<AuthResponse>),
    Verified { verified: bool },
}

/// Sends a 6-digit OTP via Brevo SMTP with Valkey exponential backoff (`INV-16`).
pub async fn send_otp(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SendOtpRequest>,
) -> Result<Json<SendOtpResponse>, AppError> {
    verify_turnstile(&state, req.turnstile_token.as_deref()).await?;
    let email = validate_email(&req.email)?;
    let purpose = normalize_purpose(req.purpose.as_deref())?;
    let email_hash = hash_token(&email);

    let backoff_key = format!("rl:backoff:otp_send:{email_hash}");
    let now = Utc::now().timestamp();

    let res: Vec<i64> = state
        .valkey
        .eval(
            OTP_BACKOFF_LUA,
            vec![backoff_key],
            vec![
                now.to_string(),
                OTP_BASE_COOLDOWN_SECS.to_string(),
                OTP_MAX_COOLDOWN_SECS.to_string(),
                BACKOFF_RESET_SECS.to_string(),
            ],
        )
        .await?;

    let allowed = res.first().copied().unwrap_or(0) == 1;
    let retry_after = res.get(1).copied().unwrap_or(60);

    if !allowed {
        return Err(AppError::TooManyRequests {
            retry_after_secs: retry_after.max(1) as u64,
            message: format!("please wait {retry_after}s before requesting another OTP"),
        });
    }

    let code_num: u32 = OsRng.gen_range(0..1_000_000);
    let code = format!("{code_num:06}");
    let otp_digest = hash_token(&format!("{purpose}:{email}:{code}"));

    let otp_key = format!("auth:otp:{purpose}:{email_hash}");
    state
        .valkey
        .hset::<(), _, _>(
            &otp_key,
            vec![("otp_hash", otp_digest.as_str()), ("attempts", "0")],
        )
        .await?;
    state
        .valkey
        .expire::<(), _>(&otp_key, OTP_TTL_SECS, None)
        .await?;

    state.email_sender.send_otp(&email, &code, purpose).await?;

    Ok(Json(SendOtpResponse {
        sent: true,
        expires_in_secs: OTP_TTL_SECS,
        next_retry_after_secs: retry_after,
    }))
}

const OTP_VERIFY_LUA: &str = r#"
local stored = redis.call('HGET', KEYS[1], 'otp_hash')
if not stored then
    return {0, 0}
end
local max_attempts = tonumber(ARGV[2])
local attempts = tonumber(redis.call('HGET', KEYS[1], 'attempts') or '0')
if attempts >= max_attempts then
    redis.call('DEL', KEYS[1])
    return {-1, attempts}
end
if stored == ARGV[1] then
    redis.call('DEL', KEYS[1])
    return {1, attempts}
end
local next_attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
if next_attempts >= max_attempts then
    redis.call('DEL', KEYS[1])
end
return {2, next_attempts}
"#;

/// Verifies a 6-digit OTP against its Valkey SHA-256 hash (max 5 attempts, `INV-16`).
pub async fn verify_otp(
    State(state): State<Arc<AppState>>,
    Json(req): Json<VerifyOtpRequest>,
) -> Result<Json<VerifyOtpResponse>, AppError> {
    let email = validate_email(&req.email)?;
    let purpose = normalize_purpose(req.purpose.as_deref())?;
    let code = req.code.trim();
    if code.len() != 6 || !code.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::BadRequest(
            "OTP code must be 6 digits".to_string(),
        ));
    }

    let email_hash = hash_token(&email);
    let otp_key = format!("auth:otp:{purpose}:{email_hash}");
    let candidate_digest = hash_token(&format!("{purpose}:{email}:{code}"));

    let res: Vec<i64> = state
        .valkey
        .eval(
            OTP_VERIFY_LUA,
            vec![otp_key],
            vec![candidate_digest, OTP_MAX_ATTEMPTS.to_string()],
        )
        .await?;

    match res.first().copied().unwrap_or(0) {
        1 => {}
        -1 => {
            return Err(AppError::Unauthorized(
                "maximum OTP attempts exceeded; please request a new code".to_string(),
            ));
        }
        _ => {
            return Err(AppError::Unauthorized("invalid or expired OTP".to_string()));
        }
    }

    if purpose == "verify_email" {
        let res = sqlx::query(
            "UPDATE users
             SET email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW()
             WHERE LOWER(email) = LOWER($1)",
        )
        .bind(&email)
        .execute(&state.pg)
        .await?;

        if res.rows_affected() == 0 {
            return Err(AppError::NotFound("user with email not found".to_string()));
        }

        return Ok(Json(VerifyOtpResponse::Verified { verified: true }));
    }

    // `purpose == "login"`: look up existing user or auto-provision a verified account.
    let platform = normalize_platform(req.platform.as_deref())?;
    let device_id = Uuid::now_v7();
    let (refresh_raw, refresh_hash) = generate_refresh_token();
    let refresh_expires_at =
        Utc::now() + ChronoDuration::days(state.config.jwt_refresh_ttl_days as i64);

    let record = match find_user_by_identifier(&state.pg, &email).await? {
        Some(existing) => {
            ensure_not_suspended(&existing)?;
            sqlx::query(
                "UPDATE users
                 SET email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW()
                 WHERE id = $1",
            )
            .bind(existing.id)
            .execute(&state.pg)
            .await?;

            create_device_session(
                &state.pg,
                device_id,
                existing.id,
                req.device_name.as_deref(),
                platform,
                &refresh_hash,
                refresh_expires_at,
            )
            .await?;
            find_user_by_identifier(&state.pg, &email)
                .await?
                .ok_or_else(|| AppError::Internal(anyhow::anyhow!("user vanished after login")))?
        }
        None => {
            let user_id = Uuid::now_v7();
            let username = derive_unique_username(&email);
            let display_name = email.split('@').next().unwrap_or("member").to_string();

            let mut tx = state.pg.begin().await?;
            sqlx::query(
                "INSERT INTO users (id, username, display_name, email, email_verified_at)
                 VALUES ($1, $2, $3, $4, NOW())",
            )
            .bind(user_id)
            .bind(&username)
            .bind(&display_name)
            .bind(&email)
            .execute(&mut *tx)
            .await?;

            sqlx::query(
                "INSERT INTO user_devices (id, user_id, device_name, platform, refresh_token_hash, expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(device_id)
            .bind(user_id)
            .bind(req.device_name.as_deref())
            .bind(platform)
            .bind(&refresh_hash)
            .bind(refresh_expires_at)
            .execute(&mut *tx)
            .await?;

            tx.commit().await?;

            find_user_by_identifier(&state.pg, &email)
                .await?
                .ok_or_else(|| AppError::Internal(anyhow::anyhow!("created user not found")))?
        }
    };

    let access_token = encode_access_token(
        record.id,
        device_id,
        &record.platform_role,
        state.config.jwt_secret.expose(),
        state.config.jwt_access_ttl_secs,
    )?;

    Ok(Json(VerifyOtpResponse::Auth(Box::new(AuthResponse {
        access_token,
        refresh_token: refresh_raw,
        token_type: "Bearer",
        expires_in: state.config.jwt_access_ttl_secs,
        device_id,
        user: record.into(),
    }))))
}

fn normalize_purpose(raw: Option<&str>) -> Result<&'static str, AppError> {
    match raw.unwrap_or("login").trim() {
        "login" | "" => Ok("login"),
        "verify_email" => Ok("verify_email"),
        other => Err(AppError::BadRequest(format!(
            "unsupported OTP purpose '{other}'; expected 'login' or 'verify_email'"
        ))),
    }
}

pub(crate) fn derive_unique_username(email: &str) -> String {
    let prefix: String = email
        .split('@')
        .next()
        .unwrap_or("user")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .take(20)
        .collect::<String>()
        .to_ascii_lowercase();
    let base = if prefix.len() < 3 {
        "user".to_string()
    } else {
        prefix
    };
    let suffix: u32 = OsRng.gen_range(1000..9999);
    format!("{base}_{suffix}")
}
