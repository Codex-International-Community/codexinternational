//! Library root exposing backend modules and the Axum router constructor so
//! both `src/main.rs` and `tests/*` integration tests share identical wiring.

use std::sync::Arc;

use axum::{
    Router,
    routing::{get, put},
};

use crate::state::AppState;

pub mod auth;
pub mod config;
pub mod error;
pub mod health;
pub mod shared;
pub mod state;

/// Builds the main Axum `Router` wired to `AppState`.
pub fn app_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health/live", get(health::live))
        .route("/health/ready", get(health::ready))
        .nest("/api/v1/auth", auth::router())
        .route("/api/v1/devices/fcm", put(auth::devices::register_fcm))
        .with_state(state)
}
