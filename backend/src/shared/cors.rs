//! Strict allowlist CORS middleware for browser Web App and Capacitor origins.
//!
//! Never uses wildcard `*` reflection for unknown origins: only origins listed
//! in `AppConfig.cors_allowed_origins` receive `Access-Control-Allow-Origin`.

use std::sync::Arc;

use axum::{
    body::Body,
    extract::State,
    http::{HeaderName, HeaderValue, Method, Request, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};

use crate::state::AppState;

const ALLOW_METHODS: &str = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const ALLOW_HEADERS: &str = "Authorization, Content-Type";
const EXPOSE_HEADERS: &str = "Retry-After";

/// Handles CORS preflight (`OPTIONS`) and appends allowlist CORS headers when
/// the incoming `Origin` header exactly matches `cors_allowed_origins`.
pub async fn cors_middleware(
    State(state): State<Arc<AppState>>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let origin = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().trim_end_matches('/').to_string());

    let allowed_origin = origin.as_deref().and_then(|orig| {
        state
            .config
            .cors_allowed_origins
            .iter()
            .any(|allowed| allowed == orig)
            .then_some(orig)
    });

    if req.method() == Method::OPTIONS {
        let mut resp = StatusCode::NO_CONTENT.into_response();
        if let Some(orig) = allowed_origin {
            apply_cors_headers(resp.headers_mut(), orig);
        }
        return resp;
    }

    let mut resp = next.run(req).await;
    if let Some(orig) = allowed_origin {
        apply_cors_headers(resp.headers_mut(), orig);
    }
    resp
}

fn apply_cors_headers(headers: &mut axum::http::HeaderMap, origin: &str) {
    if let Ok(origin_val) = HeaderValue::from_str(origin) {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin_val);
        headers.insert(header::VARY, HeaderValue::from_static("Origin"));
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static(ALLOW_METHODS),
        );
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static(ALLOW_HEADERS),
        );
        headers.insert(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            HeaderValue::from_static(EXPOSE_HEADERS),
        );
        headers.insert(
            HeaderName::from_static("access-control-max-age"),
            HeaderValue::from_static("600"),
        );
    }
}
