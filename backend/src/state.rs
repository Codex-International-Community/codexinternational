//! Shared application state (`AppState`) injected into Axum handlers and
//! background workers via `axum::extract::State<Arc<AppState>>`.
//!
//! Holds the PostgreSQL connection pool and **dual Valkey connections** (`P§7` #2):
//! - `valkey`: a multiplexed `fred::clients::Pool` for regular commands (`INCR`, `XADD`, Lua).
//! - `valkey_sub`: a dedicated `fred::clients::SubscriberClient` for Pub/Sub so
//!   subscription traffic never causes head-of-line blocking on command paths.

use std::time::Duration;

use fred::{
    clients::{Pool, SubscriberClient},
    prelude::*,
};
use sqlx::{PgPool, postgres::PgPoolOptions};
use thiserror::Error;

use crate::config::AppConfig;

#[derive(Debug, Error)]
pub enum StateError {
    #[error("postgres initialization failed: {0}")]
    Postgres(#[from] sqlx::Error),

    #[error("valkey initialization failed: {0}")]
    Valkey(#[from] fred::error::Error),
}

/// Shared runtime dependencies cloned via `Arc<AppState>` across all requests.
#[derive(Clone)]
pub struct AppState {
    pub config: AppConfig,
    pub pg: PgPool,
    pub valkey: Pool,
    pub valkey_sub: SubscriberClient,
}

impl AppState {
    /// Connects to PostgreSQL and Valkey (eagerly verifying both connections).
    /// Use this during normal server startup so misconfigured dependencies fail fast.
    pub async fn connect(config: AppConfig) -> Result<Self, StateError> {
        let state = Self::build_pools(config)?;

        // Eagerly establish initial connections so startup catches bad credentials early.
        sqlx::query("SELECT 1").execute(&state.pg).await?;
        state.valkey.init().await?;
        state.valkey_sub.init().await?;

        Ok(state)
    }

    /// Creates lazy pools without performing network I/O at construction time.
    /// Useful for integration tests verifying `/health/ready` returns `503` when
    /// Postgres or Valkey are unreachable.
    pub fn connect_lazy(config: AppConfig) -> Result<Self, StateError> {
        Self::build_pools(config)
    }

    fn build_pools(config: AppConfig) -> Result<Self, StateError> {
        let pg = PgPoolOptions::new()
            .max_connections(25)
            .acquire_timeout(Duration::from_secs(3))
            .connect_lazy(config.database_url.expose())?;

        // `fred::types::Config::from_url` parses `redis://` / `rediss://`; normalize
        // `valkey://` / `valkeys://` so `.env` can cleanly use `valkey://`.
        let valkey_url = normalize_valkey_url(config.valkey_url.expose());
        let fred_cfg = Config::from_url(&valkey_url)?;

        let reconnect = ReconnectPolicy::new_exponential(0, 100, 5_000, 2);

        let valkey = Builder::from_config(fred_cfg.clone())
            .set_policy(reconnect.clone())
            .with_connection_config(|c| {
                c.connection_timeout = Duration::from_secs(2);
                c.tcp = TcpConfig {
                    nodelay: Some(true),
                    ..Default::default()
                };
            })
            .build_pool(4)?;

        let valkey_sub = Builder::from_config(fred_cfg)
            .set_policy(reconnect)
            .with_connection_config(|c| {
                c.connection_timeout = Duration::from_secs(2);
            })
            .build_subscriber_client()?;

        Ok(Self {
            config,
            pg,
            valkey,
            valkey_sub,
        })
    }
}

/// Converts `valkey://` (or `valkeys://`) to `redis://` (`rediss://`) for RESP
/// URL parsers while keeping `.env` Valkey-native.
pub fn normalize_valkey_url(raw: &str) -> String {
    if let Some(rest) = raw.strip_prefix("valkey://") {
        format!("redis://{rest}")
    } else if let Some(rest) = raw.strip_prefix("valkeys://") {
        format!("rediss://{rest}")
    } else {
        raw.to_string()
    }
}
