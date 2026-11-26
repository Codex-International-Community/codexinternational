//! Channel <-> Threads Bridge:
//! 1. Open a public/community Threads topic directly from a chat channel.
//! 2. Link a channel to a specific resolution post (`channels.resolution_post_id`).

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    auth::extractor::AuthUser,
    chat::repo::{channel_access, history},
    communities::permissions::{PERM_MANAGE_MESSAGES, PERM_SEND_MESSAGES, PERM_VIEW_CHANNEL},
    error::AppError,
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct OpenThreadFromChannelRequest {
    pub title: Option<String>,
    pub content: Option<String>,
    #[serde(default)]
    pub from_seq: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct OpenThreadFromChannelResponse {
    pub post_id: Uuid,
    pub source_channel_id: Uuid,
    pub content: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct SetChannelResolutionRequest {
    pub post_id: Uuid,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Serialize, FromRow)]
pub struct ChannelResolutionResponse {
    pub channel_id: Uuid,
    pub resolution_post_id: Option<Uuid>,
    pub resolution_note: Option<String>,
    pub post_content: Option<String>,
    pub post_author: Option<String>,
}

/// `POST /api/v1/moat/channels/{channel_id}/open-thread`
/// Creates a Threads post linked back to `source_channel_id` (open topic).
pub async fn open_thread_from_channel(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<OpenThreadFromChannelRequest>,
) -> Result<(StatusCode, Json<OpenThreadFromChannelResponse>), AppError> {
    let last_seq =
        channel_access(&state, channel_id, auth.user_id, PERM_SEND_MESSAGES, true).await?;

    let mut body = req
        .content
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    if body.is_none() {
        let after_seq = req.from_seq.unwrap_or_else(|| (last_seq - 15).max(0));
        let msgs = history(&state, channel_id, after_seq, 15).await?;
        let excerpt = msgs
            .iter()
            .filter(|m| !m.text.trim().is_empty())
            .map(|m| format!("{}: {}", m.author, m.text.trim()))
            .collect::<Vec<_>>()
            .join("\n");
        if !excerpt.is_empty() {
            body = Some(excerpt);
        }
    }

    let raw_body = body.ok_or_else(|| {
        AppError::BadRequest("content or channel messages required to open a thread".into())
    })?;

    let full_content = match req
        .title
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(title) => format!("{title}\n\n{raw_body}"),
        None => raw_body,
    };
    let final_content: String = full_content.chars().take(500).collect();

    let post_id = Uuid::now_v7();
    let created_at = sqlx::query_scalar::<_, DateTime<Utc>>(
        "INSERT INTO posts (id, user_id, content, source_channel_id)
         VALUES ($1, $2, $3, $4)
         RETURNING created_at",
    )
    .bind(post_id)
    .bind(auth.user_id)
    .bind(&final_content)
    .bind(channel_id)
    .fetch_one(&state.pg)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(OpenThreadFromChannelResponse {
            post_id,
            source_channel_id: channel_id,
            content: final_content,
            created_at,
        }),
    ))
}

/// `PUT /api/v1/moat/channels/{channel_id}/resolution`
/// Links a channel to a Threads resolution post (`channels.resolution_post_id`).
pub async fn set_channel_resolution(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<SetChannelResolutionRequest>,
) -> Result<Json<ChannelResolutionResponse>, AppError> {
    channel_access(
        &state,
        channel_id,
        auth.user_id,
        PERM_MANAGE_MESSAGES,
        false,
    )
    .await?;

    let post_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM posts WHERE id = $1)")
        .bind(req.post_id)
        .fetch_one(&state.pg)
        .await?;
    if !post_exists {
        return Err(AppError::NotFound("resolution post not found".into()));
    }

    let note: String = req.note.trim().chars().take(300).collect();
    sqlx::query(
        "UPDATE channels
         SET resolution_post_id = $2,
             resolution_note = NULLIF($3, '')
         WHERE id = $1",
    )
    .bind(channel_id)
    .bind(req.post_id)
    .bind(&note)
    .execute(&state.pg)
    .await?;

    get_channel_resolution(State(state), auth, Path(channel_id)).await
}

/// `DELETE /api/v1/moat/channels/{channel_id}/resolution`
pub async fn clear_channel_resolution(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    channel_access(
        &state,
        channel_id,
        auth.user_id,
        PERM_MANAGE_MESSAGES,
        false,
    )
    .await?;
    sqlx::query(
        "UPDATE channels
         SET resolution_post_id = NULL, resolution_note = NULL
         WHERE id = $1",
    )
    .bind(channel_id)
    .execute(&state.pg)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// `GET /api/v1/moat/channels/{channel_id}/resolution`
pub async fn get_channel_resolution(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<ChannelResolutionResponse>, AppError> {
    channel_access(&state, channel_id, auth.user_id, PERM_VIEW_CHANNEL, false).await?;

    let row = sqlx::query_as::<_, ChannelResolutionResponse>(
        "SELECT ch.id AS channel_id,
                ch.resolution_post_id,
                ch.resolution_note,
                p.content AS post_content,
                u.display_name AS post_author
         FROM channels ch
         LEFT JOIN posts p ON p.id = ch.resolution_post_id
         LEFT JOIN users u ON u.id = p.user_id
         WHERE ch.id = $1",
    )
    .bind(channel_id)
    .fetch_optional(&state.pg)
    .await?
    .ok_or_else(|| AppError::NotFound("channel not found".into()))?;

    Ok(Json(row))
}
