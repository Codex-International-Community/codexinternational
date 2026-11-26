//! Runnable Code Snippets & Diff-First Review attachments for chat & threads.

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
    ai::keys::call_deepseek_chat,
    auth::extractor::{AuthUser, OptionalAuthUser},
    chat::repo::channel_access,
    communities::permissions::PERM_VIEW_CHANNEL,
    error::AppError,
    state::AppState,
};

#[derive(Debug, Serialize, FromRow)]
pub struct CodeSnippet {
    pub id: Uuid,
    pub author_id: Option<Uuid>,
    pub channel_id: Option<Uuid>,
    pub message_id: Option<Uuid>,
    pub post_id: Option<Uuid>,
    pub language: String,
    pub title: String,
    pub code: String,
    pub diff_patch: String,
    pub is_public: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSnippetRequest {
    pub channel_id: Option<Uuid>,
    pub message_id: Option<Uuid>,
    pub post_id: Option<Uuid>,
    pub language: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub diff_patch: String,
    #[serde(default = "default_true")]
    pub is_public: bool,
}

fn default_true() -> bool {
    true
}

/// `POST /api/v1/moat/snippets`
pub async fn create_snippet(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(req): Json<CreateSnippetRequest>,
) -> Result<(StatusCode, Json<CodeSnippet>), AppError> {
    if let Some(cid) = req.channel_id {
        channel_access(&state, cid, auth.user_id, PERM_VIEW_CHANNEL, false).await?;
    }

    let language = req.language.trim().to_ascii_lowercase();
    if language.is_empty() || language.len() > 32 {
        return Err(AppError::BadRequest(
            "language must be 1-32 characters".into(),
        ));
    }
    if req.code.trim().is_empty() && req.diff_patch.trim().is_empty() {
        return Err(AppError::BadRequest(
            "either code or diff_patch must be non-empty".into(),
        ));
    }
    if req.code.len() > 32_768 || req.diff_patch.len() > 32_768 {
        return Err(AppError::PayloadTooLarge(
            "snippet or diff exceeds 32 KB limit".into(),
        ));
    }

    let id = Uuid::now_v7();
    let snippet = sqlx::query_as::<_, CodeSnippet>(
        "INSERT INTO code_snippets
            (id, author_id, channel_id, message_id, post_id, language, title, code, diff_patch, is_public)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *",
    )
    .bind(id)
    .bind(auth.user_id)
    .bind(req.channel_id)
    .bind(req.message_id)
    .bind(req.post_id)
    .bind(&language)
    .bind(req.title.trim())
    .bind(&req.code)
    .bind(&req.diff_patch)
    .bind(req.is_public)
    .fetch_one(&state.pg)
    .await?;

    Ok((StatusCode::CREATED, Json(snippet)))
}

/// `GET /api/v1/moat/snippets/{id}`
pub async fn get_snippet(
    State(state): State<Arc<AppState>>,
    OptionalAuthUser(user): OptionalAuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<CodeSnippet>, AppError> {
    let snippet = sqlx::query_as::<_, CodeSnippet>("SELECT * FROM code_snippets WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pg)
        .await?
        .ok_or_else(|| AppError::NotFound("code snippet not found".into()))?;

    if !snippet.is_public {
        let Some(u) = user else {
            return Err(AppError::Unauthorized("authentication required".into()));
        };
        if let Some(cid) = snippet.channel_id {
            channel_access(&state, cid, u.user_id, PERM_VIEW_CHANNEL, false).await?;
        }
    }

    Ok(Json(snippet))
}

/// `POST /api/v1/moat/snippets/{id}/ai-explain`
pub async fn explain_snippet(
    State(state): State<Arc<AppState>>,
    _auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let snippet = sqlx::query_as::<_, CodeSnippet>("SELECT * FROM code_snippets WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pg)
        .await?
        .ok_or_else(|| AppError::NotFound("code snippet not found".into()))?;

    let system = "Review this code snippet or diff concisely. Point out potential bugs, edge cases, and explain what it does.";
    let prompt = format!(
        "Language: {}\nTitle: {}\nCode:\n{}\nDiff:\n{}",
        snippet.language, snippet.title, snippet.code, snippet.diff_patch
    );

    let ai = call_deepseek_chat(&state, system, &prompt, 900, false).await?;
    Ok(Json(serde_json::json!({
        "snippet_id": snippet.id,
        "explanation": ai.content,
        "model": ai.model
    })))
}
