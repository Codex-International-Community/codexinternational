use std::sync::Arc;

use axum::{
    Router,
    routing::{get, post},
};

use crate::state::AppState;

pub mod flusher;
pub mod handlers;
pub mod protocol;
pub mod repo;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/posts", get(handlers::list_posts).post(handlers::create_post))
        .route("/posts/{id}/replies", post(handlers::create_reply))
        .route("/posts/{id}/like", post(handlers::toggle_like))
        .route("/posts/{id}/repost", post(handlers::toggle_repost))
        .route("/posts/{id}/bookmark", post(handlers::toggle_bookmark))
        .route("/bookmarks", get(handlers::list_bookmarks))
}
