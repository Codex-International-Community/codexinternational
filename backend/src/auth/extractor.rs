//! Axum extractor for authenticated human users (`Authorization: Bearer <jwt>`).

use std::sync::Arc;

use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts},
};
use uuid::Uuid;

use crate::{auth::jwt::decode_access_token, error::AppError, state::AppState};

/// Authenticated human user context extracted from a valid Bearer JWT.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: Uuid,
    pub device_id: Uuid,
    pub platform_role: String,
}

impl FromRequestParts<Arc<AppState>> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let auth_header = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| AppError::Unauthorized("missing Authorization header".to_string()))?;

        let token = auth_header
            .strip_prefix("Bearer ")
            .or_else(|| auth_header.strip_prefix("bearer "))
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .ok_or_else(|| {
                AppError::Unauthorized("expected Authorization: Bearer <token>".to_string())
            })?;

        let claims = decode_access_token(token, state.config.jwt_secret.expose())?;

        Ok(Self {
            user_id: claims.sub,
            device_id: claims.sid,
            platform_role: claims.role,
        })
    }
}
