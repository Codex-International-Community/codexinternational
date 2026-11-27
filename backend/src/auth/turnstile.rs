//! Cloudflare Turnstile server-side token verification.

use std::sync::OnceLock;
use std::time::Duration;

use serde::Deserialize;

use crate::{error::AppError, state::AppState};

const SITEVERIFY_URL: &str = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

#[derive(Debug, Deserialize)]
struct SiteVerifyResponse {
    success: bool,
    #[serde(default, rename = "error-codes")]
    error_codes: Vec<String>,
}

/// Verifies a Cloudflare Turnstile token when `CF_TURNSTILE_SECRET_KEY` is configured.
/// When the secret key is empty/unset, verification is skipped so local development
/// and automated tests without a live key continue to work.
pub async fn verify_turnstile(state: &AppState, token: Option<&str>) -> Result<(), AppError> {
    if state.config.cf_turnstile_secret_key.is_empty() {
        return Ok(());
    }

    let token = token
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .ok_or_else(|| AppError::BadRequest("Turnstile verification is required".to_string()))?;

    let client = HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_default()
    });

    let resp = client
        .post(SITEVERIFY_URL)
        .form(&[
            ("secret", state.config.cf_turnstile_secret_key.expose()),
            ("response", token),
        ])
        .send()
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "turnstile siteverify request failed");
            AppError::ServiceUnavailable {
                retry_after_secs: 5,
                message: "Turnstile verification service unavailable".to_string(),
            }
        })?;

    let body: SiteVerifyResponse = resp.json().await.map_err(|e| {
        tracing::warn!(error = %e, "turnstile siteverify invalid response");
        AppError::ServiceUnavailable {
            retry_after_secs: 5,
            message: "Turnstile verification service returned invalid response".to_string(),
        }
    })?;

    if !body.success {
        tracing::debug!(error_codes = ?body.error_codes, "turnstile verification rejected");
        return Err(AppError::BadRequest(
            "Turnstile verification failed. Please retry.".to_string(),
        ));
    }

    Ok(())
}
