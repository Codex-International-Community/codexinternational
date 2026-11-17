//! Integration tests for `backend::config` covering `INV-13` production
//! guardrails, secret redaction, and localhost-safe development defaults.

use std::collections::HashMap;

use backend::config::{AppConfig, AppEnv, ConfigError};

#[test]
fn test_inv13_production_hard_fail_on_empty_secret() {
    let mut env_map = HashMap::new();
    env_map.insert("APP_ENV", "production");
    env_map.insert("DATABASE_URL", "postgres://u:p@db:5432/app");
    env_map.insert("VALKEY_URL", "valkey://valkey:6379");
    env_map.insert("R2_ACCOUNT_ID", "acc123");
    env_map.insert("R2_ACCESS_KEY_ID", "key123");
    env_map.insert("R2_SECRET_ACCESS_KEY", "secret123");
    // Missing JWT_SECRET and LAMBDA_WEBHOOK_SECRET must trigger INV-13.

    let err = AppConfig::from_map(&env_map).expect_err("production must fail without secrets");
    assert!(matches!(err, ConfigError::ProductionGuardrail(_)));
}

#[test]
fn test_inv13_production_hard_fail_on_dev_default_secret() {
    let mut env_map = HashMap::new();
    env_map.insert("APP_ENV", "production");
    env_map.insert("DATABASE_URL", "postgres://u:p@db:5432/app");
    env_map.insert("VALKEY_URL", "valkey://valkey:6379");
    env_map.insert("JWT_SECRET", "dev-only-jwt-secret-change-in-production");
    env_map.insert(
        "LAMBDA_WEBHOOK_SECRET",
        "super-strong-production-lambda-secret-value",
    );
    env_map.insert("R2_ACCOUNT_ID", "acc123");
    env_map.insert("R2_ACCESS_KEY_ID", "key123");
    env_map.insert("R2_SECRET_ACCESS_KEY", "secret123");

    let err = AppConfig::from_map(&env_map).expect_err("production must reject dev-only secret");
    assert!(matches!(err, ConfigError::ProductionGuardrail(_)));
}

#[test]
fn test_production_succeeds_with_valid_secrets_and_redacts_debug() {
    let mut env_map = HashMap::new();
    env_map.insert("APP_ENV", "production");
    env_map.insert("DATABASE_URL", "postgres://u:p@db:5432/app");
    env_map.insert("VALKEY_URL", "valkey://valkey:6379");
    env_map.insert("JWT_SECRET", "prod-jwt-secret-with-at-least-32-characters!");
    env_map.insert(
        "LAMBDA_WEBHOOK_SECRET",
        "prod-lambda-secret-with-at-least-32-chars!",
    );
    env_map.insert("R2_ACCOUNT_ID", "acc123");
    env_map.insert("R2_ACCESS_KEY_ID", "key123");
    env_map.insert("R2_SECRET_ACCESS_KEY", "secret123");
    env_map.insert("WORKER_ROLES", "API,FLUSHER");

    let cfg = AppConfig::from_map(&env_map).expect("valid production config should succeed");
    assert_eq!(cfg.env, AppEnv::Production);
    assert!(cfg.worker_roles.api);
    assert!(cfg.worker_roles.flusher);
    assert!(!cfg.worker_roles.fcm);
    assert!(!cfg.worker_roles.cleaner);

    // Ensure SecretString prevents secret values from appearing in Debug output.
    let debug_output = format!("{cfg:?}");
    assert!(!debug_output.contains("prod-jwt-secret"));
    assert!(!debug_output.contains("prod-lambda-secret"));
    assert!(debug_output.contains("[REDACTED]"));
}

#[test]
fn test_development_defaults_bind_localhost_and_work_out_of_the_box() {
    let env_map = HashMap::new();
    let cfg = AppConfig::from_map(&env_map).expect("dev defaults should load cleanly");
    assert_eq!(cfg.env, AppEnv::Development);
    assert_eq!(cfg.bind_addr, "127.0.0.1:8080");
    assert_eq!(cfg.msg_flush_interval_ms, 250);
    assert_eq!(cfg.counter_flush_interval_ms, 500);
    assert!(
        cfg.worker_roles.api
            && cfg.worker_roles.flusher
            && cfg.worker_roles.fcm
            && cfg.worker_roles.cleaner
    );
}
