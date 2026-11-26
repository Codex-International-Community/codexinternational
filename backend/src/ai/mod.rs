//! AI-Native module: DeepSeek v4.1 Flash multi-key pool, pricing/quota guard,
//! Catch Me Up, Smart Semantic Search, Auto-Triage, Slash Commands, and Voice Notes.

pub mod features;
pub mod keys;
pub mod quotas;

use std::sync::Arc;

use axum::{
    Router,
    routing::{get, patch, post},
};

use crate::state::AppState;

/// User-facing `/api/v1/ai/*` routes.
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/limits", get(features::get_ai_limits))
        .route("/search", get(features::semantic_search))
        .route("/voice/transcribe", post(features::transcribe_voice_notes))
        .route(
            "/channels/{channel_id}/catch-me-up",
            post(features::catch_me_up),
        )
        .route(
            "/channels/{channel_id}/command",
            post(features::run_slash_command),
        )
}

/// Dev-only `/api/v1/dev/ai/*` routes for Multi-API-Key pool & auto-triage.
pub fn dev_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/keys", get(keys::list_ai_keys).post(keys::create_ai_key))
        .route(
            "/keys/{id}",
            patch(keys::update_ai_key).delete(keys::delete_ai_key),
        )
        .route("/triage", get(features::list_dev_triage))
        .route("/triage/{report_id}", post(features::trigger_dev_triage))
}
