//! Bot entities, chmod-style privilege flags (`1|2|4|8`), `dev` approval flow,
//! and bot token management (`Task 1.4`, `INV-15`).

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use fred::interfaces::KeysInterface;
use rand::{RngCore, rngs::OsRng};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    auth::{extractor::AuthUser, jwt::hash_token},
    error::AppError,
    state::AppState,
};

/// `chmod`-style privilege bits for bots (`1..=15`).
pub const BOT_READ: i16 = 1 << 0; // 1: read channel messages & WS events
pub const BOT_WRITE: i16 = 1 << 1; // 2: send messages & replies
pub const BOT_MOD: i16 = 1 << 2; // 4: community guardrail (timeout, ban, delete msg)
pub const BOT_ADMIN: i16 = 1 << 3; // 8: global platform admin bot (`dev` only)

/// Returns `true` when `privilege_mode` grants all bits in `required`.
pub fn has_bot_privilege(privilege_mode: i16, required: i16) -> bool {
    (privilege_mode & required) == required
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct BotRecord {
    pub id: Uuid,
    pub owner_id: Option<Uuid>,
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub privilege_mode: i16,
    pub approval_status: String,
    pub approved_by: Option<Uuid>,
    pub approved_at: Option<DateTime<Utc>>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateBotRequest {
    pub name: String,
    pub display_name: String,
    pub description: Option<String>,
    pub privilege_mode: Option<i16>,
}

#[derive(Debug, Deserialize)]
pub struct ReviewBotRequest {
    pub decision: String, // "APPROVED" | "REJECTED"
    pub privilege_mode: Option<i16>,
}

#[derive(Debug, Deserialize)]
pub struct CreateBotTokenRequest {
    pub label: String,
}

#[derive(Debug, Serialize)]
pub struct CreateBotTokenResponse {
    pub token_id: Uuid,
    pub bot_id: Uuid,
    pub label: String,
    pub token: String,
}

/// Registers a new bot entity (`POST /api/v1/bots`).
///
/// Enforces `INV-15`:
/// - Only platform `dev` can assign `BOT_ADMIN` (`privilege_mode & 8 != 0`).
/// - Bots submitted by non-`dev` users always start as `PENDING` until a `dev`
///   approves them via `/api/v1/dev/bots/{id}/review`.
pub async fn create_bot(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(req): Json<CreateBotRequest>,
) -> Result<(StatusCode, Json<BotRecord>), AppError> {
    let name = validate_bot_name(&req.name)?;
    let display_name = req.display_name.trim();
    if display_name.is_empty() || display_name.len() > 64 {
        return Err(AppError::BadRequest(
            "display_name must be 1-64 characters".to_string(),
        ));
    }

    let mode = req.privilege_mode.unwrap_or(BOT_READ | BOT_WRITE);
    if !(1..=15).contains(&mode) {
        return Err(AppError::BadRequest(
            "privilege_mode must be between 1 and 15".to_string(),
        ));
    }

    let is_dev = auth.platform_role == "dev";
    if has_bot_privilege(mode, BOT_ADMIN) && !is_dev {
        return Err(AppError::Forbidden(
            "only platform 'dev' can assign BOT_ADMIN (bit 8) privilege".to_string(),
        ));
    }

    let bot_id = Uuid::now_v7();
    let approval_status = if is_dev { "APPROVED" } else { "PENDING" };
    let approved_by = if is_dev { Some(auth.user_id) } else { None };
    let approved_at = if is_dev { Some(Utc::now()) } else { None };

    let bot = sqlx::query_as::<_, BotRecord>(
        "INSERT INTO bots (id, owner_id, name, display_name, description, privilege_mode, approval_status, approved_by, approved_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, owner_id, name, display_name, description, privilege_mode,
                   approval_status, approved_by, approved_at, is_active, created_at",
    )
    .bind(bot_id)
    .bind(auth.user_id)
    .bind(&name)
    .bind(display_name)
    .bind(req.description.as_deref().unwrap_or("").trim())
    .bind(mode)
    .bind(approval_status)
    .bind(approved_by)
    .bind(approved_at)
    .fetch_one(&state.pg)
    .await?;

    Ok((StatusCode::CREATED, Json(bot)))
}

/// Lists bots owned by the caller, or all bots when caller is platform `dev`.
pub async fn list_bots(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
) -> Result<Json<Vec<BotRecord>>, AppError> {
    let bots = if auth.platform_role == "dev" {
        sqlx::query_as::<_, BotRecord>(
            "SELECT id, owner_id, name, display_name, description, privilege_mode,
                    approval_status, approved_by, approved_at, is_active, created_at
             FROM bots
             ORDER BY created_at DESC",
        )
        .fetch_all(&state.pg)
        .await?
    } else {
        sqlx::query_as::<_, BotRecord>(
            "SELECT id, owner_id, name, display_name, description, privilege_mode,
                    approval_status, approved_by, approved_at, is_active, created_at
             FROM bots
             WHERE owner_id = $1
             ORDER BY created_at DESC",
        )
        .bind(auth.user_id)
        .fetch_all(&state.pg)
        .await?
    };

    Ok(Json(bots))
}

/// Approves or rejects a bot (`POST /api/v1/dev/bots/{id}/review`, `dev` only, `INV-15`).
pub async fn review_bot(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(bot_id): Path<Uuid>,
    Json(req): Json<ReviewBotRequest>,
) -> Result<Json<BotRecord>, AppError> {
    if auth.platform_role != "dev" {
        return Err(AppError::Forbidden(
            "only platform 'dev' can review bots".to_string(),
        ));
    }

    let decision = match req.decision.trim().to_ascii_uppercase().as_str() {
        "APPROVED" => "APPROVED",
        "REJECTED" => "REJECTED",
        other => {
            return Err(AppError::BadRequest(format!(
                "invalid decision '{other}'; expected APPROVED or REJECTED"
            )));
        }
    };

    if let Some(mode) = req.privilege_mode
        && !(1..=15).contains(&mode)
    {
        return Err(AppError::BadRequest(
            "privilege_mode must be between 1 and 15".to_string(),
        ));
    }

    let bot = sqlx::query_as::<_, BotRecord>(
        "UPDATE bots
         SET approval_status = $1,
             privilege_mode = COALESCE($2, privilege_mode),
             approved_by = $3,
             approved_at = NOW()
         WHERE id = $4
         RETURNING id, owner_id, name, display_name, description, privilege_mode,
                   approval_status, approved_by, approved_at, is_active, created_at",
    )
    .bind(decision)
    .bind(req.privilege_mode)
    .bind(auth.user_id)
    .bind(bot_id)
    .fetch_optional(&state.pg)
    .await?
    .ok_or_else(|| AppError::NotFound("bot not found".to_string()))?;

    // Clear any cached tokens for this bot when its approval status/privilege changes.
    invalidate_bot_token_caches(&state, bot_id).await;

    Ok(Json(bot))
}

/// Issues a long-lived opaque bot token (`POST /api/v1/bots/{id}/tokens`).
/// Enforces `INV-15`: tokens can only be issued for `APPROVED` bots.
pub async fn create_bot_token(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(bot_id): Path<Uuid>,
    Json(req): Json<CreateBotTokenRequest>,
) -> Result<(StatusCode, Json<CreateBotTokenResponse>), AppError> {
    let label = req.label.trim();
    if label.is_empty() || label.len() > 100 {
        return Err(AppError::BadRequest(
            "label must be 1-100 characters".to_string(),
        ));
    }

    let bot = sqlx::query_as::<_, BotRecord>(
        "SELECT id, owner_id, name, display_name, description, privilege_mode,
                approval_status, approved_by, approved_at, is_active, created_at
         FROM bots WHERE id = $1",
    )
    .bind(bot_id)
    .fetch_optional(&state.pg)
    .await?
    .ok_or_else(|| AppError::NotFound("bot not found".to_string()))?;

    if bot.owner_id != Some(auth.user_id) && auth.platform_role != "dev" {
        return Err(AppError::Forbidden("not bot owner".to_string()));
    }

    if bot.approval_status != "APPROVED" || !bot.is_active {
        return Err(AppError::Forbidden(
            "bot must be APPROVED by platform 'dev' before issuing tokens".to_string(),
        ));
    }

    let mut raw_bytes = [0u8; 32];
    OsRng.fill_bytes(&mut raw_bytes);
    let raw_token = format!("bot_{}", hex::encode(raw_bytes));
    let token_hash = hash_token(&raw_token);
    let token_id = Uuid::now_v7();

    sqlx::query(
        "INSERT INTO bot_tokens (id, bot_id, owner_id, label, token_hash)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(token_id)
    .bind(bot_id)
    .bind(auth.user_id)
    .bind(label)
    .bind(&token_hash)
    .execute(&state.pg)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(CreateBotTokenResponse {
            token_id,
            bot_id,
            label: label.to_string(),
            token: raw_token,
        }),
    ))
}

#[derive(Debug, Deserialize)]
pub struct UpdateBotRequest {
    pub display_name: String,
}

/// Updates a bot's display name (`PATCH /api/v1/bots/{id}`).
/// Allowed for the bot owner or platform `dev`.
pub async fn update_bot(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(bot_id): Path<Uuid>,
    Json(req): Json<UpdateBotRequest>,
) -> Result<Json<BotRecord>, AppError> {
    let display_name = req.display_name.trim();
    if display_name.is_empty() || display_name.chars().count() > 64 {
        return Err(AppError::BadRequest(
            "display_name must be 1-64 characters".to_string(),
        ));
    }

    let bot = sqlx::query_as::<_, BotRecord>(
        "UPDATE bots
         SET display_name = $1
         WHERE id = $2
           AND (owner_id = $3 OR $4 = 'dev')
         RETURNING id, owner_id, name, display_name, description, privilege_mode,
                   approval_status, approved_by, approved_at, is_active, created_at",
    )
    .bind(display_name)
    .bind(bot_id)
    .bind(auth.user_id)
    .bind(&auth.platform_role)
    .fetch_optional(&state.pg)
    .await?
    .ok_or_else(|| AppError::NotFound("bot not found".to_string()))?;

    Ok(Json(bot))
}

/// Revokes a bot token (`DELETE /api/v1/bots/{id}/tokens/{token_id}`).
pub async fn revoke_bot_token(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path((bot_id, token_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, AppError> {
    let token_hash: Option<String> = sqlx::query_scalar(
        "UPDATE bot_tokens
         SET revoked_at = NOW()
         WHERE id = $1
           AND bot_id = $2
           AND EXISTS (
               SELECT 1 FROM bots
               WHERE id = $2 AND (owner_id = $3 OR $4 = 'dev')
           )
           AND revoked_at IS NULL
         RETURNING token_hash",
    )
    .bind(token_id)
    .bind(bot_id)
    .bind(auth.user_id)
    .bind(&auth.platform_role)
    .fetch_optional(&state.pg)
    .await?;

    let Some(hash) = token_hash else {
        return Err(AppError::NotFound("bot token not found".to_string()));
    };

    let _ = state
        .valkey
        .del::<i64, _>(format!("bot:token:{hash}"))
        .await;

    Ok(StatusCode::NO_CONTENT)
}

async fn invalidate_bot_token_caches(state: &AppState, bot_id: Uuid) {
    if let Ok(hashes) =
        sqlx::query_scalar::<_, String>("SELECT token_hash FROM bot_tokens WHERE bot_id = $1")
            .bind(bot_id)
            .fetch_all(&state.pg)
            .await
    {
        for hash in hashes {
            let _ = state
                .valkey
                .del::<i64, _>(format!("bot:token:{hash}"))
                .await;
        }
    }
}

fn validate_bot_name(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    let valid_len = (3..=64).contains(&trimmed.len());
    let valid_chars = trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !valid_len || !valid_chars {
        return Err(AppError::BadRequest(
            "bot name must be 3-64 chars (alphanumeric, '_' or '-')".to_string(),
        ));
    }
    Ok(trimmed.to_ascii_lowercase())
}
