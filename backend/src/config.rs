//! Application configuration loader and startup guardrails (`INV-13`).
//!
//! Reads environment variables (and `.env` in local development via `dotenvy`)
//! into strongly-typed structs, redacting secrets from `Debug` logs and
//! enforcing fail-fast validation before the server binds a TCP socket.

use std::{collections::HashMap, env, fmt};
use thiserror::Error;

/// Newtype wrapper around `String` for sensitive credentials (JWT keys, DB URLs,
/// R2 secrets). Prevents accidental leakage in structured logs or panic traces
/// by overriding `fmt::Debug` to print `[REDACTED]`.
#[derive(Clone, PartialEq, Eq)]
pub struct SecretString(String);

impl SecretString {
    /// Wraps a raw secret string.
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// Explicitly exposes the inner secret slice at call sites that need it
    /// (e.g., JWT signing or S3/R2 client initialization).
    pub fn expose(&self) -> &str {
        &self.0
    }

    /// Returns `true` when the secret is empty or whitespace-only.
    pub fn is_empty(&self) -> bool {
        self.0.trim().is_empty()
    }
}

impl fmt::Debug for SecretString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[REDACTED]")
    }
}

/// Runtime environment mode controlling guardrail strictness.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppEnv {
    Development,
    Production,
}

impl AppEnv {
    fn parse(raw: &str) -> Result<Self, ConfigError> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "development" | "dev" | "" => Ok(Self::Development),
            "production" | "prod" => Ok(Self::Production),
            other => Err(ConfigError::InvalidValue {
                key: "APP_ENV",
                reason: format!("unsupported environment '{other}'"),
            }),
        }
    }
}

/// Bitflag-like struct determining which subsystems run in this process.
/// Allows running everything in one binary locally (`ALL`) or splitting roles
/// across containers in production (e.g. `API` vs `FLUSHER,FCM,CLEANER`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorkerRoles {
    pub api: bool,
    pub flusher: bool,
    pub fcm: bool,
    pub cleaner: bool,
}

impl WorkerRoles {
    fn parse(raw: &str) -> Result<Self, ConfigError> {
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("ALL") {
            return Ok(Self {
                api: true,
                flusher: true,
                fcm: true,
                cleaner: true,
            });
        }

        let mut roles = Self {
            api: false,
            flusher: false,
            fcm: false,
            cleaner: false,
        };

        for part in trimmed.split(',').map(|s| s.trim().to_ascii_uppercase()) {
            match part.as_str() {
                "API" => roles.api = true,
                "FLUSHER" => roles.flusher = true,
                "FCM" => roles.fcm = true,
                "CLEANER" => roles.cleaner = true,
                other => {
                    return Err(ConfigError::InvalidValue {
                        key: "WORKER_ROLES",
                        reason: format!("unknown worker role '{other}'"),
                    });
                }
            }
        }

        Ok(roles)
    }
}

/// Errors returned while loading or validating configuration.
#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("missing required configuration key '{0}'")]
    MissingRequired(&'static str),

    #[error("invalid configuration for '{key}': {reason}")]
    InvalidValue { key: &'static str, reason: String },

    #[error("INV-13 production guardrail failed: {0}")]
    ProductionGuardrail(String),
}

/// Validated, immutable runtime configuration shared across the backend.
#[derive(Debug, Clone)]
pub struct AppConfig {
    pub env: AppEnv,
    pub bind_addr: String,
    pub database_url: SecretString,
    pub valkey_url: SecretString,
    pub jwt_secret: SecretString,
    pub jwt_access_ttl_secs: u64,
    pub jwt_refresh_ttl_days: u64,
    pub oauth_github_client_id: String,
    pub oauth_github_client_secret: SecretString,
    pub oauth_google_client_id: String,
    pub oauth_google_client_secret: SecretString,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_user: SecretString,
    pub smtp_pass: SecretString,
    pub smtp_from: String,
    pub smtp_reply_to: String,
    pub lambda_webhook_secret: SecretString,
    pub r2_account_id: String,
    pub r2_access_key_id: SecretString,
    pub r2_secret_access_key: SecretString,
    pub r2_bucket_name: String,
    pub r2_public_base_url: String,
    pub aws_lambda_video_fn: String,
    pub msg_flush_interval_ms: u64,
    pub counter_flush_interval_ms: u64,
    pub cors_allowed_origins: Vec<String>,
    pub worker_roles: WorkerRoles,
}

impl AppConfig {
    /// Loads `.env` (or `../.env` when invoked from `backend/`) and parses
    /// configuration from OS environment variables.
    pub fn from_env() -> Result<Self, ConfigError> {
        // Ignore missing `.env` so container deployments using real env vars work cleanly.
        let _ = dotenvy::dotenv();
        let _ = dotenvy::from_filename("../.env");
        Self::from_lookup(|key| env::var(key).ok())
    }

    /// Constructs `AppConfig` from an in-memory map for isolated unit/integration tests
    /// without mutating global process environment variables.
    pub fn from_map(map: &HashMap<&str, &str>) -> Result<Self, ConfigError> {
        Self::from_lookup(|key| map.get(key).map(|v| (*v).to_string()))
    }

    fn from_lookup<F>(get: F) -> Result<Self, ConfigError>
    where
        F: Fn(&str) -> Option<String>,
    {
        // Treat empty/whitespace env values the same as unset so defaults apply cleanly.
        let get_or = |key: &str, default: &str| -> String {
            get(key)
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| default.to_string())
        };

        let parse_u64 = |key: &'static str, default: u64| -> Result<u64, ConfigError> {
            match get(key).filter(|v| !v.trim().is_empty()) {
                Some(raw) => raw
                    .trim()
                    .parse::<u64>()
                    .map_err(|e| ConfigError::InvalidValue {
                        key,
                        reason: e.to_string(),
                    }),
                None => Ok(default),
            }
        };

        let parse_u16 = |key: &'static str, default: u16| -> Result<u16, ConfigError> {
            match get(key).filter(|v| !v.trim().is_empty()) {
                Some(raw) => raw
                    .trim()
                    .parse::<u16>()
                    .map_err(|e| ConfigError::InvalidValue {
                        key,
                        reason: e.to_string(),
                    }),
                None => Ok(default),
            }
        };

        let env = AppEnv::parse(&get_or("APP_ENV", "development"))?;
        let worker_roles = WorkerRoles::parse(&get_or("WORKER_ROLES", "ALL"))?;

        let cfg = Self {
            env,
            // Default to loopback (127.0.0.1) so local dev never accidentally binds to LAN.
            bind_addr: get_or("BIND_ADDR", "127.0.0.1:8080"),
            database_url: SecretString::new(get_or(
                "DATABASE_URL",
                "postgres://codexter:codex_dev_password@127.0.0.1:5432/codexinternational",
            )),
            valkey_url: SecretString::new(get_or("VALKEY_URL", "valkey://127.0.0.1:6379")),
            jwt_secret: SecretString::new(get_or(
                "JWT_SECRET",
                if env == AppEnv::Development {
                    "dev-only-jwt-secret-change-in-production"
                } else {
                    ""
                },
            )),
            jwt_access_ttl_secs: parse_u64("JWT_ACCESS_TTL_SECS", 900)?,
            jwt_refresh_ttl_days: parse_u64("JWT_REFRESH_TTL_DAYS", 30)?,
            oauth_github_client_id: get_or("OAUTH_GITHUB_CLIENT_ID", ""),
            oauth_github_client_secret: SecretString::new(get_or("OAUTH_GITHUB_CLIENT_SECRET", "")),
            oauth_google_client_id: get_or("OAUTH_GOOGLE_CLIENT_ID", ""),
            oauth_google_client_secret: SecretString::new(get_or("OAUTH_GOOGLE_CLIENT_SECRET", "")),
            smtp_host: get_or("SMTP_HOST", "smtp-relay.brevo.com"),
            smtp_port: parse_u16("SMTP_PORT", 587)?,
            smtp_user: SecretString::new(get_or("SMTP_USER", "")),
            smtp_pass: SecretString::new(get_or("SMTP_PASS", "")),
            smtp_from: get_or("SMTP_FROM", "noreply@yourdomain.com"),
            smtp_reply_to: get_or("SMTP_REPLY_TO", "support@yourdomain.com"),
            lambda_webhook_secret: SecretString::new(get_or(
                "LAMBDA_WEBHOOK_SECRET",
                if env == AppEnv::Development {
                    "dev-only-lambda-hmac-secret-change-in-production"
                } else {
                    ""
                },
            )),
            r2_account_id: get_or("R2_ACCOUNT_ID", ""),
            r2_access_key_id: SecretString::new(get_or("R2_ACCESS_KEY_ID", "")),
            r2_secret_access_key: SecretString::new(get_or("R2_SECRET_ACCESS_KEY", "")),
            r2_bucket_name: get_or("R2_BUCKET_NAME", "codexter-media"),
            r2_public_base_url: get_or("R2_PUBLIC_BASE_URL", ""),
            aws_lambda_video_fn: get_or("AWS_LAMBDA_VIDEO_FN", "codexter-video-compressor"),
            msg_flush_interval_ms: parse_u64("MSG_FLUSH_INTERVAL_MS", 250)?,
            counter_flush_interval_ms: parse_u64("COUNTER_FLUSH_INTERVAL_MS", 500)?,
            cors_allowed_origins: get_or(
                "CORS_ALLOWED_ORIGINS",
                if env == AppEnv::Development {
                    "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173,https://localhost,capacitor://localhost"
                } else {
                    ""
                },
            )
            .split(',')
            .map(|s| s.trim().trim_end_matches('/').to_string())
            .filter(|s| !s.is_empty())
            .collect(),
            worker_roles,
        };

        cfg.validate()?;
        Ok(cfg)
    }

    /// Enforces startup invariants (`INV-13`): production deployments hard-fail if
    /// critical secrets are missing, too short (< 32 chars), or still use dev defaults.
    pub fn validate(&self) -> Result<(), ConfigError> {
        if self.msg_flush_interval_ms == 0 || self.counter_flush_interval_ms == 0 {
            return Err(ConfigError::InvalidValue {
                key: "MSG_FLUSH_INTERVAL_MS",
                reason: "flush intervals must be > 0 ms".to_string(),
            });
        }

        if self.env == AppEnv::Production {
            let checks: [(&str, bool); 7] = [
                ("DATABASE_URL", self.database_url.is_empty()),
                ("VALKEY_URL", self.valkey_url.is_empty()),
                (
                    "JWT_SECRET",
                    self.jwt_secret.is_empty()
                        || self.jwt_secret.expose().starts_with("dev-only-")
                        || self.jwt_secret.expose().len() < 32,
                ),
                (
                    "LAMBDA_WEBHOOK_SECRET",
                    self.lambda_webhook_secret.is_empty()
                        || self.lambda_webhook_secret.expose().starts_with("dev-only-")
                        || self.lambda_webhook_secret.expose().len() < 32,
                ),
                ("R2_ACCOUNT_ID", self.r2_account_id.trim().is_empty()),
                ("R2_ACCESS_KEY_ID", self.r2_access_key_id.is_empty()),
                ("R2_SECRET_ACCESS_KEY", self.r2_secret_access_key.is_empty()),
            ];

            for (name, failed) in checks {
                if failed {
                    return Err(ConfigError::ProductionGuardrail(format!(
                        "{name} must be configured securely in production"
                    )));
                }
            }
        }

        Ok(())
    }
}
