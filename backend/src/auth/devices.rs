//! Refresh token rotation with reuse detection, logout, and FCM device registry (`Task 1.3`).

use std::sync::Arc;

use axum::{Json, extract::State, http::StatusCode};
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    auth::{
        extractor::AuthUser,
        handlers::{AuthResponse, ensure_not_suspended, normalize_platform},
        jwt::{encode_access_token, generate_refresh_token, hash_token},
        repo::find_user_by_id,
    },
    error::AppError,
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateFcmRequest {
    pub fcm_token: String,
    pub platform: Option<String>,
}

#[derive(Debug, FromRow)]
struct DeviceSessionRow {
    id: Uuid,
    user_id: Uuid,
    expires_at: DateTime<Utc>,
    revoked_at: Option<DateTime<Utc>>,
}

/// Rotates an opaque refresh token for a device session (`POST /api/v1/auth/refresh`).
///
/// Security invariant: if a previously rotated/revoked refresh token is replayed,
/// ALL active device sessions for that `user_id` are immediately revoked to stop
/// token-theft escalation.
pub async fn refresh(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RefreshRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let trimmed = req.refresh_token.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest(
            "refresh_token is required".to_string(),
        ));
    }

    let old_hash = hash_token(trimmed);
    let session = sqlx::query_as::<_, DeviceSessionRow>(
        "SELECT id, user_id, expires_at, revoked_at
         FROM user_devices
         WHERE refresh_token_hash = $1
         LIMIT 1",
    )
    .bind(&old_hash)
    .fetch_optional(&state.pg)
    .await?
    .ok_or_else(|| AppError::Unauthorized("invalid refresh token".to_string()))?;

    // Replay of a revoked token indicates compromise -> revoke all sessions for the user.
    if session.revoked_at.is_some() {
        revoke_all_user_devices(&state, session.user_id).await?;
        return Err(AppError::Unauthorized(
            "refresh token reuse detected; all sessions revoked".to_string(),
        ));
    }

    if session.expires_at <= Utc::now() {
        return Err(AppError::Unauthorized("refresh token expired".to_string()));
    }

    let user = find_user_by_id(&state.pg, session.user_id)
        .await?
        .ok_or_else(|| AppError::Unauthorized("user account no longer exists".to_string()))?;

    ensure_not_suspended(&user)?;

    let (new_raw, new_hash) = generate_refresh_token();
    let new_expires_at = Utc::now() + Duration::days(state.config.jwt_refresh_ttl_days as i64);

    // Atomic conditional update prevents concurrent double-spend of the same token.
    let updated = sqlx::query(
        "UPDATE user_devices
         SET refresh_token_hash = $1, last_active_at = NOW(), expires_at = $2
         WHERE id = $3 AND refresh_token_hash = $4 AND revoked_at IS NULL",
    )
    .bind(&new_hash)
    .bind(new_expires_at)
    .bind(session.id)
    .bind(&old_hash)
    .execute(&state.pg)
    .await?;

    if updated.rows_affected() == 0 {
        revoke_all_user_devices(&state, session.user_id).await?;
        return Err(AppError::Unauthorized(
            "concurrent refresh token reuse detected".to_string(),
        ));
    }

    let access_token = encode_access_token(
        user.id,
        session.id,
        &user.platform_role,
        state.config.jwt_secret.expose(),
        state.config.jwt_access_ttl_secs,
    )?;

    Ok(Json(AuthResponse {
        access_token,
        refresh_token: new_raw,
        token_type: "Bearer",
        expires_in: state.config.jwt_access_ttl_secs,
        device_id: session.id,
        user: user.into(),
    }))
}

/// Revokes the caller's active device session and clears its FCM push token.
pub async fn logout(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
) -> Result<StatusCode, AppError> {
    sqlx::query(
        "UPDATE user_devices
         SET revoked_at = NOW(), fcm_token = NULL
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
    )
    .bind(auth.device_id)
    .bind(auth.user_id)
    .execute(&state.pg)
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

/// Registers or updates the device's FCM push token (`PUT /api/v1/devices/fcm`).
pub async fn register_fcm(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(req): Json<UpdateFcmRequest>,
) -> Result<StatusCode, AppError> {
    let token = req.fcm_token.trim();
    if token.is_empty() || token.len() > 512 {
        return Err(AppError::BadRequest(
            "fcm_token must be 1-512 characters".to_string(),
        ));
    }
    let platform = req
        .platform
        .as_deref()
        .map(|p| normalize_platform(Some(p)))
        .transpose()?;

    let mut tx = state.pg.begin().await?;

    // Detach this FCM token from any older device row before binding to current device
    // (handles account switching on the same physical phone without UNIQUE violation).
    sqlx::query("UPDATE user_devices SET fcm_token = NULL WHERE fcm_token = $1 AND id <> $2")
        .bind(token)
        .bind(auth.device_id)
        .execute(&mut *tx)
        .await?;

    let res = if let Some(plat) = platform {
        sqlx::query(
            "UPDATE user_devices
             SET fcm_token = $1, platform = $2, last_active_at = NOW()
             WHERE id = $3 AND user_id = $4 AND revoked_at IS NULL",
        )
        .bind(token)
        .bind(plat)
        .bind(auth.device_id)
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await?
    } else {
        sqlx::query(
            "UPDATE user_devices
             SET fcm_token = $1, last_active_at = NOW()
             WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL",
        )
        .bind(token)
        .bind(auth.device_id)
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await?
    };

    if res.rows_affected() == 0 {
        return Err(AppError::Unauthorized(
            "device session revoked or not found".to_string(),
        ));
    }

    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn revoke_all_user_devices(state: &AppState, user_id: Uuid) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE user_devices
         SET revoked_at = NOW(), fcm_token = NULL
         WHERE user_id = $1 AND revoked_at IS NULL",
    )
    .bind(user_id)
    .execute(&state.pg)
    .await?;
    Ok(())
}
