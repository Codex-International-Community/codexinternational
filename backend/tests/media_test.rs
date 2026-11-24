use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use backend::{
    app_router,
    config::AppConfig,
    media::{
        AVATAR_MAX_DIMENSION, ImageCompressOptions, QualityTier, compress_image_to_webp,
        generate_r2_key, validate_video_duration_for_tier, verify_webhook_signature,
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
        ("POST", "/api/v1/media/social".to_string()),
        ("POST", "/api/v1/media/avatar".to_string()),
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

#[test]
fn test_compress_image_to_webp_for_avatar() {
    // Minimal valid 2x2 RGBA PNG encoded via `image`? No dev-dep on `image` in Cargo.toml,
    // so use a valid 1x1 PNG byte literal and verify WebP output + invalid input rejection.
    let one_by_one_png: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, // RGBA, CRC
        0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, // IDAT
        0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D,
        0xB4, // IDAT CRC
        0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, // IEND
        0xAE, 0x42, 0x60, 0x82,
    ];

    let opts = ImageCompressOptions {
        max_width: AVATAR_MAX_DIMENSION,
        max_height: AVATAR_MAX_DIMENSION,
    };
    let compressed = compress_image_to_webp(one_by_one_png, opts).expect("compress 1x1 png");
    assert_eq!(compressed.width, 1);
    assert_eq!(compressed.height, 1);
    assert_eq!(compressed.mime_type, "image/webp");
    assert_eq!(compressed.extension, "webp");
    assert!(compressed.bytes.len() >= 12);
    assert_eq!(&compressed.bytes[0..4], b"RIFF");
    assert_eq!(&compressed.bytes[8..12], b"WEBP");

    assert!(compress_image_to_webp(b"not-an-image", opts).is_err());
}
