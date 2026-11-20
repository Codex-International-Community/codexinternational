//! Community role management and member role assignment.
use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    auth::extractor::AuthUser,
    communities::permissions::{PERM_ADMINISTRATOR, PERM_MANAGE_ROLES, has_permission},
    error::AppError,
    state::AppState,
};

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct CommunityRole {
    pub id: Uuid,
    pub community_id: Uuid,
    pub name: String,
    pub color: String,
    pub position: i32,
    pub permissions: i64,
    pub is_default: bool,
}

#[derive(Debug, Deserialize)]
pub struct CreateRoleRequest {
    pub name: String,
    #[serde(default = "default_role_color")]
    pub color: String,
    #[serde(default)]
    pub permissions: i64,
}

#[derive(Debug, Deserialize)]
pub struct UpdateRoleRequest {
    pub name: Option<String>,
    pub color: Option<String>,
    pub permissions: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct AssignMemberRoleRequest {
    pub role_id: Option<Uuid>,
}

#[derive(Debug, Clone, Copy)]
struct ActorRole {
    is_owner: bool,
    position: i32,
    permissions: i64,
}

fn default_role_color() -> String {
    "#99AAB5".to_string()
}

async fn actor_role(
    state: &AppState,
    community_id: Uuid,
    user_id: Uuid,
) -> Result<ActorRole, AppError> {
    let row = sqlx::query_as::<_, (Option<Uuid>, Option<i32>, Option<i64>)>(
        "SELECT c.owner_id, r.position, r.permissions
         FROM communities c
         LEFT JOIN community_members m ON m.community_id = c.id AND m.user_id = $2
         LEFT JOIN community_roles r ON r.id = m.role_id
         WHERE c.id = $1",
    )
    .bind(community_id)
    .bind(user_id)
    .fetch_optional(&state.pg)
    .await?
    .ok_or_else(|| AppError::NotFound("server not found".to_string()))?;

    let is_owner = row.0 == Some(user_id);
    if !is_owner && row.1.is_none() {
        return Err(AppError::Forbidden(
            "server membership required".to_string(),
        ));
    }

    Ok(ActorRole {
        is_owner,
        position: row.1.unwrap_or(0),
        permissions: row.2.unwrap_or(0),
    })
}

fn ensure_manage_roles(actor: ActorRole) -> Result<(), AppError> {
    if !actor.is_owner && !has_permission(actor.permissions, PERM_MANAGE_ROLES) {
        return Err(AppError::Forbidden(
            "missing MANAGE_ROLES permission".to_string(),
        ));
    }
    Ok(())
}

fn validate_name(raw: &str) -> Result<String, AppError> {
    let name = raw.trim();
    if name.is_empty() || name.chars().count() > 50 || name.chars().any(char::is_control) {
        return Err(AppError::BadRequest(
            "role name must contain 1-50 printable characters".to_string(),
        ));
    }
    Ok(name.to_string())
}

fn validate_color(raw: &str) -> Result<String, AppError> {
    let color = raw.trim();
    let bytes = color.as_bytes();
    if bytes.len() != 7 || bytes[0] != b'#' || !bytes[1..].iter().all(u8::is_ascii_hexdigit) {
        return Err(AppError::BadRequest(
            "role color must be a six-digit hex color".to_string(),
        ));
    }
    Ok(color.to_ascii_uppercase())
}

fn validate_permissions(actor: ActorRole, permissions: i64) -> Result<(), AppError> {
    let known_bits = (1_i64 << 9) - 1;
    if permissions < 0 || (permissions & !known_bits) != 0 {
        return Err(AppError::BadRequest(
            "role contains unknown permission bits".to_string(),
        ));
    }
    if !actor.is_owner && (permissions & PERM_ADMINISTRATOR) != 0 {
        return Err(AppError::Forbidden(
            "only the server owner can grant Administrator".to_string(),
        ));
    }
    if !actor.is_owner
        && !has_permission(actor.permissions, PERM_ADMINISTRATOR)
        && (permissions & !actor.permissions) != 0
    {
        return Err(AppError::Forbidden(
            "you cannot grant permissions you do not have".to_string(),
        ));
    }
    Ok(())
}

pub async fn list_roles(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(community_id): Path<Uuid>,
) -> Result<Json<Vec<CommunityRole>>, AppError> {
    actor_role(&state, community_id, auth.user_id).await?;
    let rows = sqlx::query_as::<_, CommunityRole>(
        "SELECT id, community_id, name, color, position, permissions, is_default
         FROM community_roles
         WHERE community_id = $1
         ORDER BY position DESC, name ASC",
    )
    .bind(community_id)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

pub async fn create_role(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(community_id): Path<Uuid>,
    Json(request): Json<CreateRoleRequest>,
) -> Result<(StatusCode, Json<CommunityRole>), AppError> {
    let actor = actor_role(&state, community_id, auth.user_id).await?;
    ensure_manage_roles(actor)?;
    let name = validate_name(&request.name)?;
    let color = validate_color(&request.color)?;
    validate_permissions(actor, request.permissions)?;

    let position = actor.position.saturating_sub(1);
    let role = sqlx::query_as::<_, CommunityRole>(
        "INSERT INTO community_roles (id, community_id, name, color, position, permissions, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, FALSE)
         RETURNING id, community_id, name, color, position, permissions, is_default",
    )
    .bind(Uuid::now_v7())
    .bind(community_id)
    .bind(name)
    .bind(color)
    .bind(position)
    .bind(request.permissions)
    .fetch_one(&state.pg)
    .await?;
    Ok((StatusCode::CREATED, Json(role)))
}

pub async fn update_role(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path((community_id, role_id)): Path<(Uuid, Uuid)>,
    Json(request): Json<UpdateRoleRequest>,
) -> Result<Json<CommunityRole>, AppError> {
    let actor = actor_role(&state, community_id, auth.user_id).await?;
    ensure_manage_roles(actor)?;

    let existing = sqlx::query_as::<_, CommunityRole>(
        "SELECT id, community_id, name, color, position, permissions, is_default
         FROM community_roles WHERE id = $1 AND community_id = $2",
    )
    .bind(role_id)
    .bind(community_id)
    .fetch_optional(&state.pg)
    .await?
    .ok_or_else(|| AppError::NotFound("role not found".to_string()))?;

    if existing.is_default {
        return Err(AppError::Forbidden(
            "the default @everyone role cannot be edited".to_string(),
        ));
    }
    if !actor.is_owner && existing.position >= actor.position {
        return Err(AppError::Forbidden(
            "you cannot manage a role at or above your highest role".to_string(),
        ));
    }

    let name = request
        .name
        .map(|value| validate_name(&value))
        .transpose()?;
    let color = request
        .color
        .map(|value| validate_color(&value))
        .transpose()?;
    if let Some(permissions) = request.permissions {
        validate_permissions(actor, permissions)?;
    }

    let role = sqlx::query_as::<_, CommunityRole>(
        "UPDATE community_roles SET
           name = COALESCE($3, name),
           color = COALESCE($4, color),
           permissions = COALESCE($5, permissions)
         WHERE id = $1 AND community_id = $2
         RETURNING id, community_id, name, color, position, permissions, is_default",
    )
    .bind(role_id)
    .bind(community_id)
    .bind(name)
    .bind(color)
    .bind(request.permissions)
    .fetch_one(&state.pg)
    .await?;
    Ok(Json(role))
}

pub async fn delete_role(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path((community_id, role_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, AppError> {
    let actor = actor_role(&state, community_id, auth.user_id).await?;
    ensure_manage_roles(actor)?;

    let role = sqlx::query_as::<_, (i32, bool)>(
        "SELECT position, is_default FROM community_roles WHERE id = $1 AND community_id = $2",
    )
    .bind(role_id)
    .bind(community_id)
    .fetch_optional(&state.pg)
    .await?
    .ok_or_else(|| AppError::NotFound("role not found".to_string()))?;

    if role.1 {
        return Err(AppError::Forbidden(
            "the default @everyone role cannot be deleted".to_string(),
        ));
    }
    if !actor.is_owner && role.0 >= actor.position {
        return Err(AppError::Forbidden(
            "you cannot delete a role at or above your highest role".to_string(),
        ));
    }

    sqlx::query("UPDATE community_members SET role_id = (SELECT id FROM community_roles WHERE community_id = $1 AND is_default = TRUE) WHERE community_id = $1 AND role_id = $2")
        .bind(community_id)
        .bind(role_id)
        .execute(&state.pg)
        .await?;
    sqlx::query("DELETE FROM community_roles WHERE id = $1 AND community_id = $2")
        .bind(role_id)
        .bind(community_id)
        .execute(&state.pg)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn assign_member_role(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path((community_id, target_user_id)): Path<(Uuid, Uuid)>,
    Json(request): Json<AssignMemberRoleRequest>,
) -> Result<Json<CommunityRole>, AppError> {
    let actor = actor_role(&state, community_id, auth.user_id).await?;
    ensure_manage_roles(actor)?;

    let target = sqlx::query_as::<_, (Option<Uuid>, Option<i32>)>(
        "SELECT c.owner_id, r.position
         FROM communities c
         JOIN community_members m ON m.community_id = c.id AND m.user_id = $2
         LEFT JOIN community_roles r ON r.id = m.role_id
         WHERE c.id = $1",
    )
    .bind(community_id)
    .bind(target_user_id)
    .fetch_optional(&state.pg)
    .await?
    .ok_or_else(|| AppError::NotFound("server member not found".to_string()))?;

    if target.0 == Some(target_user_id) {
        return Err(AppError::Forbidden(
            "the server owner's role cannot be changed".to_string(),
        ));
    }
    if !actor.is_owner && target.1.unwrap_or(0) >= actor.position {
        return Err(AppError::Forbidden(
            "you cannot change a member with an equal or higher role".to_string(),
        ));
    }

    let role_id = if let Some(role_id) = request.role_id {
        role_id
    } else {
        sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM community_roles WHERE community_id = $1 AND is_default = TRUE",
        )
        .bind(community_id)
        .fetch_one(&state.pg)
        .await?
    };

    let role = sqlx::query_as::<_, CommunityRole>(
        "SELECT id, community_id, name, color, position, permissions, is_default
         FROM community_roles WHERE id = $1 AND community_id = $2",
    )
    .bind(role_id)
    .bind(community_id)
    .fetch_optional(&state.pg)
    .await?
    .ok_or_else(|| AppError::BadRequest("role does not belong to this server".to_string()))?;

    if !actor.is_owner && role.position >= actor.position {
        return Err(AppError::Forbidden(
            "you cannot assign a role at or above your highest role".to_string(),
        ));
    }
    if !actor.is_owner
        && !has_permission(actor.permissions, PERM_ADMINISTRATOR)
        && (role.permissions & !actor.permissions) != 0
    {
        return Err(AppError::Forbidden(
            "you cannot assign permissions you do not have".to_string(),
        ));
    }
    if !actor.is_owner && (role.permissions & PERM_ADMINISTRATOR) != 0 {
        return Err(AppError::Forbidden(
            "only the server owner can assign Administrator".to_string(),
        ));
    }

    sqlx::query(
        "UPDATE community_members SET role_id = $3 WHERE community_id = $1 AND user_id = $2",
    )
    .bind(community_id)
    .bind(target_user_id)
    .bind(role.id)
    .execute(&state.pg)
    .await?;
    Ok(Json(role))
}
