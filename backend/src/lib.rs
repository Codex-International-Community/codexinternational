//! Library root exposing backend modules and the Axum router constructor so
//! both `src/main.rs` and `tests/*` integration tests share identical wiring.

use std::sync::Arc;

use axum::{Router, routing::get};

use crate::state::AppState;

pub mod config;
pub mod health;
pub mod state;

/// Builds the main Axum `Router` wired to `AppState`.
pub fn app_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health/live", get(health::live))
        .route("/health/ready", get(health::ready))
        .with_state(state)
}
