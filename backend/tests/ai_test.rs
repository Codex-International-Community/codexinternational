//! Tests for AI Native module: DeepSeek v4.1 Flash multi-key masking,
//! add-on pricing/tier quotas, semantic keyword extraction, and route auth.

use std::{collections::HashMap, sync::Arc};

use axum::{
    body::Body,
    http::{Method, Request, StatusCode},
};
use backend::{
    ai::{
        features::extract_keywords,
        keys::mask_api_key,
        quotas::{DEEPSEEK_V4_1_FLASH_PRICING, limits_for_tier},
    },
    app_router,
    config::AppConfig,
    state::AppState,
};
use tower::ServiceExt;
use uuid::Uuid;

#[test]
fn test_mask_api_key_never_exposes_plaintext() {
    assert_eq!(mask_api_key("sk-1234567890abcdef"), "sk-1••••cdef");
    assert_eq!(mask_api_key("short"), "••••••••");
}

#[test]
fn test_deepseek_v4_1_flash_pricing_and_tier_limits() {
    assert_eq!(DEEPSEEK_V4_1_FLASH_PRICING.context_length, 1_000_000);
    assert_eq!(DEEPSEEK_V4_1_FLASH_PRICING.concurrency_limit, 2_500);

    let free = limits_for_tier("free");
    let super_tier = limits_for_tier("super");
    let sudo = limits_for_tier("sudo");

    assert!(free.daily_ai_requests < super_tier.daily_ai_requests);
    assert!(super_tier.daily_ai_requests < sudo.daily_ai_requests);
    assert!(super_tier.monthly_asr_minutes < sudo.monthly_asr_minutes);
    assert_eq!(free.monthly_ocr_pages, 0);
}

#[test]
fn test_extract_keywords_normalizes_and_deduplicates() {
    let kw = extract_keywords("Link desain UI Figma dari Budi minggu lalu: https://figma.com/file");
    assert!(kw.contains(&"desain".to_string()));
    assert!(kw.contains(&"figma".to_string()));
    assert!(kw.contains(&"budi".to_string()));
}

#[tokio::test]
async fn test_ai_and_dev_ai_routes_require_auth() {
    let cfg = AppConfig::from_map(&HashMap::new()).expect("dev config");
    let state = Arc::new(AppState::connect_lazy(cfg).expect("lazy state"));
    let app = app_router(state);
    let cid = Uuid::now_v7();

    let routes = [
        (Method::GET, "/api/v1/ai/limits".to_string()),
        (Method::GET, "/api/v1/ai/search?q=figma".to_string()),
        (Method::POST, "/api/v1/ai/voice/transcribe".to_string()),
        (
            Method::POST,
            format!("/api/v1/ai/channels/{cid}/catch-me-up"),
        ),
        (Method::POST, format!("/api/v1/ai/channels/{cid}/command")),
        (Method::GET, "/api/v1/dev/ai/keys".to_string()),
        (Method::POST, "/api/v1/dev/ai/keys".to_string()),
        (Method::GET, "/api/v1/dev/ai/triage".to_string()),
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
            "route {uri} must require auth"
        );
    }
}
