use std::{collections::HashMap, sync::Arc};

use axum::{
    body::Body,
    http::{Method, Request, StatusCode},
};
use backend::{
    app_router,
    config::AppConfig,
    social::protocol::{SocialActionKind, SocialActionStreamRecord},
    state::AppState,
};
use tower::ServiceExt;
use uuid::Uuid;

#[test]
fn social_action_stream_record_round_trip() {
    for kind in [
        SocialActionKind::Like,
        SocialActionKind::Repost,
        SocialActionKind::Bookmark,
    ] {
        let rec = SocialActionStreamRecord {
            user_id: Uuid::now_v7(),
            post_id: Uuid::now_v7(),
            kind,
            active: true,
            timestamp_ms: 1_700_000_000_000,
        };
        let json = serde_json::to_string(&rec).expect("serialize");
        let decoded: SocialActionStreamRecord = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(decoded.user_id, rec.user_id);
        assert_eq!(decoded.post_id, rec.post_id);
        assert_eq!(decoded.kind, kind);
        assert!(decoded.active);
    }
}

#[tokio::test]
async fn social_routes_require_auth() {
    let cfg = AppConfig::from_map(&HashMap::new()).expect("dev config");
    let state = Arc::new(AppState::connect_lazy(cfg).expect("lazy state"));
    let app = app_router(state);
    let post_id = Uuid::now_v7();

    let routes = [
        (Method::GET, "/api/v1/social/posts?tab=saved".to_string()),
        (Method::POST, "/api/v1/social/posts".to_string()),
        (Method::GET, "/api/v1/social/bookmarks".to_string()),
        (Method::GET, "/api/v1/social/activity".to_string()),
        (
            Method::POST,
            format!("/api/v1/social/posts/{post_id}/replies"),
        ),
        (Method::DELETE, format!("/api/v1/social/posts/{post_id}")),
        (Method::POST, format!("/api/v1/social/posts/{post_id}/like")),
        (
            Method::POST,
            format!("/api/v1/social/posts/{post_id}/repost"),
        ),
        (
            Method::POST,
            format!("/api/v1/social/posts/{post_id}/bookmark"),
        ),
    ];

    for (method, uri) in routes {
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
            "route {uri} should require auth"
        );
    }

    // Public read-only routes must not reject anonymous requests at auth layer.
    for uri in [
        "/api/v1/social/posts".to_string(),
        format!("/api/v1/social/posts/{post_id}"),
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
            "public read-only route {uri} must not return 401"
        );
    }
}
