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
    routing::{get, patch, post, put},
};

use crate::{
    shared::{cors::cors_middleware, rate_limit::rate_limit_middleware},
    state::AppState,
};

pub mod ai;
pub mod auth;
pub mod chat;
pub mod communities;
pub mod config;
pub mod error;
pub mod friends;
pub mod gamification;
pub mod health;
pub mod media;
pub mod moat;
pub mod shared;
pub mod social;
pub mod state;
pub mod stickers;

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
        .nest("/api/v1/ai", ai::router())
        .nest("/api/v1/moat", moat::router())
        .nest("/api/v1/dev/ai", ai::dev_router())
        .nest("/api/v1/auth", auth::router())
        .nest("/api/v1/bots", auth::bots_router())
        .nest("/api/v1/communities", communities::router())
        .nest("/api/v1/dms", communities::dms_router())
        .nest("/api/v1/friends", friends::router())
        .nest("/api/v1/social", social::router())
        .nest("/api/v1/stickers", stickers::router())
        .nest("/api/v1", chat::router())
        .nest("/api/v1/media", media::router())
        .route(
            "/internal/v1/media/ready",
            post(media::internal_media_ready),
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
            "/api/v1/dev/on-duty/active",
            get(auth::dev_governance::list_active_on_duty),
        )
        .route(
            "/api/v1/dev/root-key/verify",
            post(auth::dev_governance::verify_root_key),
        )
        .route(
            "/api/v1/dev/users",
            get(auth::dev_governance::search_dev_users),
        )
        .route(
            "/api/v1/dev/users/{id}/verified",
            patch(auth::dev_governance::set_user_verified),
        )
        .route(
            "/api/v1/dev/users/{id}/governance",
            patch(auth::dev_governance::update_user_governance),
        )
        .route(
            "/api/v1/dev/users/{id}/suspend",
            post(auth::dev_governance::suspend_user),
        )
        .route(
            "/api/v1/dev/users/{id}/unsuspend",
            post(auth::dev_governance::unsuspend_user),
        )
        .route(
            "/api/v1/dev/users/{id}/ban",
            post(auth::dev_governance::ban_user),
        )
        .route(
            "/api/v1/dev/users/{id}/unban",
            post(auth::dev_governance::unban_user),
        )
        .route(
            "/api/v1/dev/social/posts/{id}/delete",
            post(auth::dev_governance::dev_delete_social_post),
        )
        .route(
            "/api/v1/dev/social/replies/{id}/delete",
            post(auth::dev_governance::dev_delete_social_reply),
        )
        .route(
            "/api/v1/dev/chat/messages/{id}/delete",
            post(auth::dev_governance::dev_delete_chat_message),
        )
        .route(
            "/api/v1/reports",
            post(auth::dev_governance::create_content_report),
        )
        .route(
            "/api/v1/dev/reports",
            get(auth::dev_governance::list_dev_reports),
        )
        .route(
            "/api/v1/dev/reports/{id}/resolve",
            post(auth::dev_governance::resolve_dev_report),
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
