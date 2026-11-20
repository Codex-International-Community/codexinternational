//! User UID formatting (`MMYY` + 2-digit role + unpadded suffix), opt-in UID
//! login toggle, password setup for OAuth/OTP accounts, and reserved slot
//! assignment (`1..=10`) for platform `dev`.

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
};
use chrono::{DateTime, Utc};
use fred::interfaces::KeysInterface;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    auth::{
        extractor::AuthUser,
        handlers::{MeResponse, ensure_not_suspended, validate_password},
        repo::{UserProfile, find_user_by_id},
    },
    error::AppError,
    state::AppState,
};

pub const UID_ROLE_FOUNDER: i16 = 0;
pub const UID_ROLE_VICE_FOUNDER: i16 = 1;
pub const UID_ROLE_SENIOR_ADMIN: i16 = 2;
pub const UID_ROLE_ADMIN: i16 = 3;
pub const UID_ROLE_MODERATOR: i16 = 4;
pub const UID_ROLE_MEMBER_SEPUH: i16 = 5;
pub const UID_ROLE_MEMBER: i16 = 6;

/// Formats a UID as `<MM><YY><RR><seq>` without zero-padding `seq`.
/// Slots `1..=9` produce 7-digit UIDs; `10+` produce 8+ digits.
pub fn format_uid(at: DateTime<Utc>, role_code: i16, seq: i64) -> Result<String, AppError> {
    if !(0..=6).contains(&role_code) {
        return Err(AppError::BadRequest(
            "role_code must be between 0 (Founder) and 6 (Member)".to_string(),
        ));
    }
    if seq < 1 {
        return Err(AppError::BadRequest(
            "UID sequence must be >= 1".to_string(),
        ));
    }
    Ok(format!("{}{:02}{seq}", at.format("%m%y"), role_code))
}

#[derive(Debug, Deserialize)]
pub struct SetPasswordRequest {
    pub current_password: Option<String>,
    pub new_password: String,
}

#[derive(Debug, Deserialize)]
pub struct ToggleUidLoginRequest {
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct AssignReservedUidRequest {
    pub slot_number: i16,
    pub role_code: Option<i16>,
    pub platform_role: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct ReservedUidSlot {
    pub slot_number: i16,
    pub default_role_code: i16,
    pub label: String,
    pub assigned_user_id: Option<Uuid>,
    pub assigned_at: Option<DateTime<Utc>>,
}

/// Sets a password for an OAuth/OTP-only account, or changes an existing password
/// (`PUT /api/v1/auth/password`). Required before OAuth/OTP users can enable UID login.
pub async fn set_or_change_password(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(req): Json<SetPasswordRequest>,
) -> Result<Json<MeResponse>, AppError> {
    validate_password(&req.new_password)?;

    let record = find_user_by_id(&state.pg, auth.user_id)
        .await?
        .ok_or_else(|| AppError::Unauthorized("user account no longer exists".to_string()))?;

    ensure_not_suspended(&record)?;

    let had_password = record.password_hash.is_some();
    if let Some(existing_hash) = record.password_hash {
        let current = req
            .current_password
            .as_deref()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                AppError::BadRequest("current_password is required to change password".to_string())
            })?;
        let matched = state
            .password_hasher
            .verify_password(current.to_string(), existing_hash)
            .await?;
        if !matched {
            return Err(AppError::Unauthorized(
                "current password is incorrect".to_string(),
            ));
        }
    }

    let new_hash = state
        .password_hasher
        .hash_password(req.new_password)
        .await?;

    let mut tx = state.pg.begin().await?;

    let updated = sqlx::query_as::<_, UserProfile>(
        "UPDATE users
         SET password_hash = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, uid, uid_login_enabled, (password_hash IS NOT NULL) AS has_password,
                   username, display_name, email, email_verified_at, bio,
                   platform_role, can_bypass_compress, global_xp, global_level, created_at",
    )
    .bind(&new_hash)
    .bind(auth.user_id)
    .fetch_one(&mut *tx)
    .await?;

    if had_password {
        // Revoke other active device sessions when changing an existing password.
        // Also clear Valkey session caches for each revoked device (AUTH-01).
        let revoked_ids: Vec<Uuid> = sqlx::query_scalar(
            "SELECT id FROM user_devices WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL",
        )
        .bind(auth.user_id)
        .bind(auth.device_id)
        .fetch_all(&mut *tx)
        .await
        .unwrap_or_default();

        sqlx::query(
            "UPDATE user_devices
             SET revoked_at = NOW(), fcm_token = NULL
             WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL",
        )
        .bind(auth.user_id)
        .bind(auth.device_id)
        .execute(&mut *tx)
        .await?;

        if state.valkey_initialized {
            for device_id in revoked_ids {
                let valid_key = format!("session:valid:{device_id}");
                let revoked_key = format!("session:revoked:{device_id}");
                let _ = state.valkey.del::<i64, _>(&valid_key).await;
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
        }
    }

    tx.commit().await?;

    Ok(Json(MeResponse { user: updated }))
}

/// Enables or disables login using the user's UID (`PATCH /api/v1/auth/uid-login`).
/// Users without a password (OAuth/OTP-only) must set a password first.
pub async fn toggle_uid_login(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(req): Json<ToggleUidLoginRequest>,
) -> Result<Json<MeResponse>, AppError> {
    let record = find_user_by_id(&state.pg, auth.user_id)
        .await?
        .ok_or_else(|| AppError::Unauthorized("user account no longer exists".to_string()))?;

    ensure_not_suspended(&record)?;

    if req.enabled && record.password_hash.is_none() {
        return Err(AppError::BadRequest(
            "set a password first via PUT /api/v1/auth/password before enabling UID login"
                .to_string(),
        ));
    }

    let updated = sqlx::query_as::<_, UserProfile>(
        "UPDATE users
         SET uid_login_enabled = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, uid, uid_login_enabled, (password_hash IS NOT NULL) AS has_password,
                   username, display_name, email, email_verified_at, bio,
                   platform_role, can_bypass_compress, global_xp, global_level, created_at",
    )
    .bind(req.enabled)
    .bind(auth.user_id)
    .fetch_one(&state.pg)
    .await?;

    Ok(Json(MeResponse { user: updated }))
}

/// Lists reserved UID slots `1..=10` (`GET /api/v1/dev/uid-slots`, `dev` only).
pub async fn list_reserved_uid_slots(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
) -> Result<Json<Vec<ReservedUidSlot>>, AppError> {
    if auth.platform_role != "dev" {
        return Err(AppError::Forbidden(
            "only platform 'dev' can view reserved UID slots".to_string(),
        ));
    }

    let slots = sqlx::query_as::<_, ReservedUidSlot>(
        "SELECT slot_number, default_role_code, label, assigned_user_id, assigned_at
         FROM reserved_uid_slots
         ORDER BY slot_number ASC",
    )
    .fetch_all(&state.pg)
    .await?;

    Ok(Json(slots))
}

/// Assigns a reserved UID slot `1..=10` to an existing user
/// (`POST /api/v1/dev/users/{id}/assign-uid`, `dev` only).
pub async fn assign_reserved_uid(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(target_user_id): Path<Uuid>,
    Json(req): Json<AssignReservedUidRequest>,
) -> Result<Json<MeResponse>, AppError> {
    if auth.platform_role != "dev" {
        return Err(AppError::Forbidden(
            "only platform 'dev' can assign reserved UIDs".to_string(),
        ));
    }
    if !(1..=10).contains(&req.slot_number) {
        return Err(AppError::BadRequest(
            "slot_number must be between 1 and 10".to_string(),
        ));
    }

    if auth.user_id != target_user_id {
        let actor_badge: Option<String> =
            sqlx::query_scalar("SELECT platform_badge FROM users WHERE id = $1")
                .bind(auth.user_id)
                .fetch_optional(&state.pg)
                .await?
                .flatten();
        let target_row: Option<(String, Option<String>)> =
            sqlx::query_as("SELECT platform_role, platform_badge FROM users WHERE id = $1")
                .bind(target_user_id)
                .fetch_optional(&state.pg)
                .await?;
        if let Some((target_role, target_badge)) = target_row {
            let actor_w = crate::auth::dev_governance::platform_weight(
                &auth.platform_role,
                actor_badge.as_deref(),
            );
            let target_w = crate::auth::dev_governance::platform_weight(
                &target_role,
                target_badge.as_deref(),
            );
            if target_w >= actor_w {
                return Err(AppError::Forbidden(
                    "cannot modify a platform user with equal or higher hierarchy weight"
                        .to_string(),
                ));
            }
        }
    }

    let next_platform_role = match req.platform_role.as_deref() {
        Some(r) => {
            let trimmed = r.trim();
            if !matches!(trimmed, "dev" | "moderator" | "user") {
                return Err(AppError::BadRequest(
                    "platform_role must be 'dev', 'moderator', or 'user'".to_string(),
                ));
            }
            Some(trimmed.to_string())
        }
        None => None,
    };

    let mut tx = state.pg.begin().await?;

    let slot = sqlx::query_as::<_, ReservedUidSlot>(
        "SELECT slot_number, default_role_code, label, assigned_user_id, assigned_at
         FROM reserved_uid_slots
         WHERE slot_number = $1
         FOR UPDATE",
    )
    .bind(req.slot_number)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("reserved UID slot not found".to_string()))?;

    if let Some(existing_uid) = slot.assigned_user_id
        && existing_uid != target_user_id
    {
        return Err(AppError::Conflict(format!(
            "reserved slot {} is already assigned to another user",
            req.slot_number
        )));
    }

    let role_code = req.role_code.unwrap_or(slot.default_role_code);
    let new_uid = format_uid(Utc::now(), role_code, i64::from(req.slot_number))?;

    // Release any previous reserved slot held by this user before assigning the new one.
    sqlx::query(
        "UPDATE reserved_uid_slots
         SET assigned_user_id = NULL, assigned_at = NULL
         WHERE assigned_user_id = $1 AND slot_number <> $2",
    )
    .bind(target_user_id)
    .bind(req.slot_number)
    .execute(&mut *tx)
    .await?;

    let updated = sqlx::query_as::<_, UserProfile>(
        "UPDATE users
         SET uid = $1,
             platform_role = COALESCE($2, platform_role),
             updated_at = NOW()
         WHERE id = $3
         RETURNING id, uid, uid_login_enabled, (password_hash IS NOT NULL) AS has_password,
                   username, display_name, email, email_verified_at, bio,
                   platform_role, can_bypass_compress, global_xp, global_level, created_at",
    )
    .bind(&new_uid)
    .bind(next_platform_role.as_deref())
    .bind(target_user_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("target user not found".to_string()))?;

    sqlx::query(
        "UPDATE reserved_uid_slots
         SET assigned_user_id = $1, assigned_at = NOW()
         WHERE slot_number = $2",
    )
    .bind(target_user_id)
    .bind(req.slot_number)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Json(MeResponse { user: updated }))
}
