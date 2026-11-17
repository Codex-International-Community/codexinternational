//! Unit and integration tests for `Task 1.2` (Bounded Argon2id, JWT, Register,
//! Login, and `/api/v1/auth/me`).

use std::{collections::HashMap, sync::Arc, time::Duration};

use axum::{
    body::Body,
    http::{Request, StatusCode, header::AUTHORIZATION},
};
use backend::{
    app_router,
    auth::{
        jwt::{decode_access_token, encode_access_token, generate_refresh_token},
        password::PasswordHasher,
    },
    config::AppConfig,
    error::AppError,
    shared::db::run_migrations,
    state::AppState,
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn test_password_hasher_roundtrip_and_wrong_password() {
    let hasher = PasswordHasher::default();
    let phc = hasher
        .hash_password("hunter42_secure".to_string())
        .await
        .expect("hashing must succeed");

    assert!(phc.starts_with("$argon2id$"));
    assert!(
        hasher
            .verify_password("hunter42_secure".to_string(), phc.clone())
            .await
            .unwrap()
    );
    assert!(
        !hasher
            .verify_password("wrong_password".to_string(), phc)
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn test_password_hasher_bounded_semaphore_returns_503_on_timeout() {
    let hasher = PasswordHasher::new(1, Duration::from_millis(20));

    // Saturate the single slot and immediately issue competing requests so at least one
    // hits the acquire timeout and fast-fails with 503 ServiceUnavailable.
    let h1 = hasher.clone();
    let h2 = hasher.clone();
    let h3 = hasher.clone();

    let (r1, r2, r3) = tokio::join!(
        h1.hash_password("pw_one_12345".to_string()),
        h2.hash_password("pw_two_12345".to_string()),
        h3.hash_password("pw_three_12345".to_string()),
    );

    let results = [r1, r2, r3];
    assert!(
        results
            .iter()
            .any(|res| matches!(res, Err(AppError::ServiceUnavailable { .. }))),
        "expected at least one 503 ServiceUnavailable under semaphore saturation"
    );
}

#[test]
fn test_jwt_encode_decode_and_refresh_token_uniqueness() {
    let uid = Uuid::now_v7();
    let sid = Uuid::now_v7();
    let secret = "test-secret-key-at-least-32-chars-long";

    let token = encode_access_token(uid, sid, "user", secret, 900).unwrap();
    let claims = decode_access_token(&token, secret).unwrap();
    assert_eq!(claims.sub, uid);
    assert_eq!(claims.sid, sid);
    assert_eq!(claims.role, "user");

    assert!(decode_access_token(&token, "wrong-secret").is_err());

    let (raw1, hash1) = generate_refresh_token();
    let (raw2, hash2) = generate_refresh_token();
    assert_ne!(raw1, raw2);
    assert_ne!(hash1, hash2);
    assert_eq!(hash1.len(), 64);
}

#[tokio::test]
async fn test_auth_me_rejects_missing_or_invalid_bearer_token() {
    let cfg = AppConfig::from_map(&HashMap::new()).expect("dev config");
    let state = Arc::new(AppState::connect_lazy(cfg).expect("lazy state"));
    let app = app_router(state);

    let res_missing = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/me")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res_missing.status(), StatusCode::UNAUTHORIZED);

    let res_bad = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/me")
                .header(AUTHORIZATION, "Bearer invalid.jwt.token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res_bad.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
#[ignore = "requires live postgres"]
async fn test_register_login_and_me_flow() {
    let cfg = AppConfig::from_env().expect("env config");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(cfg.database_url.expose())
        .await
        .expect("connect to postgres");
    run_migrations(&pool).await.expect("migrations");

    let state = Arc::new(AppState::connect_lazy(cfg).expect("state"));
    let app = app_router(state);

    let tag = &Uuid::now_v7().simple().to_string()[..10];
    let username = format!("dev_{tag}");
    let email = format!("{username}@example.com");

    // 1. Register -> 201 Created
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
                        "display_name": "Dev User",
                        "email": email,
                        "password": "StrongPassword123!",
                        "platform": "web"
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

    // 2. Duplicate register -> 409 Conflict
    let dup_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/register")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "username": username,
                        "display_name": "Dev User",
                        "email": email,
                        "password": "StrongPassword123!"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(dup_res.status(), StatusCode::CONFLICT);

    // 3. Wrong password -> 401 Unauthorized
    let bad_login = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "identifier": email,
                        "password": "WrongPassword!"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(bad_login.status(), StatusCode::UNAUTHORIZED);

    // 4. Valid login -> 200 OK
    let login_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "identifier": username,
                        "password": "StrongPassword123!"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(login_res.status(), StatusCode::OK);
    let login_body: Value =
        serde_json::from_slice(&login_res.into_body().collect().await.unwrap().to_bytes()).unwrap();
    let access_token = login_body["access_token"].as_str().unwrap();

    // 5. GET /api/v1/auth/me -> 200 OK
    let me_res = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/me")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(me_res.status(), StatusCode::OK);

    // Cleanup test user.
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
}
