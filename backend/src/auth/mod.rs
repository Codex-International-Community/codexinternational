//! Authentication module: password hashing, JWT tokens, extractors, and routes.

pub mod extractor;
pub mod handlers;
pub mod jwt;
pub mod password;
pub mod repo;

use std::sync::Arc;

use axum::{
    Router,
    routing::{get, post},
};

use crate::state::AppState;

/// Mounts `/api/v1/auth/*` routes onto the application router.
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/register", post(handlers::register))
        .route("/login", post(handlers::login))
        .route("/me", get(handlers::me))
}
