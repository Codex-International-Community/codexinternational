//! Liveness and deep readiness HTTP probes (`/health/live` and `/health/ready`).
//!
//! - `/health/live`: always returns `200 OK` as long as the Tokio runtime & HTTP
//!   listener are responsive.
//! - `/health/ready`: concurrently pings PostgreSQL (`SELECT 1`) and Valkey (`PING`)
//!   with a strict 2-second timeout, returning `503 Service Unavailable` if either
//!   dependency is unreachable.

use std::{sync::Arc, time::Duration};

use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};
use fred::interfaces::ClientLike;
use serde::Serialize;

use crate::state::AppState;

const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Serialize)]
struct LiveResponse {
    status: &'static str,
}

#[derive(Serialize)]
struct ReadyResponse {
    status: &'static str,
    postgres: &'static str,
    valkey: &'static str,
}

/// Liveness probe: confirms the process is alive and accepting HTTP requests.
pub async fn live() -> impl IntoResponse {
    (StatusCode::OK, Json(LiveResponse { status: "ok" }))
}

/// Readiness probe: verifies PostgreSQL and Valkey connectivity within 2 seconds.
pub async fn ready(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let pg_check = tokio::time::timeout(PROBE_TIMEOUT, sqlx::query("SELECT 1").execute(&state.pg));
    let valkey_check = tokio::time::timeout(PROBE_TIMEOUT, state.valkey.ping::<String>(None));

    let (pg_res, valkey_res) = tokio::join!(pg_check, valkey_check);

    let pg_ok = matches!(pg_res, Ok(Ok(_)));
    let valkey_ok = matches!(valkey_res, Ok(Ok(_)));

    let status_code = if pg_ok && valkey_ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    let body = ReadyResponse {
        status: if pg_ok && valkey_ok {
            "ready"
        } else {
            "degraded"
        },
        postgres: if pg_ok { "up" } else { "down" },
        valkey: if valkey_ok { "up" } else { "down" },
    };

    (status_code, Json(body))
}
