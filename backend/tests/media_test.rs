use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use backend::{app_router, config::AppConfig, media::generate_r2_key, state::AppState};
use std::{collections::HashMap, sync::Arc};
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn media_routes_reject_anonymous_requests() {
    let config = AppConfig::from_map(&HashMap::new()).expect("development config");
    let state = Arc::new(AppState::connect_lazy(config).expect("lazy state"));
    let app = app_router(state);

    for (method, path) in [
        ("POST", "/api/v1/media/presign".to_string()),
        (
            "POST",
            "/api/v1/media/00000000-0000-0000-0000-000000000001/complete".to_string(),
        ),
        ("POST", "/api/v1/media".to_string()),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
}

#[test]
fn test_generate_r2_key_matches_prd_hierarchy() {
    let user_id = Uuid::now_v7();
    let media_id = Uuid::now_v7();

    let image_key = generate_r2_key("chat", user_id, media_id, "image", "avif");
    assert!(image_key.starts_with("compressed/images/"));
    assert!(image_key.ends_with(".avif"));

    let video_key = generate_r2_key("chat", user_id, media_id, "video", "mp4");
    assert!(video_key.starts_with("raw/videos/"));
    assert!(video_key.ends_with(".mp4"));

    let file_key = generate_r2_key("chat", user_id, media_id, "file", "pdf");
    assert!(file_key.starts_with(&format!("attachments/{user_id}/")));
    assert!(file_key.ends_with(".pdf"));

    let avatar_key = generate_r2_key("avatar", user_id, media_id, "image", "webp");
    assert_eq!(
        avatar_key,
        format!("compressed/avatars/{user_id}/{media_id}.webp")
    );
}
