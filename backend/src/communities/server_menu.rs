//! Server dropdown actions: categories, events and per-member settings.
use std::sync::Arc;
use axum::{Json, extract::{Path, State}, http::StatusCode};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;
use crate::{
 auth::extractor::AuthUser,
 communities::permissions::{has_permission, PERM_MANAGE_CHANNELS, PERM_MANAGE_ROLES},
 error::AppError,
 state::AppState,
};

async fn ensure_member(state: &AppState, community_id: Uuid, user_id: Uuid)
 -> Result<(bool, i64), AppError> {
 let row = sqlx::query_as::<_, (Option<Uuid>, Option<i64>)>(
  "SELECT c.owner_id, r.permissions
   FROM communities c
   LEFT JOIN community_members m ON m.community_id = c.id AND m.user_id = $2
   LEFT JOIN community_roles r ON r.id = m.role_id
   WHERE c.id = $1"
 ).bind(community_id).bind(user_id).fetch_optional(&state.pg).await?
  .ok_or_else(|| AppError::NotFound("server not found".to_string()))?;
 let is_owner = row.0 == Some(user_id);
 let permissions = row.1.unwrap_or(0);
 if !is_owner && row.1.is_none() {
  return Err(AppError::Forbidden("server membership required".to_string()));
 }
 Ok((is_owner, permissions))
}

fn ensure_manage_channels(is_owner: bool, permissions: i64) -> Result<(), AppError> {
 if !is_owner && !has_permission(permissions, PERM_MANAGE_CHANNELS) {
  return Err(AppError::Forbidden("missing MANAGE_CHANNELS permission".to_string()));
 }
 Ok(())
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct CommunityCategory { pub id: Uuid, pub community_id: Uuid, pub name: String, pub position: i32 }

#[derive(Debug, Deserialize)]
pub struct CreateCategoryRequest { pub name: String }

pub async fn list_categories(
 State(state): State<Arc<AppState>>, auth: AuthUser, Path(community_id): Path<Uuid>,
) -> Result<Json<Vec<CommunityCategory>>, AppError> {
 ensure_member(&state, community_id, auth.user_id).await?;
 let rows = sqlx::query_as::<_, CommunityCategory>(
  "SELECT id, community_id, name, position FROM community_categories
   WHERE community_id = $1 ORDER BY position, created_at"
 ).bind(community_id).fetch_all(&state.pg).await?;
 Ok(Json(rows))
}

pub async fn create_category(
 State(state): State<Arc<AppState>>, auth: AuthUser, Path(community_id): Path<Uuid>,
 Json(request): Json<CreateCategoryRequest>,
) -> Result<(StatusCode, Json<CommunityCategory>), AppError> {
 let (owner, perms) = ensure_member(&state, community_id, auth.user_id).await?;
 ensure_manage_channels(owner, perms)?;
 let name = request.name.trim();
 if name.is_empty() || name.chars().count() > 100 || name.chars().any(char::is_control) {
  return Err(AppError::BadRequest("category name must contain 1-100 printable characters".to_string()));
 }
 let position = sqlx::query_scalar::<_, i32>(
  "SELECT COALESCE(MAX(position), -1) + 1 FROM community_categories WHERE community_id = $1"
 ).bind(community_id).fetch_one(&state.pg).await?;
 let row = sqlx::query_as::<_, CommunityCategory>(
  "INSERT INTO community_categories (id, community_id, name, position)
   VALUES ($1, $2, $3, $4) RETURNING id, community_id, name, position"
 ).bind(Uuid::now_v7()).bind(community_id).bind(name).bind(position)
  .fetch_one(&state.pg).await?;
 Ok((StatusCode::CREATED, Json(row)))
}

pub async fn delete_category(
 State(state): State<Arc<AppState>>, auth: AuthUser,
 Path((community_id, category_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, AppError> {
 let (owner, perms) = ensure_member(&state, community_id, auth.user_id).await?;
 ensure_manage_channels(owner, perms)?;
 let result = sqlx::query("DELETE FROM community_categories WHERE id = $1 AND community_id = $2")
  .bind(category_id).bind(community_id).execute(&state.pg).await?;
 if result.rows_affected() == 0 { return Err(AppError::NotFound("category not found".to_string())); }
 Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct CommunityEvent {
 pub id: Uuid, pub community_id: Uuid, pub creator_id: Option<Uuid>,
 pub name: String, pub description: String, pub starts_at: DateTime<Utc>, pub location: String,
}
#[derive(Debug, Deserialize)]
pub struct CreateEventRequest {
 pub name: String, #[serde(default)] pub description: String,
 pub starts_at: DateTime<Utc>, #[serde(default)] pub location: String,
}

pub async fn list_events(
 State(state): State<Arc<AppState>>, auth: AuthUser, Path(community_id): Path<Uuid>,
) -> Result<Json<Vec<CommunityEvent>>, AppError> {
 ensure_member(&state, community_id, auth.user_id).await?;
 let rows = sqlx::query_as::<_, CommunityEvent>(
  "SELECT id, community_id, creator_id, name, description, starts_at, location
   FROM community_events WHERE community_id = $1 AND starts_at >= NOW() - INTERVAL '1 day'
   ORDER BY starts_at"
 ).bind(community_id).fetch_all(&state.pg).await?;
 Ok(Json(rows))
}

pub async fn create_event(
 State(state): State<Arc<AppState>>, auth: AuthUser, Path(community_id): Path<Uuid>,
 Json(request): Json<CreateEventRequest>,
) -> Result<(StatusCode, Json<CommunityEvent>), AppError> {
 let (owner, perms) = ensure_member(&state, community_id, auth.user_id).await?;
 ensure_manage_channels(owner, perms)?;
 let name = request.name.trim();
 let description = request.description.trim();
 let location = request.location.trim();
 if name.is_empty() || name.chars().count() > 100 {
  return Err(AppError::BadRequest("event name must contain 1-100 characters".to_string()));
 }
 if description.chars().count() > 2_000 || location.chars().count() > 200 {
  return Err(AppError::BadRequest("event description or location is too long".to_string()));
 }
 if request.starts_at <= Utc::now() {
  return Err(AppError::BadRequest("event must start in the future".to_string()));
 }
 let row = sqlx::query_as::<_, CommunityEvent>(
  "INSERT INTO community_events (id, community_id, creator_id, name, description, starts_at, location)
   VALUES ($1, $2, $3, $4, $5, $6, $7)
   RETURNING id, community_id, creator_id, name, description, starts_at, location"
 ).bind(Uuid::now_v7()).bind(community_id).bind(auth.user_id).bind(name)
  .bind(description).bind(request.starts_at).bind(location).fetch_one(&state.pg).await?;
 Ok((StatusCode::CREATED, Json(row)))
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct CommunityMemberSettings {
 pub notification_mode: String, pub is_muted: bool, pub allow_direct_messages: bool,
 pub allow_message_requests: bool, pub hide_muted_channels: bool,
}
#[derive(Debug, Deserialize)]
pub struct UpdateMemberSettingsRequest {
 pub notification_mode: Option<String>, pub is_muted: Option<bool>,
 pub allow_direct_messages: Option<bool>, pub allow_message_requests: Option<bool>,
 pub hide_muted_channels: Option<bool>,
}
#[derive(Debug, Serialize)]
pub struct MemberSettingsResponse {
 pub is_owner: bool,
 pub can_manage_roles: bool,
 #[serde(flatten)]
 pub settings: CommunityMemberSettings,
}

fn default_member_settings() -> CommunityMemberSettings {
 CommunityMemberSettings {
  notification_mode: "mentions".to_string(), is_muted: false, allow_direct_messages: true,
  allow_message_requests: true, hide_muted_channels: false,
 }
}

pub async fn get_member_settings(
 State(state): State<Arc<AppState>>, auth: AuthUser, Path(community_id): Path<Uuid>,
) -> Result<Json<MemberSettingsResponse>, AppError> {
 let (is_owner, permissions) = ensure_member(&state, community_id, auth.user_id).await?;
 let settings = sqlx::query_as::<_, CommunityMemberSettings>(
  "SELECT notification_mode, is_muted, allow_direct_messages, allow_message_requests, hide_muted_channels
   FROM community_member_settings WHERE community_id = $1 AND user_id = $2"
 ).bind(community_id).bind(auth.user_id).fetch_optional(&state.pg).await?
  .unwrap_or_else(default_member_settings);
 Ok(Json(MemberSettingsResponse { is_owner, can_manage_roles: is_owner || has_permission(permissions, PERM_MANAGE_ROLES), settings }))
}

pub async fn update_member_settings(
 State(state): State<Arc<AppState>>, auth: AuthUser, Path(community_id): Path<Uuid>,
 Json(request): Json<UpdateMemberSettingsRequest>,
) -> Result<Json<MemberSettingsResponse>, AppError> {
 let (is_owner, permissions) = ensure_member(&state, community_id, auth.user_id).await?;
 if let Some(mode) = request.notification_mode.as_deref()
  && !matches!(mode, "all" | "mentions" | "none") {
  return Err(AppError::BadRequest("notification_mode must be all, mentions or none".to_string()));
 }
 let settings = sqlx::query_as::<_, CommunityMemberSettings>(
  "INSERT INTO community_member_settings
    (community_id, user_id, notification_mode, is_muted, allow_direct_messages, allow_message_requests, hide_muted_channels)
   VALUES ($1, $2, COALESCE($3, 'mentions'), COALESCE($4, FALSE), COALESCE($5, TRUE), COALESCE($6, TRUE), COALESCE($7, FALSE))
   ON CONFLICT (community_id, user_id) DO UPDATE SET
    notification_mode = COALESCE($3, community_member_settings.notification_mode),
    is_muted = COALESCE($4, community_member_settings.is_muted),
    allow_direct_messages = COALESCE($5, community_member_settings.allow_direct_messages),
    allow_message_requests = COALESCE($6, community_member_settings.allow_message_requests),
    hide_muted_channels = COALESCE($7, community_member_settings.hide_muted_channels),
    updated_at = NOW()
   RETURNING notification_mode, is_muted, allow_direct_messages, allow_message_requests, hide_muted_channels"
 ).bind(community_id).bind(auth.user_id).bind(request.notification_mode).bind(request.is_muted)
  .bind(request.allow_direct_messages).bind(request.allow_message_requests).bind(request.hide_muted_channels)
  .fetch_one(&state.pg).await?;
 Ok(Json(MemberSettingsResponse { is_owner, can_manage_roles: is_owner || has_permission(permissions, PERM_MANAGE_ROLES), settings }))
}

#[derive(Debug, Deserialize)]
pub struct UpdateNicknameRequest { pub nickname: Option<String> }
#[derive(Debug, Serialize)]
pub struct NicknameResponse { pub nickname: Option<String> }

pub async fn update_nickname(
 State(state): State<Arc<AppState>>, auth: AuthUser, Path(community_id): Path<Uuid>,
 Json(request): Json<UpdateNicknameRequest>,
) -> Result<Json<NicknameResponse>, AppError> {
 ensure_member(&state, community_id, auth.user_id).await?;
 let nickname = request.nickname.map(|value| value.trim().to_string());
 if nickname.as_ref().is_some_and(|value| value.chars().count() > 64) {
  return Err(AppError::BadRequest("server nickname must be at most 64 characters".to_string()));
 }
 let saved = sqlx::query_scalar::<_, Option<String>>(
  "UPDATE community_members SET nickname = NULLIF($3, '')
   WHERE community_id = $1 AND user_id = $2 RETURNING nickname"
 ).bind(community_id).bind(auth.user_id).bind(nickname).fetch_optional(&state.pg).await?
  .ok_or_else(|| AppError::NotFound("server membership not found".to_string()))?;
 Ok(Json(NicknameResponse { nickname: saved }))
}

pub async fn leave_community(
 State(state): State<Arc<AppState>>, auth: AuthUser, Path(community_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
 let (is_owner, _) = ensure_member(&state, community_id, auth.user_id).await?;
 if is_owner {
  return Err(AppError::Forbidden("server owner must delete the server instead of leaving it".to_string()));
 }
 let mut tx = state.pg.begin().await?;
 sqlx::query(
  "DELETE FROM channel_members WHERE user_id = $1
   AND channel_id IN (SELECT id FROM channels WHERE community_id = $2)"
 ).bind(auth.user_id).bind(community_id).execute(&mut *tx).await?;
 sqlx::query("DELETE FROM community_members WHERE community_id = $1 AND user_id = $2")
  .bind(community_id).bind(auth.user_id).execute(&mut *tx).await?;
 tx.commit().await?;
 Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_community(
 State(state): State<Arc<AppState>>, auth: AuthUser, Path(community_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
 let result = sqlx::query("DELETE FROM communities WHERE id = $1 AND owner_id = $2")
  .bind(community_id).bind(auth.user_id).execute(&state.pg).await?;
 if result.rows_affected() == 0 {
  return Err(AppError::NotFound("server not found or you are not its owner".to_string()));
 }
 Ok(StatusCode::NO_CONTENT)
}
