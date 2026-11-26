//! Community IT Moat subsystems:
//! 1. Solved-to-Wiki (Public Q&A knowledge base)
//! 2. Verified Builder Profile (Proof-of-Work & SVG badge)
//! 3. Runnable Code Snippets & Diff-First Review
//! 4. Skill Radar & Smart Question Routing

pub mod bridge;
pub mod builder;
pub mod radar;
pub mod snippets;
pub mod wiki;

use std::sync::Arc;

use axum::{
    Router,
    routing::{get, post},
};

use crate::state::AppState;

/// Mounts `/api/v1/moat/*` routes.
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        // 1. Solved-to-Wiki
        .route("/wiki", get(wiki::list_public_wiki))
        .route("/wiki/{slug}", get(wiki::get_wiki_by_slug))
        .route(
            "/wiki/from-channel/{channel_id}",
            post(wiki::promote_channel_to_wiki),
        )
        .route(
            "/wiki/from-post/{post_id}",
            post(wiki::promote_post_to_wiki),
        )
        // 2. Verified Builder Profile
        .route("/builders/{username}", get(builder::get_builder_profile))
        .route(
            "/builders/{username}/badge.svg",
            get(builder::get_builder_badge_svg),
        )
        // 3. Runnable Code Snippets & Diff-First Review
        .route("/snippets", post(snippets::create_snippet))
        .route("/snippets/{id}", get(snippets::get_snippet))
        .route("/snippets/{id}/ai-explain", post(snippets::explain_snippet))
        // 4. Skill Radar & Smart Question Routing
        .route(
            "/skills/me",
            get(radar::get_my_skills).put(radar::update_my_skills),
        )
        .route(
            "/radar/questions",
            get(radar::list_radar_questions).post(radar::create_radar_question),
        )
        .route(
            "/radar/questions/{id}/solve",
            post(radar::solve_radar_question),
        )
        // 5. Channel <-> Threads Bridge (Open Topic & Resolution Post Reference)
        .route(
            "/channels/{channel_id}/open-thread",
            post(bridge::open_thread_from_channel),
        )
        .route(
            "/channels/{channel_id}/resolution",
            get(bridge::get_channel_resolution)
                .put(bridge::set_channel_resolution)
                .delete(bridge::clear_channel_resolution),
        )
}
