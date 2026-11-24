//! Binary entrypoint for the CodexInternational backend.
//!
//! Responsibilities at startup:
//! 1. Initialize structured JSON logging (`tracing-subscriber`).
//! 2. Load and validate `.env` / OS configuration (`INV-13` hard-fail on error).
//! 3. Connect `AppState` (PostgreSQL pool + Valkey command pool & Pub/Sub client).
//! 4. Bind the Axum HTTP/WebSocket server on `BIND_ADDR` with graceful shutdown.

use std::sync::Arc;

use backend::{
    app_router,
    chat::{flusher::run_message_flusher, ws::start_pubsub_dispatcher},
    config::AppConfig,
    shared::db::run_migrations,
    social::flusher::run_social_flusher,
    state::AppState,
};
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    // Emit JSON logs suitable for cloud log aggregators; controlled via RUST_LOG.
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .json()
        .init();

    // Fail fast (exit 1) if production guardrails or env parsing fail (INV-13).
    let cfg = match AppConfig::from_env() {
        Ok(cfg) => cfg,
        Err(err) => {
            tracing::error!(error = %err, "startup configuration failed");
            std::process::exit(1);
        }
    };

    let bind_addr = cfg.bind_addr.clone();
    tracing::info!(
        env = ?cfg.env,
        bind_addr = %bind_addr,
        roles = ?cfg.worker_roles,
        "configuration loaded"
    );

    let state = match AppState::connect(cfg).await {
        Ok(state) => Arc::new(state),
        Err(err) => {
            tracing::error!(error = %err, "failed to connect backend dependencies");
            std::process::exit(1);
        }
    };

    if let Err(err) = run_migrations(&state.pg).await {
        tracing::error!(error = %err, "failed to run database migrations");
        std::process::exit(1);
    }

    tokio::spawn(run_message_flusher(state.clone()));
    tokio::spawn(run_social_flusher(state.clone()));
    start_pubsub_dispatcher(state.clone());

    let listener = match TcpListener::bind(&bind_addr).await {
        Ok(listener) => listener,
        Err(err) => {
            tracing::error!(error = %err, bind_addr = %bind_addr, "failed to bind TCP listener");
            std::process::exit(1);
        }
    };

    tracing::info!(bind_addr = %bind_addr, "server listening");

    let service = app_router(state).into_make_service_with_connect_info::<std::net::SocketAddr>();
    if let Err(err) = axum::serve(listener, service)
        .with_graceful_shutdown(shutdown_signal())
        .await
    {
        tracing::error!(error = %err, "axum server exited with error");
        std::process::exit(1);
    }
}

/// Resolves on Ctrl+C (and SIGTERM on Unix) for clean server shutdown.
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        use tokio::signal::unix::{SignalKind, signal};
        if let Ok(mut sig) = signal(SignalKind::terminate()) {
            sig.recv().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }

    tracing::info!("shutdown signal received");
}
