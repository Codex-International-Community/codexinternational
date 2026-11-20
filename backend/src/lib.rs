//! Library root exposing backend modules and the Axum router constructor so
//! both `src/main.rs` and `tests/*` integration tests share identical wiring.

use std::{sync::Arc, time::Duration};

use axum::{
    Json, Router,
    body::Body,
    extract::DefaultBodyLimit,
    http::{Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post, put},
};

use crate::{
    shared::{cors::cors_middleware, rate_limit::rate_limit_middleware},
    state::AppState,
};

pub mod auth;
pub mod chat;
pub mod communities;
pub mod config;
pub mod error;
pub mod gamification;
pub mod health;
pub mod media;
pub mod shared;
pub mod state;

pub const REST_BODY_LIMIT_BYTES: usize = 64 * 1024;
pub const REST_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

/// Applies a bounded HTTP request timeout to REST `/api/v1/*` routes while
/// leaving `/ws` WebSocket upgrades exempt (`INV-14`).
pub async fn timeout_middleware_with(
    duration: Duration,
    req: Request<Body>,
    next: Next,
) -> Response {
    match tokio::time::timeout(duration, next.run(req)).await {
        Ok(resp) => resp,
        Err(_) => (
            StatusCode::REQUEST_TIMEOUT,
            Json(serde_json::json!({
                "error": {
                    "code": "REQUEST_TIMEOUT",
                    "message": "request timed out"
                }
            })),
        )
            .into_response(),
    }
}

async fn rest_timeout_middleware(req: Request<Body>, next: Next) -> Response {
    timeout_middleware_with(REST_REQUEST_TIMEOUT, req, next).await
}

/// Builds the main Axum `Router` wired to `AppState`.
pub fn app_router(state: Arc<AppState>) -> Router {
    let api = Router::new()
        .nest("/api/v1/auth", auth::router())
        .nest("/api/v1/bots", auth::bots_router())
        .nest("/api/v1/communities", communities::router())
        .nest("/api/v1/dms", communities::dms_router())
        .nest("/api/v1", chat::router())
        .route("/api/v1/media/presign", post(media::presign))
        .route("/api/v1/media/{id}/complete", post(media::complete))
        .route(
            "/api/v1/media",
            post(media::upload).layer(DefaultBodyLimit::max(media::MAX_CHAT_UPLOAD_BYTES)),
        )
        .route("/api/v1/dev/bots/{id}/review", post(auth::bots::review_bot))
        .route(
            "/api/v1/dev/uid-slots",
            get(auth::uid::list_reserved_uid_slots),
        )
        .route(
            "/api/v1/dev/users/{id}/assign-uid",
            post(auth::uid::assign_reserved_uid),
        )
        .route(
            "/api/v1/dev/on-duty/start",
            post(auth::dev_governance::start_on_duty),
        )
        .route(
            "/api/v1/dev/on-duty/stop",
            post(auth::dev_governance::stop_on_duty),
        )
        .route(
            "/api/v1/dev/audit-logs",
            get(auth::dev_governance::list_dev_audit_logs),
        )
        .route(
            "/api/v1/communities/{id}/audit-logs",
            get(auth::dev_governance::list_community_audit_logs),
        )
        .route("/api/v1/devices/fcm", put(auth::devices::register_fcm))
        .layer(DefaultBodyLimit::max(REST_BODY_LIMIT_BYTES))
        .layer(middleware::from_fn(rest_timeout_middleware));

    Router::new()
        .route("/ws", get(chat::ws::upgrade))
        .route("/health/live", get(health::live))
        .route("/health/ready", get(health::ready))
        .merge(api)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            rate_limit_middleware,
        ))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            cors_middleware,
        ))
        .with_state(state)
}
