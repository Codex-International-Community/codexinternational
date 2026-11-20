//! HTTP handlers for community lifecycle and membership.

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use rand::{Rng, distributions::Alphanumeric};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{auth::extractor::AuthUser, error::AppError, state::AppState};

#[derive(Debug, Deserialize)]
pub struct CreateCommunityRequest {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_true")]
    pub is_public: bool,
}

#[derive(Debug, Serialize, FromRow)]
pub struct CommunitySummary {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub is_public: bool,
    pub member_count: i64,
}

#[derive(Debug, Serialize)]
pub struct CreateCommunityResponse {
    pub community: CommunitySummary,
    pub invite_code: String,
    pub general_channel_id: Uuid,
}

#[derive(Debug, Serialize)]
pub struct JoinCommunityResponse {
    pub community_id: Uuid,
    pub already_member: bool,
}

fn default_true() -> bool {
    true
}

fn make_slug(name: &str, id: Uuid) -> String {
    let mut base = String::new();
    let mut last_was_separator = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            base.push(ch.to_ascii_lowercase());
            last_was_separator = false;
        } else if !last_was_separator && !base.is_empty() {
            base.push('-');
            last_was_separator = true;
        }
        if base.len() >= 48 {
            break;
        }
    }
    let base = base.trim_matches('-');
    let suffix = &id.simple().to_string()[..8];
    if base.is_empty() {
        format!("community-{suffix}")
    } else {
        format!("{base}-{suffix}")
    }
}

fn make_invite_code() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(12)
        .map(char::from)
        .collect::<String>()
        .to_ascii_uppercase()
}

fn validate_name(raw: &str) -> Result<String, AppError> {
    let name = raw.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(AppError::BadRequest(
            "community name must contain 1-100 characters".to_string(),
        ));
    }
    Ok(name.to_string())
}

pub async fn create_community(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(request): Json<CreateCommunityRequest>,
) -> Result<(StatusCode, Json<CreateCommunityResponse>), AppError> {
    let name = validate_name(&request.name)?;
    let description = request.description.trim();
    if description.chars().count() > 2_000 {
        return Err(AppError::BadRequest(
            "community description must be at most 2000 characters".to_string(),
        ));
    }

    let community_id = Uuid::now_v7();
    let owner_role_id = Uuid::now_v7();
    let admin_role_id = Uuid::now_v7();
    let everyone_role_id = Uuid::now_v7();
    let channel_id = Uuid::now_v7();
    let slug = make_slug(&name, community_id);
    let invite_code = make_invite_code();

    let mut tx = state.pg.begin().await?;

    sqlx::query(
        "INSERT INTO communities (id, owner_id, slug, name, description, is_public, invite_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(community_id)
    .bind(auth.user_id)
    .bind(&slug)
    .bind(&name)
    .bind(description)
    .bind(request.is_public)
    .bind(&invite_code)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO community_roles (id, community_id, name, color, position, permissions, is_default)
         VALUES
           ($1, $4, 'Superadmin', '#F0B232', 1000, $5, FALSE),
           ($2, $4, 'Admin', '#E67E22', 500, $6, FALSE),
           ($3, $4, '@everyone', '#99AAB5', 0, $7, TRUE)",
    )
    .bind(owner_role_id)
    .bind(admin_role_id)
    .bind(everyone_role_id)
    .bind(community_id)
    .bind(crate::communities::permissions::PERM_ADMINISTRATOR)
    .bind(
        crate::communities::permissions::PERM_VIEW_CHANNEL
            | crate::communities::permissions::PERM_SEND_MESSAGES
            | crate::communities::permissions::PERM_MANAGE_MESSAGES
            | crate::communities::permissions::PERM_MANAGE_CHANNELS
            | crate::communities::permissions::PERM_MANAGE_ROLES
            | crate::communities::permissions::PERM_MODERATE_MEMBERS
            | crate::communities::permissions::PERM_MODERATE_CONTRIBUTIONS,
    )
    .bind(
        crate::communities::permissions::PERM_VIEW_CHANNEL
            | crate::communities::permissions::PERM_SEND_MESSAGES,
    )
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO community_members (community_id, user_id, role_id)
         VALUES ($1, $2, $3)",
    )
    .bind(community_id)
    .bind(auth.user_id)
    .bind(owner_role_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO channels (id, community_id, type, name, topic, position, is_private)
         VALUES ($1, $2, 'text', 'general', '', 0, FALSE)",
    )
    .bind(channel_id)
    .bind(community_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO channel_members (channel_id, user_id)
         VALUES ($1, $2)",
    )
    .bind(channel_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok((
        StatusCode::CREATED,
        Json(CreateCommunityResponse {
            community: CommunitySummary {
                id: community_id,
                slug,
                name,
                description: description.to_string(),
                is_public: request.is_public,
                member_count: 1,
            },
            invite_code,
            general_channel_id: channel_id,
        }),
    ))
}

pub async fn list_communities(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
) -> Result<Json<Vec<CommunitySummary>>, AppError> {
    let communities = sqlx::query_as::<_, CommunitySummary>(
        "SELECT c.id, c.slug, c.name, c.description, c.is_public,
                COUNT(DISTINCT member_count.user_id)::BIGINT AS member_count
         FROM community_members mine
         JOIN communities c ON c.id = mine.community_id
         LEFT JOIN community_members member_count ON member_count.community_id = c.id
         WHERE mine.user_id = $1
         GROUP BY c.id
         ORDER BY c.created_at DESC",
    )
    .bind(auth.user_id)
    .fetch_all(&state.pg)
    .await?;

    Ok(Json(communities))
}

pub async fn join_community(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    axum::extract::Path(invite_code): axum::extract::Path<String>,
) -> Result<Json<JoinCommunityResponse>, AppError> {
    let code = invite_code.trim().to_ascii_uppercase();
    if code.is_empty() || code.len() > 32 {
        return Err(AppError::BadRequest("invalid invite code".to_string()));
    }

    let mut tx = state.pg.begin().await?;
    let community = sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT c.id, r.id
         FROM communities c
         JOIN community_roles r ON r.community_id = c.id AND r.is_default = TRUE
         WHERE c.invite_code = $1
         FOR UPDATE OF c",
    )
    .bind(&code)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("invite code not found".to_string()))?;

    let (community_id, default_role_id) = community;
    let banned = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (
           SELECT 1 FROM community_bans
           WHERE community_id = $1 AND user_id = $2
             AND (expires_at IS NULL OR expires_at > NOW())
         )",
    )
    .bind(community_id)
    .bind(auth.user_id)
    .fetch_one(&mut *tx)
    .await?;

    if banned {
        return Err(AppError::Forbidden(
            "you are banned from this community".to_string(),
        ));
    }

    let already_member = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (
           SELECT 1 FROM community_members
           WHERE community_id = $1 AND user_id = $2
         )",
    )
    .bind(community_id)
    .bind(auth.user_id)
    .fetch_one(&mut *tx)
    .await?;

    if !already_member {
        sqlx::query(
            "INSERT INTO community_members (community_id, user_id, role_id)
             VALUES ($1, $2, $3)",
        )
        .bind(community_id)
        .bind(auth.user_id)
        .bind(default_role_id)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "INSERT INTO channel_members (channel_id, user_id)
             SELECT id, $2 FROM channels
             WHERE community_id = $1 AND is_private = FALSE
             ON CONFLICT (channel_id, user_id) DO NOTHING",
        )
        .bind(community_id)
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    Ok(Json(JoinCommunityResponse {
        community_id,
        already_member,
    }))
}

#[derive(Debug, Serialize)]
pub struct CommunityInviteResponse {
    pub invite_code: String,
}

pub async fn get_community_invite(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(community_id): Path<Uuid>,
) -> Result<Json<CommunityInviteResponse>, AppError> {
    let invite_code = sqlx::query_scalar::<_, Option<String>>(
        "SELECT c.invite_code
         FROM communities c
         WHERE c.id = $1
           AND EXISTS (
             SELECT 1 FROM community_members m
             WHERE m.community_id = c.id AND m.user_id = $2
           )",
    )
    .bind(community_id)
    .bind(auth.user_id)
    .fetch_optional(&state.pg)
    .await?
    .flatten()
    .ok_or_else(|| AppError::NotFound("community invite is unavailable".to_string()))?;

    Ok(Json(CommunityInviteResponse { invite_code }))
}

#[derive(Debug, Deserialize)]
pub struct UpdateCommunityRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub is_public: Option<bool>,
}

pub async fn update_community(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(community_id): Path<Uuid>,
    Json(request): Json<UpdateCommunityRequest>,
) -> Result<Json<CommunitySummary>, AppError> {
    let owner_id =
        sqlx::query_scalar::<_, Option<Uuid>>("SELECT owner_id FROM communities WHERE id = $1")
            .bind(community_id)
            .fetch_optional(&state.pg)
            .await?
            .ok_or_else(|| AppError::NotFound("community not found".to_string()))?;

    if owner_id != Some(auth.user_id) {
        return Err(AppError::Forbidden(
            "only the server owner can edit server settings".to_string(),
        ));
    }

    let name = request.name.map(|value| value.trim().to_string());
    if name
        .as_ref()
        .is_some_and(|value| value.is_empty() || value.chars().count() > 100)
    {
        return Err(AppError::BadRequest(
            "server name must contain 1-100 characters".to_string(),
        ));
    }
    let description = request.description.map(|value| value.trim().to_string());
    if description
        .as_ref()
        .is_some_and(|value| value.chars().count() > 2_000)
    {
        return Err(AppError::BadRequest(
            "server description must be at most 2000 characters".to_string(),
        ));
    }
    if name.is_none() && description.is_none() && request.is_public.is_none() {
        return Err(AppError::BadRequest(
            "no server settings were supplied".to_string(),
        ));
    }

    let community = sqlx::query_as::<_, CommunitySummary>(
        "UPDATE communities c
         SET name = COALESCE($2, c.name),
             description = COALESCE($3, c.description),
             is_public = COALESCE($4, c.is_public)
         WHERE c.id = $1
         RETURNING c.id, c.slug, c.name, c.description, c.is_public,
           (SELECT COUNT(*)::BIGINT FROM community_members m WHERE m.community_id = c.id) AS member_count",
    )
    .bind(community_id)
    .bind(name)
    .bind(description)
    .bind(request.is_public)
    .fetch_one(&state.pg)
    .await?;

    Ok(Json(community))
}
