//! Channel discovery/creation and idempotent direct-message channels.

use std::sync::Arc;

use axum::{Json, extract::{Path, State}, http::StatusCode};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    auth::extractor::AuthUser,
    communities::permissions::{has_permission, PERM_MANAGE_CHANNELS},
    error::AppError,
    state::AppState,
};

#[derive(Debug, Serialize, FromRow)]
pub struct ChannelSummary {
    pub id: Uuid,
    pub community_id: Option<Uuid>,
    pub channel_type: String,
    pub name: Option<String>,
    pub topic: String,
    pub position: i32,
    pub is_private: bool,
    pub last_seq_id: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateChannelRequest {
    pub name: String,
    #[serde(default = "default_channel_type")]
    pub channel_type: String,
    #[serde(default)]
    pub topic: String,
    #[serde(default)]
    pub is_private: bool,
}

#[derive(Debug, Serialize)]
pub struct CreateChannelResponse {
    pub channel: ChannelSummary,
}

#[derive(Debug, Serialize, FromRow)]
pub struct CommunityMemberSummary {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub role_name: String,
    pub online: bool,
}

#[derive(Debug, Serialize)]
pub struct DirectMessageResponse {
    pub channel_id: Uuid,
    pub created: bool,
}

fn default_channel_type() -> String {
    "text".to_string()
}

fn validate_channel_name(raw: &str) -> Result<String, AppError> {
    let name = raw.trim().trim_start_matches('#');
    if name.is_empty()
        || name.chars().count() > 100
        || name.chars().any(char::is_control)
    {
        return Err(AppError::BadRequest(
            "channel name must contain 1-100 printable characters".to_string(),
        ));
    }
    Ok(name.to_string())
}

async fn member_permissions(
    state: &AppState,
    community_id: Uuid,
    user_id: Uuid,
) -> Result<(bool, i64), AppError> {
    let access = sqlx::query_as::<_, (Option<Uuid>, Option<i64>)>(
        "SELECT c.owner_id, r.permissions
         FROM communities c
         LEFT JOIN community_members m
           ON m.community_id = c.id AND m.user_id = $2
         LEFT JOIN community_roles r ON r.id = m.role_id
         WHERE c.id = $1",
    )
    .bind(community_id)
    .bind(user_id)
    .fetch_optional(&state.pg)
    .await?
    .ok_or_else(|| AppError::NotFound("community not found".to_string()))?;

    let is_owner = access.0 == user_id;
    let permissions = access.1.unwrap_or(0);
    if !is_owner && access.1.is_none() {
        return Err(AppError::Forbidden("community membership required".to_string()));
    }
    Ok((is_owner, permissions))
}

pub async fn list_channels(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(community_id): Path<Uuid>,
) -> Result<Json<Vec<ChannelSummary>>, AppError> {
    let (is_owner, permissions) = member_permissions(&state, community_id, auth.user_id).await?;
    if !is_owner && !has_permission(permissions, crate::communities::permissions::PERM_VIEW_CHANNEL) {
        return Err(AppError::Forbidden("missing VIEW_CHANNEL permission".to_string()));
    }

    let channels = sqlx::query_as::<_, ChannelSummary>(
        "SELECT ch.id, ch.community_id, ch.type AS channel_type, ch.name, ch.topic,
                ch.position, ch.is_private, ch.last_seq_id
         FROM channels ch
         WHERE ch.community_id = $1
           AND (
             ch.is_private = FALSE
             OR EXISTS (
               SELECT 1 FROM channel_members cm
               WHERE cm.channel_id = ch.id AND cm.user_id = $2
             )
           )
         ORDER BY ch.position ASC, ch.created_at ASC",
    )
    .bind(community_id)
    .bind(auth.user_id)
    .fetch_all(&state.pg)
    .await?;

    Ok(Json(channels))
}

pub async fn create_channel(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(community_id): Path<Uuid>,
    Json(request): Json<CreateChannelRequest>,
) -> Result<(StatusCode, Json<CreateChannelResponse>), AppError> {
    let name = validate_channel_name(&request.name)?;
    if !matches!(request.channel_type.as_str(), "text" | "announcement") {
        return Err(AppError::BadRequest(
            "channel_type must be 'text' or 'announcement'".to_string(),
        ));
    }
    if request.topic.chars().count() > 1_024 {
        return Err(AppError::BadRequest("channel topic is too long".to_string()));
    }

    let (is_owner, permissions) = member_permissions(&state, community_id, auth.user_id).await?;
    if !is_owner && !has_permission(permissions, PERM_MANAGE_CHANNELS) {
        return Err(AppError::Forbidden("missing MANAGE_CHANNELS permission".to_string()));
    }

    let channel_id = Uuid::now_v7();
    let mut tx = state.pg.begin().await?;
    let next_position = sqlx::query_scalar::<_, i32>(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM channels WHERE community_id = $1",
    )
    .bind(community_id)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO channels (id, community_id, type, name, topic, position, is_private)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(channel_id)
    .bind(community_id)
    .bind(&request.channel_type)
    .bind(&name)
    .bind(request.topic.trim())
    .bind(next_position)
    .bind(request.is_private)
    .execute(&mut *tx)
    .await?;

    if request.is_private {
        sqlx::query("INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)")
            .bind(channel_id)
            .bind(auth.user_id)
            .execute(&mut *tx)
            .await?;
    } else {
        sqlx::query(
            "INSERT INTO channel_members (channel_id, user_id)
             SELECT $1, user_id FROM community_members
             WHERE community_id = $2
             ON CONFLICT (channel_id, user_id) DO NOTHING",
        )
        .bind(channel_id)
        .bind(community_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    Ok((
        StatusCode::CREATED,
        Json(CreateChannelResponse {
            channel: ChannelSummary {
                id: channel_id,
                community_id: Some(community_id),
                channel_type: request.channel_type,
                name: Some(name),
                topic: request.topic.trim().to_string(),
                position: next_position,
                is_private: request.is_private,
                last_seq_id: 0,
            },
        }),
    ))
}

pub async fn list_members(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(community_id): Path<Uuid>,
) -> Result<Json<Vec<CommunityMemberSummary>>, AppError> {
    let (is_owner, permissions) = member_permissions(&state, community_id, auth.user_id).await?;
    if !is_owner
        && !has_permission(
            permissions,
            crate::communities::permissions::PERM_VIEW_CHANNEL,
        )
    {
        return Err(AppError::Forbidden("missing VIEW_CHANNEL permission".to_string()));
    }

    let members = sqlx::query_as::<_, CommunityMemberSummary>(
        "SELECT u.id, u.username,
                COALESCE(m.nickname, u.display_name) AS display_name,
                COALESCE(r.name, '@everyone') AS role_name,
                (u.last_seen_at > NOW() - INTERVAL '90 seconds') AS online
         FROM community_members m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN community_roles r ON r.id = m.role_id
         WHERE m.community_id = $1
         ORDER BY
           CASE WHEN m.user_id = $2 THEN 0 ELSE 1 END,
           lower(COALESCE(m.nickname, u.display_name)) ASC",
    )
    .bind(community_id)
    .bind(auth.user_id)
    .fetch_all(&state.pg)
    .await?;

    Ok(Json(members))
}

pub async fn create_or_get_dm(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(target_user_id): Path<Uuid>,
) -> Result<(StatusCode, Json<DirectMessageResponse>), AppError> {
    if auth.user_id == target_user_id {
        return Err(AppError::BadRequest("cannot create a DM with yourself".to_string()));
    }

    let target_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)",
    )
    .bind(target_user_id)
    .fetch_one(&state.pg)
    .await?;
    if !target_exists {
        return Err(AppError::NotFound("user not found".to_string()));
    }

    let (first, second) = if auth.user_id < target_user_id {
        (auth.user_id, target_user_id)
    } else {
        (target_user_id, auth.user_id)
    };
    let pair_key = format!("{first}:{second}");
    let proposed_id = Uuid::now_v7();

    let mut tx = state.pg.begin().await?;
    let inserted = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO channels (id, community_id, type, name, dm_pair_key)
         VALUES ($1, NULL, 'dm', NULL, $2)
         ON CONFLICT (dm_pair_key) DO NOTHING
         RETURNING id",
    )
    .bind(proposed_id)
    .bind(&pair_key)
    .fetch_optional(&mut *tx)
    .await?;
    let created = inserted.is_some();
    let channel_id = match inserted {
        Some(id) => id,
        None => sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM channels WHERE dm_pair_key = $1",
        )
        .bind(&pair_key)
        .fetch_one(&mut *tx)
        .await?,
    };

    sqlx::query(
        "INSERT INTO channel_members (channel_id, user_id)
         VALUES ($1, $2), ($1, $3)
         ON CONFLICT (channel_id, user_id) DO NOTHING",
    )
    .bind(channel_id)
    .bind(first)
    .bind(second)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok((
        if created { StatusCode::CREATED } else { StatusCode::OK },
        Json(DirectMessageResponse { channel_id, created }),
    ))
}
