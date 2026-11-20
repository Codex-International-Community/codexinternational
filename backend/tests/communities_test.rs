//! Route-level guard tests for community endpoints.

use std::{collections::HashMap, sync::Arc};

use axum::{
    body::Body,
    http::{Request, StatusCode, header::AUTHORIZATION},
};
use backend::{app_router, config::AppConfig, state::AppState};
use tower::ServiceExt;

#[tokio::test]
async fn community_routes_require_authentication() {
    let config = AppConfig::from_map(&HashMap::new()).expect("development config");
    let state = Arc::new(AppState::connect_lazy(config).expect("lazy state"));
    let app = app_router(state);

    let routes = [
        ("GET", "/api/v1/communities"),
        ("POST", "/api/v1/communities"),
        ("POST", "/api/v1/communities/join/INVALID"),
        (
            "GET",
            "/api/v1/communities/00000000-0000-0000-0000-000000000001/channels",
        ),
        (
            "GET",
            "/api/v1/communities/00000000-0000-0000-0000-000000000001/members",
        ),
        (
            "POST",
            "/api/v1/communities/00000000-0000-0000-0000-000000000001/channels",
        ),
        ("POST", "/api/v1/dms/00000000-0000-0000-0000-000000000001"),
    ];

    for (method, uri) in routes {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(uri)
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(
            response.status(),
            StatusCode::UNAUTHORIZED,
            "{method} {uri} must reject anonymous callers"
        );
    }
}

#[tokio::test]
async fn community_routes_reject_invalid_bearer_tokens() {
    let config = AppConfig::from_map(&HashMap::new()).expect("development config");
    let state = Arc::new(AppState::connect_lazy(config).expect("lazy state"));
    let app = app_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/communities")
                .header(AUTHORIZATION, "Bearer not-a-valid-jwt")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
