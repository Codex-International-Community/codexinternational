//! HTTP handlers for `/api/v1/auth/register`, `/login`, and `/me` (`Task 1.2`).

use std::sync::Arc;

use axum::{Json, extract::State, http::StatusCode};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    auth::{
        extractor::AuthUser,
        jwt::{encode_access_token, generate_refresh_token},
        repo::{
            NewUserParams, UserAuthRecord, UserProfile, create_device_session,
            create_user_with_device, find_user_by_id, find_user_by_identifier,
        },
    },
    error::AppError,
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub display_name: String,
    pub email: String,
    pub password: String,
    pub device_name: Option<String>,
    pub platform: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub identifier: String,
    pub password: String,
    pub device_name: Option<String>,
    pub platform: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: &'static str,
    pub expires_in: u64,
    pub device_id: Uuid,
    pub user: UserProfile,
}

#[derive(Debug, Serialize)]
pub struct MeResponse {
    pub user: UserProfile,
}

/// Registers a new human user account, hashes the password via bounded Argon2id,
/// opens an initial `user_devices` session, and issues JWT + refresh tokens.
pub async fn register(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RegisterRequest>,
) -> Result<(StatusCode, Json<AuthResponse>), AppError> {
    let username = validate_username(&req.username)?;
    let display_name = validate_display_name(&req.display_name)?;
    let email = validate_email(&req.email)?;
    validate_password(&req.password)?;
    let platform = normalize_platform(req.platform.as_deref())?;

    let password_hash = state.password_hasher.hash_password(req.password).await?;

    let user_id = Uuid::now_v7();
    let device_id = Uuid::now_v7();
    let (refresh_raw, refresh_hash) = generate_refresh_token();
    let refresh_expires_at = Utc::now() + Duration::days(state.config.jwt_refresh_ttl_days as i64);

    let user = create_user_with_device(
        &state.pg,
        NewUserParams {
            user_id,
            username: &username,
            display_name: &display_name,
            email: &email,
            password_hash: &password_hash,
            device_id,
            device_name: req.device_name.as_deref(),
            platform,
            refresh_token_hash: &refresh_hash,
            refresh_expires_at,
        },
    )
    .await?;

    let access_token = encode_access_token(
        user.id,
        device_id,
        &user.platform_role,
        state.config.jwt_secret.expose(),
        state.config.jwt_access_ttl_secs,
    )?;

    Ok((
        StatusCode::CREATED,
        Json(AuthResponse {
            access_token,
            refresh_token: refresh_raw,
            token_type: "Bearer",
            expires_in: state.config.jwt_access_ttl_secs,
            device_id,
            user,
        }),
    ))
}

/// Authenticates an existing user by email or username + Argon2id password,
/// checks global suspension (`INV-15`), and creates a new device session.
pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(req): Json<LoginRequest>,
) -> Result<(StatusCode, Json<AuthResponse>), AppError> {
    let identifier = req.identifier.trim();
    if identifier.is_empty() || req.password.is_empty() {
        return Err(AppError::BadRequest(
            "identifier and password are required".to_string(),
        ));
    }
    let platform = normalize_platform(req.platform.as_deref())?;

    let maybe_record = find_user_by_identifier(&state.pg, identifier).await?;
    let maybe_hash = maybe_record
        .as_ref()
        .and_then(|record| record.password_hash.clone());

    let matched = state
        .password_hasher
        .verify_password_or_dummy(req.password, maybe_hash)
        .await?;

    let Some(record) = maybe_record else {
        return Err(AppError::Unauthorized("invalid credentials".to_string()));
    };
    if !matched {
        return Err(AppError::Unauthorized("invalid credentials".to_string()));
    }

    ensure_not_suspended(&record)?;

    let device_id = Uuid::now_v7();
    let (refresh_raw, refresh_hash) = generate_refresh_token();
    let refresh_expires_at = Utc::now() + Duration::days(state.config.jwt_refresh_ttl_days as i64);

    create_device_session(
        &state.pg,
        device_id,
        record.id,
        req.device_name.as_deref(),
        platform,
        &refresh_hash,
        refresh_expires_at,
    )
    .await?;

    let access_token = encode_access_token(
        record.id,
        device_id,
        &record.platform_role,
        state.config.jwt_secret.expose(),
        state.config.jwt_access_ttl_secs,
    )?;

    Ok((
        StatusCode::OK,
        Json(AuthResponse {
            access_token,
            refresh_token: refresh_raw,
            token_type: "Bearer",
            expires_in: state.config.jwt_access_ttl_secs,
            device_id,
            user: record.into(),
        }),
    ))
}

#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    pub display_name: String,
}

/// Returns the authenticated user's current profile (`GET /api/v1/auth/me`).
pub async fn me(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
) -> Result<Json<MeResponse>, AppError> {
    let record = find_user_by_id(&state.pg, auth.user_id)
        .await?
        .ok_or_else(|| AppError::Unauthorized("user account no longer exists".to_string()))?;

    ensure_not_suspended(&record)?;

    Ok(Json(MeResponse {
        user: record.into(),
    }))
}

/// Updates the authenticated user's profile (`PATCH /api/v1/auth/me`).
pub async fn update_profile(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(req): Json<UpdateProfileRequest>,
) -> Result<Json<MeResponse>, AppError> {
    let record = find_user_by_id(&state.pg, auth.user_id)
        .await?
        .ok_or_else(|| AppError::Unauthorized("user account no longer exists".to_string()))?;
    ensure_not_suspended(&record)?;

    let display_name = validate_profile_display_name(&req.display_name)?;

    let updated = sqlx::query_as::<_, crate::auth::repo::UserProfile>(
        "UPDATE users
         SET display_name = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, uid, uid_login_enabled, (password_hash IS NOT NULL) AS has_password,
                   username, display_name, email, email_verified_at, bio,
                   platform_role, platform_badge, is_verified, can_bypass_compress, global_xp, global_level, created_at",
    )
    .bind(&display_name)
    .bind(auth.user_id)
    .fetch_one(&state.pg)
    .await?;

    Ok(Json(MeResponse { user: updated }))
}

pub(crate) fn ensure_not_suspended(record: &UserAuthRecord) -> Result<(), AppError> {
    if record.banned_at.is_some() {
        let reason = record
            .banned_reason
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or("account permanently banned");
        return Err(AppError::Forbidden(format!("banned: {reason}")));
    }
    if let Some(until) = record.suspended_until
        && until > Utc::now()
    {
        let reason = record
            .suspended_reason
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or("account suspended");
        return Err(AppError::Forbidden(format!(
            "{reason} (until {})",
            until.to_rfc3339()
        )));
    }
    Ok(())
}

fn validate_username(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    let valid_len = (3..=32).contains(&trimmed.len());
    let valid_chars = trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.');
    let has_letter = trimmed.chars().any(|c| c.is_ascii_alphabetic());
    if !valid_len || !valid_chars || !has_letter {
        return Err(AppError::BadRequest(
            "username must be 3-32 chars (alphanumeric, '_' or '.') with at least one letter"
                .to_string(),
        ));
    }
    Ok(trimmed.to_ascii_lowercase())
}

fn validate_display_name(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return Err(AppError::BadRequest(
            "display_name must be 1-64 characters".to_string(),
        ));
    }
    Ok(trimmed.to_string())
}

fn validate_profile_display_name(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    let len = trimmed.chars().count();
    // Allow empty to clear custom display name (fall back to username on client).
    if len > 0 && !(4..=20).contains(&len) {
        return Err(AppError::BadRequest(
            "display_name must be 4-20 characters, or empty to clear".to_string(),
        ));
    }
    Ok(trimmed.to_string())
}

pub(crate) fn validate_email(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim().to_ascii_lowercase();
    if trimmed.is_empty() || trimmed.len() > 255 {
        return Err(AppError::BadRequest("invalid email address".to_string()));
    }
    if trimmed.chars().any(|c| {
        c.is_control()
            || c.is_whitespace()
            || matches!(
                c,
                '"' | '\\' | '<' | '>' | ',' | ';' | '(' | ')' | '[' | ']'
            )
    }) {
        return Err(AppError::BadRequest("invalid email address".to_string()));
    }
    let Some((local, domain)) = trimmed.split_once('@') else {
        return Err(AppError::BadRequest("invalid email address".to_string()));
    };
    if local.is_empty()
        || local.len() > 64
        || local.starts_with('.')
        || local.ends_with('.')
        || local.contains("..")
        || domain.is_empty()
        || domain.contains('@')
        || !domain.contains('.')
        || domain.starts_with('.')
        || domain.ends_with('.')
        || domain.contains("..")
    {
        return Err(AppError::BadRequest("invalid email address".to_string()));
    }
    let valid_local = local
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '+'));
    let valid_domain = domain.split('.').all(|label| {
        !label.is_empty()
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    });
    if !valid_local || !valid_domain {
        return Err(AppError::BadRequest("invalid email address".to_string()));
    }
    Ok(trimmed)
}

pub(crate) fn validate_password(raw: &str) -> Result<(), AppError> {
    if raw.len() < 8 || raw.len() > 128 {
        return Err(AppError::BadRequest(
            "password must be 8-128 characters".to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn normalize_platform(raw: Option<&str>) -> Result<&'static str, AppError> {
    match raw.unwrap_or("web").trim() {
        "web" | "" => Ok("web"),
        "android_apk" => Ok("android_apk"),
        other => Err(AppError::BadRequest(format!(
            "unsupported platform '{other}'; expected 'web' or 'android_apk'"
        ))),
    }
}
