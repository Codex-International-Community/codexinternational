//! Tests for User UID (`MMYY` + 2-digit role + auto-increment/reserved 1..=10),
//! opt-in UID login, password setup for OAuth/OTP accounts, and `dev` slot assignment.

use std::{collections::HashMap, sync::Arc};

use axum::{
    body::Body,
    http::{Request, StatusCode, header::AUTHORIZATION},
};
use backend::{
    app_router,
    auth::{
        jwt::encode_access_token,
        uid::{
            UID_ROLE_FOUNDER, UID_ROLE_MEMBER, UID_ROLE_SENIOR_ADMIN, UID_ROLE_VICE_FOUNDER,
            format_uid,
        },
    },
    config::AppConfig,
    shared::db::run_migrations,
    state::AppState,
};
use chrono::{TimeZone, Utc};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use uuid::Uuid;

#[test]
fn test_uid_formatting_reserved_and_regular() {
    let dt = Utc.with_ymd_and_hms(2026, 11, 18, 12, 0, 0).unwrap();

    // Reserved 1..=9 -> 7 digits (MMYY + 2-digit role + 1-digit slot).
    let id1 = format_uid(dt, UID_ROLE_FOUNDER, 1).unwrap();
    assert_eq!(id1, "1126001");
    assert_eq!(id1.len(), 7);

    let id2 = format_uid(dt, UID_ROLE_VICE_FOUNDER, 2).unwrap();
    assert_eq!(id2, "1126012");
    assert_eq!(id2.len(), 7);

    let id9 = format_uid(dt, UID_ROLE_SENIOR_ADMIN, 9).unwrap();
    assert_eq!(id9, "1126029");
    assert_eq!(id9.len(), 7);

    // Slot 10 & auto-increment 11+ -> 8+ digits.
    assert_eq!(format_uid(dt, UID_ROLE_MEMBER, 10).unwrap(), "11260610");
    assert_eq!(format_uid(dt, UID_ROLE_MEMBER, 11).unwrap(), "11260611");

    // Invalid role_code or seq rejected.
    assert!(format_uid(dt, 7, 1).is_err());
    assert!(format_uid(dt, -1, 1).is_err());
    assert!(format_uid(dt, UID_ROLE_MEMBER, 0).is_err());
}

#[tokio::test]
async fn test_uid_endpoints_require_auth_and_dev_role() {
    let cfg = AppConfig::from_map(&HashMap::new()).expect("dev config");
    let user_jwt = encode_access_token(
        Uuid::now_v7(),
        Uuid::now_v7(),
        "user",
        cfg.jwt_secret.expose(),
        900,
    )
    .unwrap();
    let state = Arc::new(AppState::connect_lazy(cfg).expect("lazy state"));
    let app = app_router(state);

    let unauth_toggle = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/api/v1/auth/uid-login")
                .header("content-type", "application/json")
                .body(Body::from(json!({ "enabled": true }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauth_toggle.status(), StatusCode::UNAUTHORIZED);

    let unauth_pwd = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/v1/auth/password")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "new_password": "StrongPassword123!" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauth_pwd.status(), StatusCode::UNAUTHORIZED);

    let non_dev_slots = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/v1/dev/uid-slots")
                .header(AUTHORIZATION, format!("Bearer {user_jwt}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(non_dev_slots.status(), StatusCode::FORBIDDEN);

    let target_id = Uuid::now_v7();
    let non_dev_assign = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/dev/users/{target_id}/assign-uid"))
                .header(AUTHORIZATION, format!("Bearer {user_jwt}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "slot_number": 1 }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(non_dev_assign.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
#[ignore = "requires live postgres"]
async fn test_uid_generation_opt_in_login_oauth_password_gate_and_reserved_slots() {
    let cfg = AppConfig::from_env().expect("env config");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(cfg.database_url.expose())
        .await
        .unwrap();
    run_migrations(&pool).await.unwrap();

    let state = Arc::new(AppState::connect_lazy(cfg.clone()).unwrap());
    let app = app_router(state);

    let tag = &Uuid::now_v7().simple().to_string()[..10];
    let username = format!("uid_{tag}");
    let email = format!("{username}@example.com");

    // 1. Register regular user -> gets auto-increment UID (role 06), uid_login_enabled = false.
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
                        "display_name": "UID Tester",
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
    let uid = reg_body["user"]["uid"].as_str().unwrap().to_string();
    let access_token = reg_body["access_token"].as_str().unwrap().to_string();

    assert_eq!(reg_body["user"]["uid_login_enabled"], false);
    assert_eq!(reg_body["user"]["has_password"], true);
    assert!(uid.len() >= 8);

    // 2. Login with UID fails while uid_login_enabled is false.
    let uid_login_disabled = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "identifier": uid, "password": "StrongPassword123!" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(uid_login_disabled.status(), StatusCode::UNAUTHORIZED);

    // 3. Enable UID login -> login with UID now succeeds.
    let toggle_on = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/api/v1/auth/uid-login")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "enabled": true }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(toggle_on.status(), StatusCode::OK);

    let uid_login_ok = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "identifier": uid, "password": "StrongPassword123!" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(uid_login_ok.status(), StatusCode::OK);

    // 4. OAuth/OTP-only user (password_hash = NULL) must set a password before enabling UID login.
    let oauth_uid_id = Uuid::now_v7();
    let oauth_username = format!("oauth_{tag}");
    sqlx::query(
        "INSERT INTO users (id, username, display_name, email, email_verified_at)
         VALUES ($1, $2, 'OAuth User', $3, NOW())",
    )
    .bind(oauth_uid_id)
    .bind(&oauth_username)
    .bind(format!("{oauth_username}@example.com"))
    .execute(&pool)
    .await
    .unwrap();

    let oauth_jwt = encode_access_token(
        oauth_uid_id,
        Uuid::now_v7(),
        "user",
        cfg.jwt_secret.expose(),
        900,
    )
    .unwrap();

    let enable_before_pw = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/api/v1/auth/uid-login")
                .header(AUTHORIZATION, format!("Bearer {oauth_jwt}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "enabled": true }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(enable_before_pw.status(), StatusCode::BAD_REQUEST);

    let set_pw = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/v1/auth/password")
                .header(AUTHORIZATION, format!("Bearer {oauth_jwt}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "new_password": "OAuthNewPassword123!" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(set_pw.status(), StatusCode::OK);

    let enable_after_pw = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/api/v1/auth/uid-login")
                .header(AUTHORIZATION, format!("Bearer {oauth_jwt}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "enabled": true }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(enable_after_pw.status(), StatusCode::OK);

    // 5. Dev assigns reserved slot 1 (7-digit Founder UID), blocks duplicate claim by another user.
    let dev_jwt = encode_access_token(
        Uuid::now_v7(),
        Uuid::now_v7(),
        "dev",
        cfg.jwt_secret.expose(),
        900,
    )
    .unwrap();

    let assign_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/dev/users/{user_id}/assign-uid"))
                .header(AUTHORIZATION, format!("Bearer {dev_jwt}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "slot_number": 1, "role_code": 0 }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(assign_res.status(), StatusCode::OK);
    let assign_body: Value =
        serde_json::from_slice(&assign_res.into_body().collect().await.unwrap().to_bytes())
            .unwrap();
    let founder_uid = assign_body["user"]["uid"].as_str().unwrap().to_string();
    assert_eq!(founder_uid.len(), 7);
    assert!(founder_uid.ends_with("001"));

    let conflict_assign = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/dev/users/{oauth_uid_id}/assign-uid"))
                .header(AUTHORIZATION, format!("Bearer {dev_jwt}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "slot_number": 1 }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(conflict_assign.status(), StatusCode::CONFLICT);

    sqlx::query("DELETE FROM users WHERE id IN ($1, $2)")
        .bind(user_id)
        .bind(oauth_uid_id)
        .execute(&pool)
        .await
        .unwrap();
}
