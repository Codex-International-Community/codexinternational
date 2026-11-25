//! Community-level moderation handlers (`timeout`, `ban`, `unban`) enforcing
//! `PERM_MODERATE_MEMBERS`, role hierarchy, and `Superadmin` protection (`INV-15`).

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use fred::interfaces::{KeysInterface, PubsubInterface};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    auth::extractor::AuthUser,
    communities::permissions::{PERM_MODERATE_MEMBERS, has_permission},
    error::AppError,
    state::AppState,
};

const DEFAULT_TIMEOUT_SECS: i64 = 600;
const MIN_TIMEOUT_SECS: i64 = 60;
const MAX_TIMEOUT_SECS: i64 = 28 * 24 * 3600;

#[derive(Debug, Deserialize)]
pub struct TimeoutMemberRequest {
    pub duration_secs: Option<i64>,
    #[allow(dead_code)]
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TimeoutMemberResponse {
    pub community_id: Uuid,
    pub user_id: Uuid,
    pub timed_out_until: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct BanMemberRequest {
    #[serde(default)]
    pub reason: String,
    pub expires_in_secs: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct BanMemberResponse {
    pub community_id: Uuid,
    pub user_id: Uuid,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
pub struct UnbanMemberResponse {
    pub community_id: Uuid,
    pub user_id: Uuid,
    pub unbanned: bool,
}

struct ModerationContext {
    is_actor_owner: bool,
    actor_pos: i32,
    actor_perms: i64,
    is_target_owner: bool,
    target_pos: Option<i32>,
}

async fn load_moderation_context(
    state: &AppState,
    community_id: Uuid,
    actor_id: Uuid,
    target_id: Uuid,
) -> Result<ModerationContext, AppError> {
    if actor_id == target_id {
        return Err(AppError::BadRequest(
            "cannot moderate your own account".to_string(),
        ));
    }

    let row = sqlx::query_as::<_, (Option<Uuid>, Option<i32>, Option<i64>, Option<i32>)>(
        "SELECT c.owner_id, ar.position, ar.permissions, tr.position
         FROM communities c
         LEFT JOIN community_members am ON am.community_id = c.id AND am.user_id = $2
         LEFT JOIN community_roles ar ON ar.id = am.role_id
         LEFT JOIN community_members tm ON tm.community_id = c.id AND tm.user_id = $3
         LEFT JOIN community_roles tr ON tr.id = tm.role_id
         WHERE c.id = $1",
    )
    .bind(community_id)
    .bind(actor_id)
    .bind(target_id)
    .fetch_optional(&state.pg)
    .await?
    .ok_or_else(|| AppError::NotFound("community not found".to_string()))?;

    let is_actor_owner = row.0 == Some(actor_id);
    if !is_actor_owner && row.1.is_none() {
        return Err(AppError::Forbidden(
            "community membership required".to_string(),
        ));
    }

    Ok(ModerationContext {
        is_actor_owner,
        actor_pos: row.1.unwrap_or(0),
        actor_perms: row.2.unwrap_or(0),
        is_target_owner: row.0 == Some(target_id),
        target_pos: row.3,
    })
}

fn ensure_can_moderate(ctx: &ModerationContext) -> Result<(), AppError> {
    if !ctx.is_actor_owner && !has_permission(ctx.actor_perms, PERM_MODERATE_MEMBERS) {
        return Err(AppError::Forbidden(
            "missing MODERATE_MEMBERS permission".to_string(),
        ));
    }
    if ctx.is_target_owner {
        return Err(AppError::Forbidden(
            "cannot moderate community Superadmin".to_string(),
        ));
    }
    if !ctx.is_actor_owner
        && let Some(target_pos) = ctx.target_pos
        && target_pos >= ctx.actor_pos
    {
        return Err(AppError::Forbidden(
            "cannot moderate member with equal or higher role".to_string(),
        ));
    }
    Ok(())
}

/// `POST /api/v1/communities/{community_id}/members/{user_id}/timeout`
pub async fn timeout_member(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path((community_id, target_user_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<TimeoutMemberRequest>,
) -> Result<Json<TimeoutMemberResponse>, AppError> {
    let ctx = load_moderation_context(&state, community_id, auth.user_id, target_user_id).await?;
    ensure_can_moderate(&ctx)?;

    let secs = req
        .duration_secs
        .unwrap_or(DEFAULT_TIMEOUT_SECS)
        .clamp(MIN_TIMEOUT_SECS, MAX_TIMEOUT_SECS);
    let until = Utc::now() + ChronoDuration::seconds(secs);

    let res = sqlx::query(
        "UPDATE community_members
         SET timed_out_until = $3
         WHERE community_id = $1 AND user_id = $2",
    )
    .bind(community_id)
    .bind(target_user_id)
    .bind(until)
    .execute(&state.pg)
    .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(
            "target user is not a member of this community".to_string(),
        ));
    }

    let key = format!("timeout:comm:{community_id}:{target_user_id}");
    let _: Result<(), _> = state
        .valkey
        .set(
            &key,
            until.timestamp().to_string(),
            Some(fred::types::Expiration::EX(secs)),
            None,
            false,
        )
        .await;

    Ok(Json(TimeoutMemberResponse {
        community_id,
        user_id: target_user_id,
        timed_out_until: until,
    }))
}

/// `DELETE /api/v1/communities/{community_id}/members/{user_id}/timeout`
pub async fn clear_timeout_member(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path((community_id, target_user_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, AppError> {
    let ctx = load_moderation_context(&state, community_id, auth.user_id, target_user_id).await?;
    ensure_can_moderate(&ctx)?;

    let res = sqlx::query(
        "UPDATE community_members
         SET timed_out_until = NULL
         WHERE community_id = $1 AND user_id = $2",
    )
    .bind(community_id)
    .bind(target_user_id)
    .execute(&state.pg)
    .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(
            "target user is not a member of this community".to_string(),
        ));
    }

    let key = format!("timeout:comm:{community_id}:{target_user_id}");
    let _: Result<i64, _> = state.valkey.del(&key).await;

    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/v1/communities/{community_id}/members/{user_id}/ban`
pub async fn ban_member(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path((community_id, target_user_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<BanMemberRequest>,
) -> Result<Json<BanMemberResponse>, AppError> {
    let ctx = load_moderation_context(&state, community_id, auth.user_id, target_user_id).await?;
    ensure_can_moderate(&ctx)?;

    let expires_at = req
        .expires_in_secs
        .map(|s| Utc::now() + ChronoDuration::seconds(s.max(60)));
    let reason = req.reason.trim().chars().take(500).collect::<String>();

    let mut tx = state.pg.begin().await?;

    sqlx::query(
        "INSERT INTO community_bans (community_id, user_id, banned_by_user_id, reason, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (community_id, user_id)
         DO UPDATE SET banned_by_user_id = EXCLUDED.banned_by_user_id,
                       reason = EXCLUDED.reason,
                       expires_at = EXCLUDED.expires_at,
                       created_at = NOW()",
    )
    .bind(community_id)
    .bind(target_user_id)
    .bind(auth.user_id)
    .bind(&reason)
    .bind(expires_at)
    .execute(&mut *tx)
    .await?;

    let channel_ids: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM channels WHERE community_id = $1")
            .bind(community_id)
            .fetch_all(&mut *tx)
            .await?;

    sqlx::query(
        "DELETE FROM channel_members
         WHERE user_id = $1 AND channel_id IN (SELECT id FROM channels WHERE community_id = $2)",
    )
    .bind(target_user_id)
    .bind(community_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query("DELETE FROM community_members WHERE community_id = $1 AND user_id = $2")
        .bind(community_id)
        .bind(target_user_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    let _: Result<i64, _> = state
        .valkey
        .del(format!("perm:comm:{community_id}:{target_user_id}"))
        .await;
    let _: Result<i64, _> = state
        .valkey
        .del(format!("timeout:comm:{community_id}:{target_user_id}"))
        .await;

    let kick_event = serde_json::json!({
        "type": "USER_KICKED",
        "communityId": community_id,
        "userId": target_user_id,
    })
    .to_string();
    for ch_id in channel_ids {
        let _: Result<i64, _> = state
            .valkey
            .next()
            .publish(format!("pubsub:ch:{ch_id}"), kick_event.clone())
            .await;
    }

    Ok(Json(BanMemberResponse {
        community_id,
        user_id: target_user_id,
        expires_at,
    }))
}

/// `DELETE /api/v1/communities/{community_id}/bans/{user_id}`
pub async fn unban_member(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path((community_id, target_user_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<UnbanMemberResponse>, AppError> {
    let ctx = load_moderation_context(&state, community_id, auth.user_id, target_user_id).await?;
    ensure_can_moderate(&ctx)?;

    let res = sqlx::query("DELETE FROM community_bans WHERE community_id = $1 AND user_id = $2")
        .bind(community_id)
        .bind(target_user_id)
        .execute(&state.pg)
        .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(
            "no active ban found for this user".to_string(),
        ));
    }

    Ok(Json(UnbanMemberResponse {
        community_id,
        user_id: target_user_id,
        unbanned: true,
    }))
}
