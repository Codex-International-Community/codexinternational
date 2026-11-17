//! Unified HTTP error type (`AppError`) shared across all API handlers.
//!
//! Converts domain, validation, database, and Valkey errors into structured
//! JSON responses (`{ "error": { "code": "...", "message": "..." } }`) with
//! appropriate HTTP status codes and `Retry-After` headers when rate-limited.

use axum::{
    Json,
    http::{HeaderValue, StatusCode, header::RETRY_AFTER},
    response::{IntoResponse, Response},
};
use serde::Serialize;
use thiserror::Error;

/// Canonical application error returned from Axum handlers via `Result<T, AppError>`.
#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),

    #[error("{0}")]
    Unauthorized(String),

    #[error("{0}")]
    Forbidden(String),

    #[error("{0}")]
    NotFound(String),

    #[error("{0}")]
    Conflict(String),

    #[error("{0}")]
    PayloadTooLarge(String),

    #[error("rate limit exceeded; retry after {retry_after_secs}s")]
    TooManyRequests {
        retry_after_secs: u64,
        message: String,
    },

    #[error("service temporarily unavailable; retry after {retry_after_secs}s")]
    ServiceUnavailable {
        retry_after_secs: u64,
        message: String,
    },

    #[error("internal server error")]
    Internal(#[source] anyhow::Error),
}

#[derive(Serialize)]
struct ErrorEnvelope<'a> {
    error: ErrorBody<'a>,
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    code: &'static str,
    message: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    retry_after_secs: Option<u64>,
}

impl AppError {
    /// Maps a `sqlx::Error` into an appropriate HTTP error (e.g. Postgres unique
    /// violation `23505` -> `409 Conflict`, foreign key `23503` -> `400 Bad Request`).
    pub fn from_sqlx(err: sqlx::Error) -> Self {
        if let sqlx::Error::Database(db_err) = &err {
            match db_err.code().as_deref() {
                Some("23505") => {
                    return Self::Conflict("resource already exists".to_string());
                }
                Some("23503") | Some("23514") => {
                    return Self::BadRequest("invalid reference or constraint".to_string());
                }
                _ => {}
            }
        }
        Self::Internal(err.into())
    }
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        Self::from_sqlx(err)
    }
}

impl From<fred::error::Error> for AppError {
    fn from(err: fred::error::Error) -> Self {
        Self::Internal(err.into())
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message, retry_after) = match &self {
            Self::BadRequest(msg) => (StatusCode::BAD_REQUEST, "BAD_REQUEST", msg.as_str(), None),
            Self::Unauthorized(msg) => {
                (StatusCode::UNAUTHORIZED, "UNAUTHORIZED", msg.as_str(), None)
            }
            Self::Forbidden(msg) => (StatusCode::FORBIDDEN, "FORBIDDEN", msg.as_str(), None),
            Self::NotFound(msg) => (StatusCode::NOT_FOUND, "NOT_FOUND", msg.as_str(), None),
            Self::Conflict(msg) => (StatusCode::CONFLICT, "CONFLICT", msg.as_str(), None),
            Self::PayloadTooLarge(msg) => (
                StatusCode::PAYLOAD_TOO_LARGE,
                "PAYLOAD_TOO_LARGE",
                msg.as_str(),
                None,
            ),
            Self::TooManyRequests {
                retry_after_secs,
                message,
            } => (
                StatusCode::TOO_MANY_REQUESTS,
                "TOO_MANY_REQUESTS",
                message.as_str(),
                Some(*retry_after_secs),
            ),
            Self::ServiceUnavailable {
                retry_after_secs,
                message,
            } => (
                StatusCode::SERVICE_UNAVAILABLE,
                "SERVICE_UNAVAILABLE",
                message.as_str(),
                Some(*retry_after_secs),
            ),
            Self::Internal(err) => {
                // Log internal cause server-side without leaking implementation details to clients.
                tracing::error!(error = ?err, "unhandled internal error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "INTERNAL_ERROR",
                    "internal server error",
                    None,
                )
            }
        };

        let body = Json(ErrorEnvelope {
            error: ErrorBody {
                code,
                message,
                retry_after_secs: retry_after,
            },
        });

        let mut response = (status, body).into_response();

        if let Some(secs) = retry_after
            && let Ok(val) = HeaderValue::from_str(&secs.to_string())
        {
            response.headers_mut().insert(RETRY_AFTER, val);
        }

        response
    }
}
