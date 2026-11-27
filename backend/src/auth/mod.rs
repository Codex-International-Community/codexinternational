//! Authentication module: password hashing, JWT tokens, devices/FCM, Brevo OTP,
//! OAuth2 (GitHub/Google), extractors, and routes.

pub mod bots;
pub mod dev_governance;
pub mod devices;
pub mod extractor;
pub mod handlers;
pub mod jwt;
pub mod oauth;
pub mod otp;
pub mod password;
pub mod repo;
pub mod turnstile;
pub mod uid;

use std::sync::Arc;

use axum::{
    Router,
    routing::{delete, get, patch, post, put},
};

use crate::state::AppState;

/// Mounts `/api/v1/auth/*` routes onto the application router.
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/register", post(handlers::register))
        .route("/login", post(handlers::login))
        .route("/me", get(handlers::me).patch(handlers::update_profile))
        .route("/me/avatar", patch(handlers::update_avatar))
        .route("/password", put(uid::set_or_change_password))
        .route("/uid-login", patch(uid::toggle_uid_login))
        .route("/refresh", post(devices::refresh))
        .route("/logout", post(devices::logout))
        .route("/otp/send", post(otp::send_otp))
        .route("/otp/verify", post(otp::verify_otp))
        .route("/oauth/{provider}", post(oauth::oauth_login))
}

/// Mounts `/api/v1/bots/*` routes onto the application router.
pub fn bots_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", post(bots::create_bot).get(bots::list_bots))
        .route("/{id}", patch(bots::update_bot))
        .route("/{id}/tokens", post(bots::create_bot_token))
        .route("/{id}/tokens/{token_id}", delete(bots::revoke_bot_token))
}
