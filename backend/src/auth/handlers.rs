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

    let record = find_user_by_identifier(&state.pg, identifier)
        .await?
        .ok_or_else(|| AppError::Unauthorized("invalid credentials".to_string()))?;

    let stored_hash = record
        .password_hash
        .clone()
        .ok_or_else(|| AppError::Unauthorized("invalid credentials".to_string()))?;

    let matched = state
        .password_hasher
        .verify_password(req.password, stored_hash)
        .await?;
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

pub(crate) fn ensure_not_suspended(record: &UserAuthRecord) -> Result<(), AppError> {
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
    if !valid_len || !valid_chars {
        return Err(AppError::BadRequest(
            "username must be 3-32 chars (alphanumeric, '_' or '.')".to_string(),
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

pub(crate) fn validate_email(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim().to_ascii_lowercase();
    let Some((local, domain)) = trimmed.split_once('@') else {
        return Err(AppError::BadRequest("invalid email address".to_string()));
    };
    if local.is_empty() || !domain.contains('.') || trimmed.len() > 255 || trimmed.contains(' ') {
        return Err(AppError::BadRequest("invalid email address".to_string()));
    }
    Ok(trimmed)
}

fn validate_password(raw: &str) -> Result<(), AppError> {
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
