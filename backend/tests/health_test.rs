//! Integration tests for `/health/live` and `/health/ready` probes (Task 0.3).

use std::{collections::HashMap, sync::Arc};

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use backend::{app_router, config::AppConfig, state::AppState};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

#[tokio::test]
async fn test_health_live_returns_200_ok() {
    let cfg = AppConfig::from_map(&HashMap::new()).expect("dev config");
    let state = Arc::new(AppState::connect_lazy(cfg).expect("lazy state"));
    let app = app_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/health/live")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["status"], "ok");
}

#[tokio::test]
async fn test_health_ready_returns_503_when_dependencies_are_down() {
    let mut env_map = HashMap::new();
    // Point to closed local ports so readiness probe deterministically detects down state.
    env_map.insert("DATABASE_URL", "postgres://codex:bad@127.0.0.1:59991/none");
    env_map.insert("VALKEY_URL", "valkey://127.0.0.1:59992");

    let cfg = AppConfig::from_map(&env_map).expect("dev config");
    let state = Arc::new(AppState::connect_lazy(cfg).expect("lazy state"));
    let app = app_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/health/ready")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["status"], "degraded");
    assert_eq!(json["postgres"], "down");
    assert_eq!(json["valkey"], "down");
}

#[tokio::test]
async fn test_cors_allowlist_permits_dev_origin_and_blocks_unknown_origin() {
    let cfg = AppConfig::from_map(&HashMap::new()).expect("dev config");
    let state = Arc::new(AppState::connect_lazy(cfg).expect("lazy state"));
    let app = app_router(state);

    let allowed = app
        .clone()
        .oneshot(
            Request::builder()
                .method("OPTIONS")
                .uri("/api/v1/auth/login")
                .header("Origin", "http://127.0.0.1:5173")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(allowed.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        allowed
            .headers()
            .get("access-control-allow-origin")
            .and_then(|v| v.to_str().ok()),
        Some("http://127.0.0.1:5173")
    );

    let disallowed = app
        .oneshot(
            Request::builder()
                .method("OPTIONS")
                .uri("/api/v1/auth/login")
                .header("Origin", "https://evil.example")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(disallowed.status(), StatusCode::NO_CONTENT);
    assert!(
        disallowed
            .headers()
            .get("access-control-allow-origin")
            .is_none()
    );
}
