//! JWT Access Token signing/verification and opaque Refresh Token helpers.

use jsonwebtoken::{
    Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode, get_current_timestamp,
};
use rand::{RngCore, rngs::OsRng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::AppError;

/// Claims embedded inside short-lived HS256 JWT access tokens.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Claims {
    pub sub: Uuid,
    pub sid: Uuid,
    pub role: String,
    pub iat: u64,
    pub exp: u64,
}

/// Issues a signed HS256 JWT access token with `ttl_secs` expiration.
pub fn encode_access_token(
    user_id: Uuid,
    device_id: Uuid,
    platform_role: &str,
    secret: &str,
    ttl_secs: u64,
) -> Result<String, AppError> {
    let now = get_current_timestamp();
    let claims = Claims {
        sub: user_id,
        sid: device_id,
        role: platform_role.to_string(),
        iat: now,
        exp: now.saturating_add(ttl_secs),
    };

    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(anyhow::anyhow!("jwt encode failed: {e}")))
}

/// Verifies signature and expiration of an HS256 JWT access token.
pub fn decode_access_token(token: &str, secret: &str) -> Result<Claims, AppError> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    validation.leeway = 5;

    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map(|data| data.claims)
    .map_err(|_| AppError::Unauthorized("invalid or expired access token".to_string()))
}

/// Generates a 256-bit cryptographically random opaque refresh token and its
/// SHA-256 hex digest (only the digest is stored in PostgreSQL `user_devices`).
pub fn generate_refresh_token() -> (String, String) {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let raw = hex::encode(bytes);
    let hash = hash_token(&raw);
    (raw, hash)
}

/// Computes lowercase hex SHA-256 of an opaque token for storage/lookup.
pub fn hash_token(raw: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    hex::encode(hasher.finalize())
}
