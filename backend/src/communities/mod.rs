//! Community domain and REST API modules.

pub mod channels;
pub mod handlers;
pub mod permissions;

use std::sync::Arc;

use axum::{Router, routing::{get, patch, post}};
use crate::state::AppState;

/// REST routes for community membership and channels.
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(handlers::list_communities).post(handlers::create_community))
        .route("/join/{invite_code}", post(handlers::join_community))
        .route(
            "/{community_id}/channels",
            get(channels::list_channels).post(channels::create_channel),
        )
        .route(
            "/{community_id}/members",
            get(channels::list_members),
        )
        .route(
            "/{community_id}/invite",
            get(handlers::get_community_invite),
        )
        .route(
            "/{community_id}",
            patch(handlers::update_community),
        )
}

/// REST route for idempotent 1:1 DM channel creation.
pub fn dms_router() -> Router<Arc<AppState>> {
    Router::new().route("/{target_user_id}", post(channels::create_or_get_dm))
}
