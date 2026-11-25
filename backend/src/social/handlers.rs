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
use crate::{
    auth::extractor::{AuthUser, OptionalAuthUser},
    error::AppError,
    state::AppState,
};

pub async fn list_posts(
    State(state): State<Arc<AppState>>,
    OptionalAuthUser(user): OptionalAuthUser,
    Query(query): Query<ListPostsQuery>,
) -> Result<impl IntoResponse, AppError> {
    if query.tab.as_deref() == Some("saved") && user.is_none() {
        return Err(AppError::Unauthorized(
            "authentication required to view saved posts".into(),
        ));
    }
    let viewer_id = user.map(|u| u.user_id).unwrap_or(Uuid::nil());
    let posts = repo::list_posts(
        &state,
        viewer_id,
        query.tab.as_deref(),
        query.limit.unwrap_or(50),
        None,
    )
    .await?;
    Ok(Json(posts))
}

pub async fn get_post(
    State(state): State<Arc<AppState>>,
    OptionalAuthUser(user): OptionalAuthUser,
    Path(post_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let viewer_id = user.map(|u| u.user_id).unwrap_or(Uuid::nil());
    let mut posts = repo::list_posts(&state, viewer_id, None, 1, Some(post_id)).await?;
    let post = posts
        .pop()
        .ok_or_else(|| AppError::NotFound("post not found".into()))?;
    Ok(Json(post))
}

pub async fn list_bookmarks(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Query(query): Query<ListPostsQuery>,
) -> Result<impl IntoResponse, AppError> {
    let posts = repo::list_posts(
        &state,
        user.user_id,
        Some("saved"),
        query.limit.unwrap_or(50),
        None,
    )
    .await?;
    Ok(Json(posts))
}

pub async fn list_activity(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let items = repo::list_activity(&state, user.user_id, 25).await?;
    Ok(Json(items))
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

pub async fn delete_post(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(post_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    repo::delete_post(&state, user.user_id, post_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_reply(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(reply_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    repo::delete_reply(&state, user.user_id, reply_id).await?;
    Ok(StatusCode::NO_CONTENT)
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
