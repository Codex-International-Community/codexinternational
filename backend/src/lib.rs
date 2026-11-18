//! Library root exposing backend modules and the Axum router constructor so
//! both `src/main.rs` and `tests/*` integration tests share identical wiring.

use std::sync::Arc;

use axum::{
    Router, middleware,
    routing::{get, post, put},
};

use crate::{
    shared::{cors::cors_middleware, rate_limit::rate_limit_middleware},
    state::AppState,
};

pub mod auth;
pub mod config;
pub mod error;
pub mod health;
pub mod shared;
pub mod state;

/// Builds the main Axum `Router` wired to `AppState`.
pub fn app_router(state: Arc<AppState>) -> Router {
    let api = Router::new()
        .nest("/api/v1/auth", auth::router())
        .nest("/api/v1/bots", auth::bots_router())
        .route("/api/v1/dev/bots/{id}/review", post(auth::bots::review_bot))
        .route("/api/v1/devices/fcm", put(auth::devices::register_fcm))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            rate_limit_middleware,
        ));

    Router::new()
        .route("/health/live", get(health::live))
        .route("/health/ready", get(health::ready))
        .merge(api)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            cors_middleware,
        ))
        .with_state(state)
}
