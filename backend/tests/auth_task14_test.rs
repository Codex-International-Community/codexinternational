//! Tests for `Task 1.4`: Global Exponential Backoff Rate Limiter (24h Reset,
//! `INV-16`) and Bot `AuthPrincipal` + `dev` Approval Gate (`INV-15`).

use std::{collections::HashMap, sync::Arc};

use axum::{
    body::Body,
    http::{Request, StatusCode, header::AUTHORIZATION},
};
use backend::{
    app_router,
    auth::{
        bots::{BOT_ADMIN, BOT_MOD, BOT_READ, BOT_WRITE, has_bot_privilege},
        jwt::encode_access_token,
    },
    config::AppConfig,
    error::AppError,
    shared::{
        db::run_migrations,
        rate_limit::{
            BACKOFF_RESET_WINDOW_SECS, RateLimitPolicy, check_rate_limit, policy_for_request,
            resolve_caller_bucket,
        },
    },
    state::AppState,
};
use fred::interfaces::KeysInterface;
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

#[test]
fn test_rate_limit_policy_and_exponential_cooldown() {
    let auth_policy = policy_for_request("/api/v1/auth/login", false);
    assert_eq!(auth_policy.scope, "auth");
    assert_eq!(auth_policy.cooldown_for_strikes(0), 0);
    assert_eq!(auth_policy.cooldown_for_strikes(1), 10);
    assert_eq!(auth_policy.cooldown_for_strikes(2), 20);
    assert_eq!(auth_policy.cooldown_for_strikes(3), 40);

    let bot_policy = policy_for_request("/api/v1/auth/me", true);
    assert_eq!(bot_policy.scope, "bot");

    let media_policy = policy_for_request("/api/v1/media/presign", false);
    assert_eq!(media_policy.scope, "media");

    let api_policy = policy_for_request("/api/v1/communities", false);
    assert_eq!(api_policy.scope, "api");
}

#[test]
fn test_bot_privilege_chmod_bits() {
    assert_eq!(BOT_READ, 1);
    assert_eq!(BOT_WRITE, 2);
    assert_eq!(BOT_MOD, 4);
    assert_eq!(BOT_ADMIN, 8);

    let guardrail_bot = BOT_READ | BOT_WRITE | BOT_MOD; // 7
    assert!(has_bot_privilege(guardrail_bot, BOT_READ));
    assert!(has_bot_privilege(guardrail_bot, BOT_WRITE | BOT_MOD));
    assert!(!has_bot_privilege(guardrail_bot, BOT_ADMIN));

    let admin_bot = guardrail_bot | BOT_ADMIN; // 15
    assert!(has_bot_privilege(admin_bot, BOT_ADMIN));
}

#[tokio::test]
async fn test_non_dev_cannot_create_bot_admin_or_review_bots() {
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

    // Regular user requesting bit 8 (BOT_ADMIN) must be rejected 403.
    let res_admin_bot = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/bots")
                .header(AUTHORIZATION, format!("Bearer {user_jwt}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "evil_admin_bot",
                        "display_name": "Evil Admin",
                        "privilege_mode": 15
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res_admin_bot.status(), StatusCode::FORBIDDEN);

    // Non-dev user attempting to approve a bot must be rejected 403.
    let bot_id = Uuid::now_v7();
    let res_review = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/dev/bots/{bot_id}/review"))
                .header(AUTHORIZATION, format!("Bearer {user_jwt}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "decision": "APPROVED" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res_review.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
#[ignore = "requires live postgres and valkey"]
async fn test_inv16_global_rate_limit_exponential_backoff_24h_reset() {
    let cfg = AppConfig::from_env().expect("env config");
    let state = AppState::connect(cfg)
        .await
        .expect("live valkey + postgres");

    let caller = format!("test_caller_{}", Uuid::now_v7().simple());
    let policy = RateLimitPolicy {
        scope: "test_rl",
        max_requests: 2,
        window_secs: 60,
        base_cooldown_secs: 10,
        max_cooldown_secs: 100,
    };

    // Requests 1 and 2 succeed.
    assert!(
        check_rate_limit(&state.valkey, policy, &caller)
            .await
            .is_ok()
    );
    assert!(
        check_rate_limit(&state.valkey, policy, &caller)
            .await
            .is_ok()
    );

    // Request 3 violates limit -> strike 1 (cooldown 10s).
    let err1 = check_rate_limit(&state.valkey, policy, &caller)
        .await
        .expect_err("3rd request must hit rate limit");
    assert!(matches!(
        err1,
        AppError::TooManyRequests {
            retry_after_secs: 10,
            ..
        }
    ));

    let backoff_key = format!("rl:backoff:test_rl:{caller}");
    let ttl: i64 = state.valkey.ttl(&backoff_key).await.unwrap();
    assert!(ttl > 86_000 && ttl <= BACKOFF_RESET_WINDOW_SECS as i64);

    // Simulating 24h reset by removing backoff & window keys restores default behavior.
    let _: i64 = state.valkey.del(&backoff_key).await.unwrap();
    let _: i64 = state
        .valkey
        .del(format!("rl:test_rl:{caller}"))
        .await
        .unwrap();
    assert!(
        check_rate_limit(&state.valkey, policy, &caller)
            .await
            .is_ok()
    );

    let _: i64 = state
        .valkey
        .del(format!("rl:test_rl:{caller}"))
        .await
        .unwrap();
}

#[tokio::test]
#[ignore = "requires live postgres and valkey"]
async fn test_inv15_bot_approval_and_token_auth_lifecycle() {
    let cfg = AppConfig::from_env().expect("env config");
    let state = AppState::connect(cfg.clone()).await.expect("live deps");
    run_migrations(&state.pg).await.unwrap();

    let tag = &Uuid::now_v7().simple().to_string()[..10];
    let owner_id = Uuid::now_v7();
    let dev_id = Uuid::now_v7();

    sqlx::query("INSERT INTO users (id, username, display_name, email, platform_role) VALUES ($1, $2, 'Owner', $3, 'user')")
        .bind(owner_id)
        .bind(format!("own_{tag}"))
        .bind(format!("own_{tag}@example.com"))
        .execute(&state.pg)
        .await
        .unwrap();

    sqlx::query("INSERT INTO users (id, username, display_name, email, platform_role) VALUES ($1, $2, 'Dev', $3, 'dev')")
        .bind(dev_id)
        .bind(format!("dev_{tag}"))
        .bind(format!("dev_{tag}@example.com"))
        .execute(&state.pg)
        .await
        .unwrap();

    let owner_device_id = Uuid::now_v7();
    let dev_device_id = Uuid::now_v7();

    sqlx::query("INSERT INTO user_devices (id, user_id, refresh_token_hash, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '7 days')")
        .bind(owner_device_id)
        .bind(owner_id)
        .bind(format!("hash_own_{tag}"))
        .execute(&state.pg)
        .await
        .unwrap();

    sqlx::query("INSERT INTO user_devices (id, user_id, refresh_token_hash, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '7 days')")
        .bind(dev_device_id)
        .bind(dev_id)
        .bind(format!("hash_dev_{tag}"))
        .execute(&state.pg)
        .await
        .unwrap();

    let owner_jwt = encode_access_token(
        owner_id,
        owner_device_id,
        "user",
        cfg.jwt_secret.expose(),
        900,
    )
    .unwrap();
    let dev_jwt =
        encode_access_token(dev_id, dev_device_id, "dev", cfg.jwt_secret.expose(), 900).unwrap();

    let pg = state.pg.clone();
    let app = app_router(Arc::new(state));

    // 1. Owner creates a community guardrail bot (mode 7) -> starts PENDING.
    let create_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/bots")
                .header(AUTHORIZATION, format!("Bearer {owner_jwt}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": format!("guard_{tag}"),
                        "display_name": "Guard Bot",
                        "privilege_mode": 7
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(create_res.status(), StatusCode::CREATED);
    let bot_body: Value =
        serde_json::from_slice(&create_res.into_body().collect().await.unwrap().to_bytes())
            .unwrap();
    assert_eq!(bot_body["approval_status"], "PENDING");
    let bot_id = Uuid::parse_str(bot_body["id"].as_str().unwrap()).unwrap();

    // 2. Issuing token before dev approval must fail with 403.
    let tok_pending = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/bots/{bot_id}/tokens"))
                .header(AUTHORIZATION, format!("Bearer {owner_jwt}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "label": "vps-1" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(tok_pending.status(), StatusCode::FORBIDDEN);

    // 3. Dev approves the bot.
    let review_ok = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/dev/bots/{bot_id}/review"))
                .header(AUTHORIZATION, format!("Bearer {dev_jwt}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "decision": "APPROVED" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(review_ok.status(), StatusCode::OK);

    // 4. Now owner can issue a bot token and revoke it.
    let tok_ok = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/bots/{bot_id}/tokens"))
                .header(AUTHORIZATION, format!("Bearer {owner_jwt}"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "label": "vps-1" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(tok_ok.status(), StatusCode::CREATED);
    let tok_body: Value =
        serde_json::from_slice(&tok_ok.into_body().collect().await.unwrap().to_bytes()).unwrap();
    let token_id = tok_body["token_id"].as_str().unwrap();

    let revoke_ok = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/v1/bots/{bot_id}/tokens/{token_id}"))
                .header(AUTHORIZATION, format!("Bearer {owner_jwt}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(revoke_ok.status(), StatusCode::NO_CONTENT);

    sqlx::query("DELETE FROM bots WHERE id = $1")
        .bind(bot_id)
        .execute(&pg)
        .await
        .unwrap();
    sqlx::query("DELETE FROM users WHERE id IN ($1, $2)")
        .bind(owner_id)
        .bind(dev_id)
        .execute(&pg)
        .await
        .unwrap();
}

#[tokio::test]
async fn test_fake_bot_header_cannot_bypass_public_auth_or_api_ip_rate_limit() {
    let cfg = AppConfig::from_map(&HashMap::new()).expect("dev config");
    let state = AppState::connect_lazy(cfg).expect("lazy state");

    for path in [
        "/api/v1/auth/login",
        "/api/v1/auth/register",
        "/api/v1/auth/otp/send",
        "/api/v1/auth/otp/verify",
        "/api/v1/auth/oauth/github",
        "/api/v1/auth/refresh",
    ] {
        let (policy, key) =
            resolve_caller_bucket(&state, path, "Bot attacker-random-token-123", "203.0.113.9")
                .await;
        assert_eq!(policy.scope, "auth", "path {path} must stay in auth scope");
        assert_eq!(
            key, "203.0.113.9",
            "path {path} must key by client IP, never bot:<hash>"
        );
    }

    // Unverified Bot token on non-auth routes also falls back to client IP when not cached.
    let (api_policy, api_key) = resolve_caller_bucket(
        &state,
        "/api/v1/bots",
        "Bot unverified-random-token",
        "203.0.113.9",
    )
    .await;
    assert_eq!(api_policy.scope, "api");
    assert_eq!(api_key, "203.0.113.9");
}
