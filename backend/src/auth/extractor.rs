//! Axum authentication extractors for human users (`AuthUser`) and unified
//! principals (`AuthPrincipal`: `User` JWT or `Bot` opaque token with `chmod`
//! privilege & `INV-15` suspension/approval checks).

use std::sync::Arc;

use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts},
};
use chrono::Utc;
use fred::interfaces::KeysInterface;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    auth::jwt::{decode_access_token, hash_token},
    error::AppError,
    state::AppState,
};

/// Authenticated human user context extracted from `Authorization: Bearer <jwt>`.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: Uuid,
    pub device_id: Uuid,
    pub platform_role: String,
}

/// Authenticated bot context extracted from `Authorization: Bot <token>`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthBot {
    pub bot_id: Uuid,
    pub owner_id: Option<Uuid>,
    pub privilege_mode: i16,
}

/// Unified caller identity supporting both human JWTs and VPS Bot tokens.
#[derive(Debug, Clone)]
pub enum AuthPrincipal {
    User(AuthUser),
    Bot(AuthBot),
}

impl FromRequestParts<Arc<AppState>> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        match AuthPrincipal::from_request_parts(parts, state).await? {
            AuthPrincipal::User(user) => Ok(user),
            AuthPrincipal::Bot(_) => Err(AppError::Forbidden(
                "this endpoint requires a human user session".to_string(),
            )),
        }
    }
}

/// Optional human user extractor for public read-only endpoints that personalize
/// responses when a valid Bearer JWT is supplied.
#[derive(Debug, Clone)]
pub struct OptionalAuthUser(pub Option<AuthUser>);

impl FromRequestParts<Arc<AppState>> for OptionalAuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        if !parts.headers.contains_key(AUTHORIZATION) {
            return Ok(Self(None));
        }
        AuthUser::from_request_parts(parts, state)
            .await
            .map(|user| Self(Some(user)))
    }
}

impl FromRequestParts<Arc<AppState>> for AuthPrincipal {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let auth_header = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| AppError::Unauthorized("missing Authorization header".to_string()))?;

        if let Some(jwt) = auth_header
            .strip_prefix("Bearer ")
            .or_else(|| auth_header.strip_prefix("bearer "))
            .map(str::trim)
            .filter(|t| !t.is_empty())
        {
            let claims = decode_access_token(jwt, state.config.jwt_secret.expose())?;
            validate_user_session(state, claims.sub, claims.sid).await?;
            return Ok(Self::User(AuthUser {
                user_id: claims.sub,
                device_id: claims.sid,
                platform_role: claims.role,
            }));
        }

        if let Some(bot_token) = auth_header
            .strip_prefix("Bot ")
            .or_else(|| auth_header.strip_prefix("bot "))
            .map(str::trim)
            .filter(|t| !t.is_empty())
        {
            let bot = authenticate_bot_token(state, bot_token).await?;
            return Ok(Self::Bot(bot));
        }

        Err(AppError::Unauthorized(
            "expected Authorization: Bearer <jwt> or Bot <token>".to_string(),
        ))
    }
}

#[derive(FromRow)]
struct SessionStatusRow {
    suspended_until: Option<chrono::DateTime<Utc>>,
    suspended_reason: Option<String>,
    banned_at: Option<chrono::DateTime<Utc>>,
    banned_reason: Option<String>,
    revoked_at: Option<chrono::DateTime<Utc>>,
    expires_at: chrono::DateTime<Utc>,
}

/// Enforces user suspension and device session revocation on bearer requests (`AUTH-01`, `INV-15`).
pub async fn validate_user_session(
    state: &AppState,
    user_id: Uuid,
    device_id: Uuid,
) -> Result<(), AppError> {
    if state.valkey_initialized {
        let ban_key = format!("ban:user:{user_id}");
        if let Ok(Ok(Some(_))) = tokio::time::timeout(
            std::time::Duration::from_millis(150),
            state.valkey.get::<Option<String>, _>(&ban_key),
        )
        .await
        {
            return Err(AppError::Forbidden(
                "account permanently banned".to_string(),
            ));
        }

        let suspend_key = format!("suspend:user:{user_id}");
        if let Ok(Ok(Some(raw_until))) = tokio::time::timeout(
            std::time::Duration::from_millis(150),
            state.valkey.get::<Option<String>, _>(&suspend_key),
        )
        .await
            && let Ok(until_ts) = raw_until.parse::<i64>()
            && until_ts > Utc::now().timestamp()
        {
            return Err(AppError::Forbidden("account suspended".to_string()));
        }

        let revoked_key = format!("session:revoked:{device_id}");
        if let Ok(Ok(Some(_))) = tokio::time::timeout(
            std::time::Duration::from_millis(150),
            state.valkey.get::<Option<String>, _>(&revoked_key),
        )
        .await
        {
            return Err(AppError::Unauthorized(
                "session has been revoked".to_string(),
            ));
        }

        let valid_key = format!("session:valid:{device_id}");
        if let Ok(Ok(Some(_))) = tokio::time::timeout(
            std::time::Duration::from_millis(150),
            state.valkey.get::<Option<String>, _>(&valid_key),
        )
        .await
        {
            return Ok(());
        }
    }

    let query_res = sqlx::query_as::<_, SessionStatusRow>(
        "SELECT u.suspended_until, u.suspended_reason, u.banned_at, u.banned_reason, d.revoked_at, d.expires_at
         FROM users u
         JOIN user_devices d ON d.user_id = u.id AND d.id = $2
         WHERE u.id = $1
         LIMIT 1",
    )
    .bind(user_id)
    .bind(device_id)
    .fetch_optional(&state.pg)
    .await;

    match query_res {
        Ok(Some(row)) => {
            if row.revoked_at.is_some() || row.expires_at <= Utc::now() {
                if state.valkey_initialized {
                    let revoked_key = format!("session:revoked:{device_id}");
                    let _ = state
                        .valkey
                        .set::<(), _, _>(
                            &revoked_key,
                            "1",
                            Some(fred::types::Expiration::EX(900)),
                            None,
                            false,
                        )
                        .await;
                }
                return Err(AppError::Unauthorized(
                    "session has been revoked or expired".to_string(),
                ));
            }

            if row.banned_at.is_some() {
                if state.valkey_initialized {
                    let ban_key = format!("ban:user:{user_id}");
                    let _ = state
                        .valkey
                        .set::<(), _, _>(
                            &ban_key,
                            "1",
                            Some(fred::types::Expiration::EX(3600)),
                            None,
                            false,
                        )
                        .await;
                }
                let msg = row
                    .banned_reason
                    .unwrap_or_else(|| "account permanently banned".to_string());
                return Err(AppError::Forbidden(msg));
            }

            if let Some(until) = row.suspended_until
                && until > Utc::now()
            {
                if state.valkey_initialized {
                    let ban_key = format!("ban:user:{user_id}");
                    if let Ok(Ok(Some(_))) = tokio::time::timeout(
                        std::time::Duration::from_millis(150),
                        state.valkey.get::<Option<String>, _>(&ban_key),
                    )
                    .await
                    {
                        return Err(AppError::Forbidden(
                            "account permanently banned".to_string(),
                        ));
                    }

                    let suspend_key = format!("suspend:user:{user_id}");
                    let ttl = (until - Utc::now()).num_seconds().max(1);
                    let _ = state
                        .valkey
                        .set::<(), _, _>(
                            &suspend_key,
                            until.timestamp().to_string(),
                            Some(fred::types::Expiration::EX(ttl)),
                            None,
                            false,
                        )
                        .await;
                }
                let msg = row
                    .suspended_reason
                    .unwrap_or_else(|| "account suspended".to_string());
                return Err(AppError::Forbidden(msg));
            }

            if state.valkey_initialized {
                let valid_key = format!("session:valid:{device_id}");
                let _ = state
                    .valkey
                    .set::<(), _, _>(
                        &valid_key,
                        "1",
                        Some(fred::types::Expiration::EX(60)),
                        None,
                        false,
                    )
                    .await;
            }

            Ok(())
        }
        Ok(None) => {
            if state.valkey_initialized {
                Err(AppError::Unauthorized(
                    "invalid user or session".to_string(),
                ))
            } else {
                Ok(())
            }
        }
        Err(err) => {
            if !state.valkey_initialized {
                Ok(())
            } else {
                tracing::error!(error = %err, "failed to query user session status from db");
                Err(AppError::from(err))
            }
        }
    }
}

#[derive(FromRow)]
struct BotAuthRow {
    bot_id: Uuid,
    owner_id: Option<Uuid>,
    privilege_mode: i16,
    approval_status: String,
    is_active: bool,
}

async fn authenticate_bot_token(state: &AppState, raw_token: &str) -> Result<AuthBot, AppError> {
    let token_hash = hash_token(raw_token);
    let cache_key = format!("bot:token:{token_hash}");

    if state.valkey_initialized
        && let Ok(Ok(Some(cached_json))) = tokio::time::timeout(
            std::time::Duration::from_millis(200),
            state.valkey.get::<Option<String>, _>(&cache_key),
        )
        .await
        && let Ok(bot) = serde_json::from_str::<AuthBot>(&cached_json)
    {
        return Ok(bot);
    }

    let row = sqlx::query_as::<_, BotAuthRow>(
        "SELECT b.id AS bot_id, b.owner_id, b.privilege_mode, b.approval_status, b.is_active
         FROM bot_tokens bt
         JOIN bots b ON b.id = bt.bot_id
         WHERE bt.token_hash = $1 AND bt.revoked_at IS NULL
         LIMIT 1",
    )
    .bind(&token_hash)
    .fetch_optional(&state.pg)
    .await?
    .ok_or_else(|| AppError::Unauthorized("invalid or revoked bot token".to_string()))?;

    if !row.is_active || row.approval_status != "APPROVED" {
        return Err(AppError::Forbidden(
            "bot is inactive or awaiting platform 'dev' approval".to_string(),
        ));
    }

    let bot = AuthBot {
        bot_id: row.bot_id,
        owner_id: row.owner_id,
        privilege_mode: row.privilege_mode,
    };

    if state.valkey_initialized
        && let Ok(json) = serde_json::to_string(&bot)
    {
        let _ = tokio::time::timeout(
            std::time::Duration::from_millis(200),
            state.valkey.set::<(), _, _>(
                &cache_key,
                json,
                Some(fred::types::Expiration::EX(300)),
                None,
                false,
            ),
        )
        .await;
    }

    Ok(bot)
}
