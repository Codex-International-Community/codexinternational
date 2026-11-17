//! Unit tests verifying `AppError` HTTP status mapping, JSON envelope, and
//! `Retry-After` header behavior without leaking internal errors.

use axum::{
    http::{StatusCode, header::RETRY_AFTER},
    response::IntoResponse,
};
use backend::error::AppError;
use http_body_util::BodyExt;
use serde_json::Value;

#[tokio::test]
async fn test_rate_limit_error_sets_retry_after_header_and_json_body() {
    let err = AppError::TooManyRequests {
        retry_after_secs: 60,
        message: "too many OTP requests".to_string(),
    };

    let response = err.into_response();
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(response.headers().get(RETRY_AFTER).unwrap(), "60");

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"]["code"], "TOO_MANY_REQUESTS");
    assert_eq!(json["error"]["retry_after_secs"], 60);
}

#[tokio::test]
async fn test_internal_error_hides_sensitive_cause_from_response() {
    let err = AppError::Internal(anyhow::anyhow!(
        "postgres://secret_user:secret_pass@10.0.0.5 failed"
    ));

    let response = err.into_response();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8(body.to_vec()).unwrap();
    assert!(!text.contains("secret_pass"));
    assert!(text.contains("INTERNAL_ERROR"));
}
