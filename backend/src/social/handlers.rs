use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
};
use uuid::Uuid;

use super::{
    protocol::{CreatePostRequest, CreateReplyRequest, ListPostsQuery, SocialActionKind},
    repo,
};
use crate::{auth::extractor::AuthUser, error::AppError, state::AppState};

pub async fn list_posts(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Query(query): Query<ListPostsQuery>,
) -> Result<impl IntoResponse, AppError> {
    let posts = repo::list_posts(
        &state,
        user.user_id,
        query.tab.as_deref(),
        query.limit.unwrap_or(50),
    )
    .await?;
    Ok(Json(posts))
}

pub async fn list_bookmarks(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Query(query): Query<ListPostsQuery>,
) -> Result<impl IntoResponse, AppError> {
    let posts =
        repo::list_posts(&state, user.user_id, Some("saved"), query.limit.unwrap_or(50)).await?;
    Ok(Json(posts))
}

pub async fn create_post(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(req): Json<CreatePostRequest>,
) -> Result<impl IntoResponse, AppError> {
    let post = repo::create_post(&state, user.user_id, req).await?;
    Ok((StatusCode::CREATED, Json(post)))
}

pub async fn create_reply(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(post_id): Path<Uuid>,
    Json(req): Json<CreateReplyRequest>,
) -> Result<impl IntoResponse, AppError> {
    let reply = repo::create_reply(&state, user.user_id, post_id, req).await?;
    Ok((StatusCode::CREATED, Json(reply)))
}

pub async fn toggle_like(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(post_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let res = repo::toggle_action(&state, user.user_id, post_id, SocialActionKind::Like).await?;
    Ok(Json(res))
}

pub async fn toggle_repost(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(post_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let res = repo::toggle_action(&state, user.user_id, post_id, SocialActionKind::Repost).await?;
    Ok(Json(res))
}

pub async fn toggle_bookmark(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(post_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let res =
        repo::toggle_action(&state, user.user_id, post_id, SocialActionKind::Bookmark).await?;
    Ok(Json(res))
}
