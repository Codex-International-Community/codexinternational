//! Tests for Moat features: Solved-to-Wiki slug/tags, Builder Profile,
//! Code Snippets/Diff, and Skill Radar route guards.

use std::{collections::HashMap, sync::Arc};

use axum::{
    body::Body,
    http::{Method, Request, StatusCode},
};
use backend::{
    app_router,
    config::AppConfig,
    moat::wiki::{make_wiki_slug, normalize_tags},
    state::AppState,
};
use tower::ServiceExt;
use uuid::Uuid;

#[test]
fn test_wiki_slug_and_tag_normalization() {
    let id = Uuid::now_v7();
    let slug = make_wiki_slug("Cara Fix Valkey Cold-Start & Async Rust!", id);
    assert!(slug.starts_with("cara-fix-valkey-cold-start-async-rust-"));

    let tags = normalize_tags(&[
        " #Rust ".into(),
        "rust".into(),
        "Valkey".into(),
        "".into(),
        "#axum".into(),
    ]);
    assert_eq!(tags, vec!["rust", "valkey", "axum"]);
}

#[tokio::test]
async fn test_moat_auth_and_public_readonly_guards() {
    let cfg = AppConfig::from_map(&HashMap::new()).expect("dev config");
    let state = Arc::new(AppState::connect_lazy(cfg).expect("lazy state"));
    let app = app_router(state);
    let id = Uuid::now_v7();

    // Protected write/personal endpoints must reject anonymous callers.
    let auth_required = [
        (Method::POST, format!("/api/v1/moat/wiki/from-channel/{id}")),
        (Method::POST, format!("/api/v1/moat/wiki/from-post/{id}")),
        (Method::POST, "/api/v1/moat/snippets".to_string()),
        (
            Method::POST,
            format!("/api/v1/moat/snippets/{id}/ai-explain"),
        ),
        (Method::GET, "/api/v1/moat/skills/me".to_string()),
        (Method::PUT, "/api/v1/moat/skills/me".to_string()),
        (Method::POST, "/api/v1/moat/radar/questions".to_string()),
        (
            Method::POST,
            format!("/api/v1/moat/radar/questions/{id}/solve"),
        ),
        (
            Method::POST,
            format!("/api/v1/moat/channels/{id}/open-thread"),
        ),
        (
            Method::GET,
            format!("/api/v1/moat/channels/{id}/resolution"),
        ),
        (
            Method::PUT,
            format!("/api/v1/moat/channels/{id}/resolution"),
        ),
        (
            Method::DELETE,
            format!("/api/v1/moat/channels/{id}/resolution"),
        ),
    ];

    for (method, uri) in auth_required {
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(&uri)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::UNAUTHORIZED,
            "route {uri} must require auth"
        );
    }

    // Public read-only endpoints must NOT reject anonymous callers at auth layer.
    for uri in [
        "/api/v1/moat/wiki".to_string(),
        "/api/v1/moat/builders/raqilla".to_string(),
        "/api/v1/moat/radar/questions".to_string(),
    ] {
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(&uri)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_ne!(
            resp.status(),
            StatusCode::UNAUTHORIZED,
            "public route {uri} must not return 401"
        );
    }
}
