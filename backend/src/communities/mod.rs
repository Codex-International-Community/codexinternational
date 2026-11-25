//! Community domain and REST API modules.

pub mod channels;
pub mod handlers;
pub mod moderation;
pub mod permissions;
pub mod roles;
pub mod server_menu;

use std::sync::Arc;

use crate::state::AppState;
use axum::{
    Router,
    routing::{delete, get, patch, post},
};

/// REST routes for community membership and channels.
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/",
            get(handlers::list_communities).post(handlers::create_community),
        )
        .route("/join/{invite_code}", post(handlers::join_community))
        .route(
            "/{community_id}/channels",
            get(channels::list_channels).post(channels::create_channel),
        )
        .route("/{community_id}/members", get(channels::list_members))
        .route(
            "/{community_id}/invite",
            get(handlers::get_community_invite),
        )
        .route(
            "/{community_id}/roles",
            get(roles::list_roles).post(roles::create_role),
        )
        .route(
            "/{community_id}/roles/{role_id}",
            axum::routing::patch(roles::update_role).delete(roles::delete_role),
        )
        .route(
            "/{community_id}/members/{user_id}/role",
            axum::routing::patch(roles::assign_member_role),
        )
        .route(
            "/{community_id}/members/{user_id}/timeout",
            post(moderation::timeout_member).delete(moderation::clear_timeout_member),
        )
        .route(
            "/{community_id}/members/{user_id}/ban",
            post(moderation::ban_member),
        )
        .route(
            "/{community_id}/bans/{user_id}",
            delete(moderation::unban_member),
        )
        .route(
            "/{community_id}/categories",
            get(server_menu::list_categories).post(server_menu::create_category),
        )
        .route(
            "/{community_id}/categories/{category_id}",
            delete(server_menu::delete_category),
        )
        .route(
            "/{community_id}/events",
            get(server_menu::list_events).post(server_menu::create_event),
        )
        .route(
            "/{community_id}/preferences",
            get(server_menu::get_member_settings).patch(server_menu::update_member_settings),
        )
        .route(
            "/{community_id}/nickname",
            patch(server_menu::update_nickname),
        )
        .route("/{community_id}/leave", post(server_menu::leave_community))
        .route(
            "/{community_id}",
            patch(handlers::update_community).delete(server_menu::delete_community),
        )
}

/// REST route for idempotent 1:1 DM channel creation.
pub fn dms_router() -> Router<Arc<AppState>> {
    Router::new().route("/{target_user_id}", post(channels::create_or_get_dm))
}
