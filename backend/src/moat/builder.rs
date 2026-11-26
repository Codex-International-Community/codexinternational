//! Verified Builder Profile: public Proof-of-Work reputation graph & SVG badge.

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::{StatusCode, header::CONTENT_TYPE},
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::FromRow;
use uuid::Uuid;

use crate::{auth::extractor::OptionalAuthUser, error::AppError, state::AppState};

#[derive(Debug, Serialize)]
pub struct BuilderProfileResponse {
    pub user_id: Uuid,
    pub uid: String,
    pub username: String,
    pub display_name: String,
    pub bio: String,
    pub platform_role: String,
    pub platform_badge: Option<String>,
    pub is_verified: bool,
    pub global_xp: i64,
    pub global_level: i32,
    pub approved_contributions: i64,
    pub solved_wiki_count: i64,
    pub posts_count: i64,
    pub skills: Vec<BuilderSkill>,
    pub joined_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct BuilderSkill {
    pub tag: String,
    pub score: i32,
}

#[derive(Debug, FromRow)]
struct BuilderUserRow {
    id: Uuid,
    uid: String,
    username: String,
    display_name: String,
    bio: String,
    platform_role: String,
    platform_badge: Option<String>,
    is_verified: bool,
    global_xp: i64,
    global_level: i32,
    created_at: DateTime<Utc>,
}

async fn load_builder(
    state: &AppState,
    username: &str,
) -> Result<BuilderProfileResponse, AppError> {
    let uname = username.trim().trim_start_matches('@').to_ascii_lowercase();
    let user = sqlx::query_as::<_, BuilderUserRow>(
        "SELECT id, uid, username, display_name, bio, platform_role, platform_badge,
                is_verified, global_xp, global_level, created_at
         FROM users
         WHERE LOWER(username) = $1 OR uid = $1",
    )
    .bind(&uname)
    .fetch_optional(&state.pg)
    .await?
    .ok_or_else(|| AppError::NotFound("builder profile not found".into()))?;

    let approved_contributions: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM contributions WHERE user_id = $1 AND status = 'APPROVED'",
    )
    .bind(user.id)
    .fetch_one(&state.pg)
    .await?;

    let solved_wiki_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM wiki_articles WHERE solved_by_id = $1 OR author_id = $1",
    )
    .bind(user.id)
    .fetch_one(&state.pg)
    .await?;

    let posts_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM posts WHERE user_id = $1")
        .bind(user.id)
        .fetch_one(&state.pg)
        .await?;

    let skills = sqlx::query_as::<_, BuilderSkill>(
        "SELECT tag, score
         FROM user_skill_tags
         WHERE user_id = $1 AND opt_in = TRUE
         ORDER BY score DESC, tag ASC
         LIMIT 12",
    )
    .bind(user.id)
    .fetch_all(&state.pg)
    .await?;

    Ok(BuilderProfileResponse {
        user_id: user.id,
        uid: user.uid,
        username: user.username,
        display_name: user.display_name,
        bio: user.bio,
        platform_role: user.platform_role,
        platform_badge: user.platform_badge,
        is_verified: user.is_verified,
        global_xp: user.global_xp,
        global_level: user.global_level,
        approved_contributions,
        solved_wiki_count,
        posts_count,
        skills,
        joined_at: user.created_at,
    })
}

/// `GET /api/v1/moat/builders/{username}` (Public Read-Only)
pub async fn get_builder_profile(
    State(state): State<Arc<AppState>>,
    OptionalAuthUser(_viewer): OptionalAuthUser,
    Path(username): Path<String>,
) -> Result<Json<BuilderProfileResponse>, AppError> {
    Ok(Json(load_builder(&state, &username).await?))
}

/// `GET /api/v1/moat/builders/{username}/badge.svg` (Public SVG for GitHub README)
pub async fn get_builder_badge_svg(
    State(state): State<Arc<AppState>>,
    Path(username): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let profile = load_builder(&state, &username).await?;
    let label = format!("Codex @{}", escape_xml(&profile.username));
    let stats = format!(
        "Lv.{} | {} XP | {} Solved",
        profile.global_level, profile.global_xp, profile.solved_wiki_count
    );

    let svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="340" height="28" role="img" aria-label="{label}: {stats}">
  <rect width="145" height="28" rx="4" fill="#111113"/>
  <rect x="145" width="195" height="28" rx="4" fill="#1458AD"/>
  <text x="72" y="18" fill="#F4F4F6" font-family="system-ui,sans-serif" font-size="11" font-weight="600" text-anchor="middle">{label}</text>
  <text x="242" y="18" fill="#FFFFFF" font-family="system-ui,sans-serif" font-size="11" font-weight="600" text-anchor="middle">{stats}</text>
</svg>"##
    );

    Ok((
        StatusCode::OK,
        [(CONTENT_TYPE, "image/svg+xml; charset=utf-8")],
        svg,
    ))
}

fn escape_xml(raw: &str) -> String {
    raw.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
