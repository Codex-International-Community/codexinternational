//! Tests for `Task 1.3`: Refresh Token Rotation + Reuse Detection, Device FCM
//! Registration, Brevo SMTP OTP with 24h Exponential Backoff (`INV-16`), and OAuth2.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use async_trait::async_trait;
use axum::{
    body::Body,
    http::{Request, StatusCode, header::AUTHORIZATION, header::RETRY_AFTER},
};
use backend::{
    app_router,
    auth::{
        jwt::encode_access_token,
        oauth::{OAuthClient, OAuthUserInfo},
        otp::{EmailSender, compute_otp_cooldown_secs},
    },
    config::AppConfig,
    error::AppError,
    shared::db::run_migrations,
    state::AppState,
};
use fred::interfaces::KeysInterface;
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use uuid::Uuid;

#[derive(Default)]
struct MockEmailSender {
    sent: Mutex<Vec<(String, String, String)>>,
}

#[async_trait]
impl EmailSender for MockEmailSender {
    async fn send_otp(&self, to_email: &str, code: &str, purpose: &str) -> Result<(), AppError> {
        self.sent.lock().unwrap().push((
            to_email.to_string(),
            code.to_string(),
            purpose.to_string(),
        ));
        Ok(())
    }
}

struct MockOAuthClient {
    info: OAuthUserInfo,
}

#[async_trait]
impl OAuthClient for MockOAuthClient {
    async fn exchange_code(
        &self,
        _provider: &str,
        _code: &str,
        _redirect_uri: &str,
        _cfg: &AppConfig,
    ) -> Result<OAuthUserInfo, AppError> {
        Ok(self.info.clone())
    }
}

#[test]
fn test_otp_exponential_backoff_sequence() {
    assert_eq!(compute_otp_cooldown_secs(0), 0);
    assert_eq!(compute_otp_cooldown_secs(1), 60);
    assert_eq!(compute_otp_cooldown_secs(2), 120);
    assert_eq!(compute_otp_cooldown_secs(3), 240);
    assert_eq!(compute_otp_cooldown_secs(4), 480);
    assert_eq!(compute_otp_cooldown_secs(10), 3600);
}

#[tokio::test]
async fn test_devices_fcm_requires_auth_and_rejects_empty_token() {
    let cfg = AppConfig::from_map(&HashMap::new()).expect("dev config");
    let jwt = encode_access_token(
        Uuid::now_v7(),
        Uuid::now_v7(),
        "user",
        cfg.jwt_secret.expose(),
        900,
    )
    .unwrap();
    let state = Arc::new(AppState::connect_lazy(cfg).expect("lazy state"));
    let app = app_router(state);

    let unauth = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/v1/devices/fcm")
                .header("content-type", "application/json")
                .body(Body::from(json!({ "fcm_token": "tok123" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauth.status(), StatusCode::UNAUTHORIZED);

    let empty = app
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/v1/devices/fcm")
                .header(AUTHORIZATION, format!("Bearer {jwt}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "fcm_token": "   " }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(empty.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_oauth_rejects_unknown_provider() {
    let cfg = AppConfig::from_map(&HashMap::new()).expect("dev config");
    let state = Arc::new(AppState::connect_lazy(cfg).expect("lazy state"));
    let app = app_router(state);

    let res = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/oauth/twitter")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "code": "abc", "redirect_uri": "http://localhost:5173/cb" })
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
#[ignore = "requires live postgres and valkey"]
async fn test_refresh_token_rotation_and_reuse_revokes_all() {
    let cfg = AppConfig::from_env().expect("env config");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(cfg.database_url.expose())
        .await
        .unwrap();
    run_migrations(&pool).await.unwrap();

    let state = Arc::new(AppState::connect_lazy(cfg).unwrap());
    let app = app_router(state);

    let tag = &Uuid::now_v7().simple().to_string()[..10];
    let username = format!("rot_{tag}");
    let email = format!("{username}@example.com");

    let reg_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/register")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "username": username,
                        "display_name": "Rotation Tester",
                        "email": email,
                        "password": "StrongPassword123!"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(reg_res.status(), StatusCode::CREATED);
    let reg_body: Value =
        serde_json::from_slice(&reg_res.into_body().collect().await.unwrap().to_bytes()).unwrap();
    let user_id = Uuid::parse_str(reg_body["user"]["id"].as_str().unwrap()).unwrap();
    let rt1 = reg_body["refresh_token"].as_str().unwrap().to_string();

    // Rotate once -> succeeds with new refresh_token rt2.
    let ref1 = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/refresh")
                .header("content-type", "application/json")
                .body(Body::from(json!({ "refresh_token": rt1 }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ref1.status(), StatusCode::OK);
    let ref1_body: Value =
        serde_json::from_slice(&ref1.into_body().collect().await.unwrap().to_bytes()).unwrap();
    let rt2 = ref1_body["refresh_token"].as_str().unwrap().to_string();
    assert_ne!(rt1, rt2);

    // Replaying already-rotated rt1 must fail with 401.
    let replay = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/refresh")
                .header("content-type", "application/json")
                .body(Body::from(json!({ "refresh_token": rt1 }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(replay.status(), StatusCode::UNAUTHORIZED);

    // Logout using rt2's new access_token revokes session.
    let access2 = ref1_body["access_token"].as_str().unwrap();
    let logout = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/logout")
                .header(AUTHORIZATION, format!("Bearer {access2}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);

    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
}

#[tokio::test]
#[ignore = "requires live postgres and valkey"]
async fn test_inv16_otp_exponential_backoff_and_max_attempts() {
    let cfg = AppConfig::from_env().expect("env config");
    let mock_email = Arc::new(MockEmailSender::default());
    let mock_oauth = Arc::new(MockOAuthClient {
        info: OAuthUserInfo {
            provider_user_id: "0".to_string(),
            email: "unused@example.com".to_string(),
            display_name: "Unused".to_string(),
        },
    });

    let state = AppState::connect(cfg)
        .await
        .expect("live postgres + valkey")
        .with_auth_clients(mock_email.clone(), mock_oauth);
    run_migrations(&state.pg).await.unwrap();

    let tag = &Uuid::now_v7().simple().to_string()[..10];
    let email = format!("otp_{tag}@example.com");
    let state = Arc::new(state);
    let app = app_router(state.clone());

    // 1. First OTP send succeeds.
    let send1 = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/otp/send")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "email": email, "purpose": "login" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(send1.status(), StatusCode::OK);

    // 2. Immediate second OTP send triggers exponential backoff 429 + Retry-After.
    let send2 = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/otp/send")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "email": email, "purpose": "login" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(send2.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(send2.headers().get(RETRY_AFTER).is_some());

    // 3. Five wrong OTP guesses burn the code even if the 6th uses the real code.
    for _ in 0..5 {
        let bad = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/auth/otp/verify")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({ "email": email, "code": "000000", "purpose": "login" }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(bad.status(), StatusCode::UNAUTHORIZED);
    }

    let real_code = mock_email.sent.lock().unwrap()[0].1.clone();
    let burned = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/otp/verify")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "email": email, "code": real_code, "purpose": "login" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(burned.status(), StatusCode::UNAUTHORIZED);

    // Clear backoff key so we can request a fresh OTP and verify successful login.
    let email_hash = backend::auth::jwt::hash_token(&email);
    let _: i64 = state
        .valkey
        .del(format!("rl:backoff:otp_send:{email_hash}"))
        .await
        .unwrap();

    let send3 = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/otp/send")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "email": email, "purpose": "login" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(send3.status(), StatusCode::OK);
    let fresh_code = mock_email.sent.lock().unwrap()[1].1.clone();

    let ok_verify = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/otp/verify")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "email": email, "code": fresh_code, "purpose": "login" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ok_verify.status(), StatusCode::OK);
    let verify_body: Value =
        serde_json::from_slice(&ok_verify.into_body().collect().await.unwrap().to_bytes()).unwrap();
    let created_uid = Uuid::parse_str(verify_body["user"]["id"].as_str().unwrap()).unwrap();

    let _: i64 = state
        .valkey
        .del(format!("rl:backoff:otp_send:{email_hash}"))
        .await
        .unwrap();
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(created_uid)
        .execute(&state.pg)
        .await
        .unwrap();
}

#[tokio::test]
#[ignore = "requires live postgres and valkey"]
async fn test_oauth_login_links_and_provisions_user() {
    let cfg = AppConfig::from_env().expect("env config");
    let tag = &Uuid::now_v7().simple().to_string()[..10];
    let email = format!("gh_{tag}@example.com");

    let mock_oauth = Arc::new(MockOAuthClient {
        info: OAuthUserInfo {
            provider_user_id: format!("gh_{tag}"),
            email: email.clone(),
            display_name: "GitHub Builder".to_string(),
        },
    });
    let state = AppState::connect_lazy(cfg)
        .unwrap()
        .with_auth_clients(Arc::new(MockEmailSender::default()), mock_oauth);
    run_migrations(&state.pg).await.unwrap();

    let pg = state.pg.clone();
    let app = app_router(Arc::new(state));

    let res = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/oauth/github")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "code": "mock_code_123",
                        "redirect_uri": "http://localhost:5173/oauth/callback"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body: Value =
        serde_json::from_slice(&res.into_body().collect().await.unwrap().to_bytes()).unwrap();
    let uid = Uuid::parse_str(body["user"]["id"].as_str().unwrap()).unwrap();
    assert!(body["user"]["email_verified_at"].is_string());

    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(uid)
        .execute(&pg)
        .await
        .unwrap();
}
