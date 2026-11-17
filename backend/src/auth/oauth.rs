//! OAuth2 login and account linking for GitHub and Google (`Task 1.3`).

use std::sync::Arc;

use async_trait::async_trait;
use axum::{
    Json,
    extract::{Path, State},
};
use chrono::{Duration, Utc};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    auth::{
        handlers::{AuthResponse, ensure_not_suspended, normalize_platform},
        jwt::{encode_access_token, generate_refresh_token},
        otp::derive_unique_username,
        repo::{create_device_session, find_user_by_id, find_user_by_identifier},
    },
    config::AppConfig,
    error::AppError,
    state::AppState,
};

/// Normalized profile returned by an OAuth2 provider after exchanging an authorization code.
#[derive(Debug, Clone)]
pub struct OAuthUserInfo {
    pub provider_user_id: String,
    pub email: String,
    pub display_name: String,
}

#[async_trait]
pub trait OAuthClient: Send + Sync {
    async fn exchange_code(
        &self,
        provider: &str,
        code: &str,
        redirect_uri: &str,
        cfg: &AppConfig,
    ) -> Result<OAuthUserInfo, AppError>;
}

pub struct ReqwestOAuthClient {
    http: reqwest::Client,
}

impl Default for ReqwestOAuthClient {
    fn default() -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
    }
}

#[async_trait]
impl OAuthClient for ReqwestOAuthClient {
    async fn exchange_code(
        &self,
        provider: &str,
        code: &str,
        redirect_uri: &str,
        cfg: &AppConfig,
    ) -> Result<OAuthUserInfo, AppError> {
        match provider {
            "github" => self.exchange_github(code, redirect_uri, cfg).await,
            "google" => self.exchange_google(code, redirect_uri, cfg).await,
            other => Err(AppError::BadRequest(format!(
                "unsupported OAuth provider '{other}'"
            ))),
        }
    }
}

impl ReqwestOAuthClient {
    async fn exchange_github(
        &self,
        code: &str,
        redirect_uri: &str,
        cfg: &AppConfig,
    ) -> Result<OAuthUserInfo, AppError> {
        if cfg.oauth_github_client_id.is_empty() || cfg.oauth_github_client_secret.is_empty() {
            return Err(AppError::ServiceUnavailable {
                retry_after_secs: 60,
                message: "GitHub OAuth is not configured".to_string(),
            });
        }

        #[derive(Deserialize)]
        struct TokenResp {
            access_token: String,
        }

        let token: TokenResp = self
            .http
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .form(&[
                ("client_id", cfg.oauth_github_client_id.as_str()),
                ("client_secret", cfg.oauth_github_client_secret.expose()),
                ("code", code),
                ("redirect_uri", redirect_uri),
            ])
            .send()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("github token request failed: {e}")))?
            .error_for_status()
            .map_err(|_| AppError::Unauthorized("github authorization code rejected".to_string()))?
            .json()
            .await
            .map_err(|_| AppError::Unauthorized("invalid github token response".to_string()))?;

        #[derive(Deserialize)]
        struct GhUser {
            id: i64,
            login: String,
            name: Option<String>,
            email: Option<String>,
        }

        let gh_user: GhUser = self
            .http
            .get("https://api.github.com/user")
            .header("User-Agent", "codexinternational-backend")
            .bearer_auth(&token.access_token)
            .send()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("github user request failed: {e}")))?
            .error_for_status()
            .map_err(|_| AppError::Unauthorized("failed to fetch github profile".to_string()))?
            .json()
            .await
            .map_err(|_| AppError::Unauthorized("invalid github profile response".to_string()))?;

        let email = match gh_user.email {
            Some(e) if !e.is_empty() => e.to_ascii_lowercase(),
            _ => self.fetch_github_primary_email(&token.access_token).await?,
        };

        Ok(OAuthUserInfo {
            provider_user_id: gh_user.id.to_string(),
            email,
            display_name: gh_user.name.unwrap_or(gh_user.login),
        })
    }

    async fn fetch_github_primary_email(&self, access_token: &str) -> Result<String, AppError> {
        #[derive(Deserialize)]
        struct GhEmail {
            email: String,
            primary: bool,
            verified: bool,
        }

        let emails: Vec<GhEmail> = self
            .http
            .get("https://api.github.com/user/emails")
            .header("User-Agent", "codexinternational-backend")
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("github emails failed: {e}")))?
            .error_for_status()
            .map_err(|_| AppError::Unauthorized("failed to fetch github emails".to_string()))?
            .json()
            .await
            .map_err(|_| AppError::Unauthorized("invalid github emails response".to_string()))?;

        emails
            .into_iter()
            .find(|e| e.primary && e.verified)
            .map(|e| e.email.to_ascii_lowercase())
            .ok_or_else(|| {
                AppError::BadRequest("GitHub account has no verified primary email".to_string())
            })
    }

    async fn exchange_google(
        &self,
        code: &str,
        redirect_uri: &str,
        cfg: &AppConfig,
    ) -> Result<OAuthUserInfo, AppError> {
        if cfg.oauth_google_client_id.is_empty() || cfg.oauth_google_client_secret.is_empty() {
            return Err(AppError::ServiceUnavailable {
                retry_after_secs: 60,
                message: "Google OAuth is not configured".to_string(),
            });
        }

        #[derive(Deserialize)]
        struct TokenResp {
            access_token: String,
        }

        let token: TokenResp = self
            .http
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("client_id", cfg.oauth_google_client_id.as_str()),
                ("client_secret", cfg.oauth_google_client_secret.expose()),
                ("code", code),
                ("redirect_uri", redirect_uri),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("google token failed: {e}")))?
            .error_for_status()
            .map_err(|_| AppError::Unauthorized("google authorization code rejected".to_string()))?
            .json()
            .await
            .map_err(|_| AppError::Unauthorized("invalid google token response".to_string()))?;

        #[derive(Deserialize)]
        struct GoogleUser {
            sub: String,
            email: Option<String>,
            email_verified: Option<bool>,
            name: Option<String>,
        }

        let g_user: GoogleUser = self
            .http
            .get("https://openidconnect.googleapis.com/v1/userinfo")
            .bearer_auth(&token.access_token)
            .send()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("google userinfo failed: {e}")))?
            .error_for_status()
            .map_err(|_| AppError::Unauthorized("failed to fetch google profile".to_string()))?
            .json()
            .await
            .map_err(|_| AppError::Unauthorized("invalid google profile response".to_string()))?;

        if !g_user.email_verified.unwrap_or(false) {
            return Err(AppError::BadRequest(
                "Google account email must be verified".to_string(),
            ));
        }

        let email = g_user
            .email
            .filter(|s| !s.is_empty())
            .map(|s| s.to_ascii_lowercase())
            .ok_or_else(|| AppError::BadRequest("Google profile missing email".to_string()))?;

        Ok(OAuthUserInfo {
            provider_user_id: g_user.sub,
            display_name: g_user
                .name
                .unwrap_or_else(|| email.split('@').next().unwrap_or("member").to_string()),
            email,
        })
    }
}

#[derive(Debug, Deserialize)]
pub struct OAuthLoginRequest {
    pub code: String,
    pub redirect_uri: String,
    pub device_name: Option<String>,
    pub platform: Option<String>,
}

/// Exchanges an OAuth2 authorization code (GitHub or Google), links or provisions
/// the user account, and issues JWT + refresh tokens (`POST /api/v1/auth/oauth/{provider}`).
pub async fn oauth_login(
    State(state): State<Arc<AppState>>,
    Path(provider): Path<String>,
    Json(req): Json<OAuthLoginRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let provider = match provider.trim().to_ascii_lowercase().as_str() {
        "github" => "github",
        "google" => "google",
        other => {
            return Err(AppError::BadRequest(format!(
                "unsupported OAuth provider '{other}'"
            )));
        }
    };
    if req.code.trim().is_empty() || req.redirect_uri.trim().is_empty() {
        return Err(AppError::BadRequest(
            "code and redirect_uri are required".to_string(),
        ));
    }
    let platform = normalize_platform(req.platform.as_deref())?;

    let info = state
        .oauth_client
        .exchange_code(
            provider,
            req.code.trim(),
            req.redirect_uri.trim(),
            &state.config,
        )
        .await?;

    let existing_uid: Option<Uuid> = sqlx::query_scalar(
        "SELECT user_id FROM oauth_accounts WHERE provider = $1 AND provider_user_id = $2",
    )
    .bind(provider)
    .bind(&info.provider_user_id)
    .fetch_optional(&state.pg)
    .await?;

    let device_id = Uuid::now_v7();
    let (refresh_raw, refresh_hash) = generate_refresh_token();
    let refresh_expires_at = Utc::now() + Duration::days(state.config.jwt_refresh_ttl_days as i64);

    let record = if let Some(uid) = existing_uid {
        let user = find_user_by_id(&state.pg, uid)
            .await?
            .ok_or_else(|| AppError::Unauthorized("linked user not found".to_string()))?;
        ensure_not_suspended(&user)?;
        create_device_session(
            &state.pg,
            device_id,
            user.id,
            req.device_name.as_deref(),
            platform,
            &refresh_hash,
            refresh_expires_at,
        )
        .await?;
        user
    } else if let Some(existing_by_email) = find_user_by_identifier(&state.pg, &info.email).await? {
        ensure_not_suspended(&existing_by_email)?;
        let mut tx = state.pg.begin().await?;
        sqlx::query(
            "INSERT INTO oauth_accounts (provider, provider_user_id, user_id)
             VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING",
        )
        .bind(provider)
        .bind(&info.provider_user_id)
        .bind(existing_by_email.id)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "UPDATE users
             SET email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW()
             WHERE id = $1",
        )
        .bind(existing_by_email.id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;

        create_device_session(
            &state.pg,
            device_id,
            existing_by_email.id,
            req.device_name.as_deref(),
            platform,
            &refresh_hash,
            refresh_expires_at,
        )
        .await?;
        find_user_by_id(&state.pg, existing_by_email.id)
            .await?
            .ok_or_else(|| AppError::Internal(anyhow::anyhow!("linked user missing")))?
    } else {
        let user_id = Uuid::now_v7();
        let username = derive_unique_username(&info.email);
        let display_name: String = info.display_name.chars().take(64).collect();

        let mut tx = state.pg.begin().await?;
        sqlx::query(
            "INSERT INTO users (id, username, display_name, email, email_verified_at)
             VALUES ($1, $2, $3, $4, NOW())",
        )
        .bind(user_id)
        .bind(&username)
        .bind(&display_name)
        .bind(&info.email)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "INSERT INTO oauth_accounts (provider, provider_user_id, user_id)
             VALUES ($1, $2, $3)",
        )
        .bind(provider)
        .bind(&info.provider_user_id)
        .bind(user_id)
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

        find_user_by_id(&state.pg, user_id)
            .await?
            .ok_or_else(|| AppError::Internal(anyhow::anyhow!("created oauth user missing")))?
    };

    let access_token = encode_access_token(
        record.id,
        device_id,
        &record.platform_role,
        state.config.jwt_secret.expose(),
        state.config.jwt_access_ttl_secs,
    )?;

    Ok(Json(AuthResponse {
        access_token,
        refresh_token: refresh_raw,
        token_type: "Bearer",
        expires_in: state.config.jwt_access_ttl_secs,
        device_id,
        user: record.into(),
    }))
}
