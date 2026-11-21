use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use backend::{
    app_router,
    config::AppConfig,
    media::{
        QualityTier, generate_r2_key, validate_video_duration_for_tier, verify_webhook_signature,
    },
    state::AppState,
};
use hmac::{Hmac, Mac};
use sha2::Sha256;
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

#[test]
fn test_quality_tier_and_video_duration_limits() {
    let std_tier = QualityTier::parse(Some("standard")).expect("standard");
    let pro_tier = QualityTier::parse(Some("pro")).expect("pro");
    assert!(QualityTier::parse(Some("ultra")).is_err());

    assert_eq!(std_tier.max_video_duration_secs(), 180);
    assert_eq!(pro_tier.max_video_duration_secs(), 300);
    assert_eq!(std_tier.max_video_bytes(), 50 * 1024 * 1024);
    assert_eq!(pro_tier.max_video_bytes(), 200 * 1024 * 1024);

    assert!(validate_video_duration_for_tier(QualityTier::Standard, Some(180)).is_ok());
    assert!(validate_video_duration_for_tier(QualityTier::Standard, Some(181)).is_err());
    assert!(validate_video_duration_for_tier(QualityTier::Pro, Some(300)).is_ok());
    assert!(validate_video_duration_for_tier(QualityTier::Pro, Some(301)).is_err());
    assert!(validate_video_duration_for_tier(QualityTier::Pro, Some(0)).is_err());
}

#[test]
fn test_inv8_hmac_webhook_verification() {
    let secret = "super-secret-lambda-key-at-least-32-chars";
    let body = br#"{"mediaId":"00000000-0000-0000-0000-000000000001","status":"READY"}"#;
    let now = 1_700_000_000i64;
    let ts_str = now.to_string();

    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("hmac");
    mac.update(ts_str.as_bytes());
    mac.update(b".");
    mac.update(body);
    let sig_header = format!("sha256={}", hex::encode(mac.finalize().into_bytes()));

    assert!(
        verify_webhook_signature(secret, Some(&ts_str), Some(&sig_header), body, now + 60).is_ok()
    );
    assert!(
        verify_webhook_signature(secret, Some(&ts_str), Some(&sig_header), body, now + 301)
            .is_err()
    );
    assert!(
        verify_webhook_signature(secret, Some(&ts_str), Some("sha256=deadbeef"), body, now)
            .is_err()
    );
}
