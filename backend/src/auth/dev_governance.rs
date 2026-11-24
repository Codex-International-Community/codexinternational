use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use chrono::{DateTime, Duration, Utc};
use fred::interfaces::{KeysInterface, PubsubInterface};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::auth::extractor::AuthUser;
use crate::error::AppError;
use crate::state::AppState;

/// Returns the numeric hierarchy weight for a platform badge + role.
/// Higher weight outranks lower weight when managing dev/platform roles.
pub fn platform_weight(platform_role: &str, platform_badge: Option<&str>) -> i32 {
    match platform_badge.map(str::trim) {
        Some("Founder") => 100,
        Some("Vice Founder") => 80,
        Some("Senior Admin") => 60,
        Some("Admin") => 40,
        Some("Moderator") => 20,
        _ => match platform_role {
            "dev" => 10,
            "moderator" => 5,
            _ => 0,
        },
    }
}

/// Checks whether a `dev` user currently has an active, non-expired On-Duty session
/// for the given community.
pub async fn is_dev_on_duty(
    pg: &PgPool,
    dev_user_id: Uuid,
    community_id: Uuid,
) -> Result<bool, AppError> {
    let active: bool = sqlx::query_scalar(
        "SELECT EXISTS(
            SELECT 1 FROM dev_on_duty_sessions
            WHERE dev_user_id = $1
              AND community_id = $2
              AND ended_at IS NULL
              AND expires_at > NOW()
        )",
    )
    .bind(dev_user_id)
    .bind(community_id)
    .fetch_one(pg)
    .await?;

    Ok(active)
}

/// Inserts an audit log entry that automatically expires after 30 days.
pub async fn record_audit_log(
    pg: &PgPool,
    actor_id: Uuid,
    community_id: Option<Uuid>,
    action: &str,
    target_id: Option<Uuid>,
    reason: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO audit_logs (id, actor_id, community_id, action, target_id, reason, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '30 days')",
    )
    .bind(Uuid::now_v7())
    .bind(actor_id)
    .bind(community_id)
    .bind(action)
    .bind(target_id)
    .bind(reason)
    .execute(pg)
    .await?;

    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct StartOnDutyRequest {
    pub community_id: Uuid,
    pub reason: String,
    pub duration_minutes: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct StopOnDutyRequest {
    pub community_id: Uuid,
}

#[derive(Debug, Serialize)]
pub struct OnDutySessionResponse {
    pub id: Uuid,
    pub community_id: Uuid,
    pub reason: String,
    pub started_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct AuditLogEntry {
    pub id: Uuid,
    pub actor_id: Uuid,
    pub community_id: Option<Uuid>,
    pub action: String,
    pub target_id: Option<Uuid>,
    pub reason: Option<String>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

/// `POST /api/v1/dev/on-duty/start` — Activates temporary On-Duty intercept mode
/// for a `dev` user in a target community and records a 30-day audit log.
pub async fn start_on_duty(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(req): Json<StartOnDutyRequest>,
) -> Result<(StatusCode, Json<OnDutySessionResponse>), AppError> {
    if auth.platform_role != "dev" {
        return Err(AppError::Forbidden(
            "only platform dev can start on-duty mode".to_string(),
        ));
    }
    let reason = req.reason.trim();
    if reason.is_empty() {
        return Err(AppError::BadRequest(
            "reason is required to start on-duty mode".to_string(),
        ));
    }

    let mins = req.duration_minutes.unwrap_or(60).clamp(5, 240);
    let now = Utc::now();
    let expires_at = now + Duration::minutes(mins);
    let session_id = Uuid::now_v7();

    sqlx::query(
        "UPDATE dev_on_duty_sessions
         SET ended_at = NOW()
         WHERE dev_user_id = $1 AND community_id = $2 AND ended_at IS NULL",
    )
    .bind(auth.user_id)
    .bind(req.community_id)
    .execute(&state.pg)
    .await?;

    sqlx::query(
        "INSERT INTO dev_on_duty_sessions (id, dev_user_id, community_id, reason, started_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(session_id)
    .bind(auth.user_id)
    .bind(req.community_id)
    .bind(reason)
    .bind(now)
    .bind(expires_at)
    .execute(&state.pg)
    .await?;

    record_audit_log(
        &state.pg,
        auth.user_id,
        Some(req.community_id),
        "DEV_ON_DUTY_START",
        None,
        Some(reason),
    )
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(OnDutySessionResponse {
            id: session_id,
            community_id: req.community_id,
            reason: reason.to_string(),
            started_at: now,
            expires_at,
        }),
    ))
}

/// `POST /api/v1/dev/on-duty/stop` — Ends active On-Duty mode for a `dev` user
/// in the target community and records an audit log.
pub async fn stop_on_duty(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(req): Json<StopOnDutyRequest>,
) -> Result<StatusCode, AppError> {
    if auth.platform_role != "dev" {
        return Err(AppError::Forbidden(
            "only platform dev can stop on-duty mode".to_string(),
        ));
    }

    sqlx::query(
        "UPDATE dev_on_duty_sessions
         SET ended_at = NOW()
         WHERE dev_user_id = $1 AND community_id = $2 AND ended_at IS NULL",
    )
    .bind(auth.user_id)
    .bind(req.community_id)
    .execute(&state.pg)
    .await?;

    record_audit_log(
        &state.pg,
        auth.user_id,
        Some(req.community_id),
        "DEV_ON_DUTY_STOP",
        None,
        None,
    )
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

/// `GET /api/v1/dev/audit-logs` — Shared logs visible to all `dev` users (non-expired, 30-day retention).
pub async fn list_dev_audit_logs(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
) -> Result<Json<Vec<AuditLogEntry>>, AppError> {
    if auth.platform_role != "dev" {
        return Err(AppError::Forbidden(
            "only platform dev can view shared audit logs".to_string(),
        ));
    }

    let logs = sqlx::query_as::<_, AuditLogEntry>(
        "SELECT id, actor_id, community_id, action, target_id, reason, created_at, expires_at
         FROM audit_logs
         WHERE expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT 100",
    )
    .fetch_all(&state.pg)
    .await?;

    Ok(Json(logs))
}

/// `GET /api/v1/communities/{id}/audit-logs` — Community-scoped audit logs visible to members of that server.
pub async fn list_community_audit_logs(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(community_id): Path<Uuid>,
) -> Result<Json<Vec<AuditLogEntry>>, AppError> {
    let has_community_priv: bool = sqlx::query_scalar(
        "SELECT EXISTS(
            SELECT 1 FROM communities WHERE id = $1 AND owner_id = $2
        ) OR EXISTS(
            SELECT 1
            FROM community_members cm
            JOIN community_roles r ON r.id = cm.role_id
            WHERE cm.community_id = $1
              AND cm.user_id = $2
              AND (r.permissions & $3) <> 0
        )",
    )
    .bind(community_id)
    .bind(auth.user_id)
    .bind(
        crate::communities::permissions::PERM_ADMINISTRATOR
            | crate::communities::permissions::PERM_MODERATE_MEMBERS,
    )
    .fetch_one(&state.pg)
    .await?;

    let is_on_duty_dev = if !has_community_priv && auth.platform_role == "dev" {
        is_dev_on_duty(&state.pg, auth.user_id, community_id).await?
    } else {
        false
    };

    if !has_community_priv && !is_on_duty_dev {
        return Err(AppError::Forbidden(
            "only community moderators/admins or on-duty devs can view audit logs".to_string(),
        ));
    }

    let logs = sqlx::query_as::<_, AuditLogEntry>(
        "SELECT id, actor_id, community_id, action, target_id, reason, created_at, expires_at
         FROM audit_logs
         WHERE community_id = $1 AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT 100",
    )
    .bind(community_id)
    .fetch_all(&state.pg)
    .await?;

    Ok(Json(logs))
}

fn ensure_dev(auth: &AuthUser) -> Result<(), AppError> {
    if auth.platform_role != "dev" {
        return Err(AppError::Forbidden(
            "only platform dev can access this endpoint".to_string(),
        ));
    }
    Ok(())
}

fn require_reason(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest("reason is required".to_string()));
    }
    if trimmed.chars().count() > 500 {
        return Err(AppError::BadRequest(
            "reason must be at most 500 characters".to_string(),
        ));
    }
    Ok(trimmed.to_string())
}

const ALLOWED_BADGES: &[&str] = &[
    "Founder",
    "Vice Founder",
    "Senior Admin",
    "Admin",
    "Moderator",
];

const ROOT_KEY_WEIGHT: i32 = 999;

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&x, &y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn has_valid_root_key_str(state: &AppState, candidate: &str) -> bool {
    let configured = state.config.governance_root_key.expose().trim();
    if configured.is_empty() {
        return false;
    }
    constant_time_eq(configured.as_bytes(), candidate.trim().as_bytes())
}

fn has_valid_root_key(state: &AppState, headers: &HeaderMap) -> bool {
    headers
        .get("x-governance-root-key")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|raw| has_valid_root_key_str(state, raw))
}

#[derive(Debug, Deserialize)]
pub struct VerifyRootKeyRequest {
    pub root_key: String,
}

#[derive(Debug, Serialize)]
pub struct VerifyRootKeyResponse {
    pub valid: bool,
    pub weight: i32,
}

/// `POST /api/v1/dev/root-key/verify` — Verifies the env-configured `GOVERNANCE_ROOT_KEY`
/// for temporary super-governance elevation above Founder.
pub async fn verify_root_key(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(req): Json<VerifyRootKeyRequest>,
) -> Result<Json<VerifyRootKeyResponse>, AppError> {
    ensure_dev(&auth)?;
    let valid = has_valid_root_key_str(&state, &req.root_key);
    if !valid {
        return Err(AppError::Forbidden(
            "invalid or unconfigured governance root key".to_string(),
        ));
    }
    Ok(Json(VerifyRootKeyResponse {
        valid: true,
        weight: ROOT_KEY_WEIGHT,
    }))
}

async fn get_actor_weight(
    pg: &PgPool,
    actor_id: Uuid,
) -> Result<(String, Option<String>, i32), AppError> {
    let row: (String, Option<String>) =
        sqlx::query_as("SELECT platform_role, platform_badge FROM users WHERE id = $1")
            .bind(actor_id)
            .fetch_one(pg)
            .await?;
    let w = platform_weight(&row.0, row.1.as_deref());
    Ok((row.0, row.1, w))
}

#[derive(Debug, Serialize, FromRow)]
pub struct ActiveOnDutySession {
    pub id: Uuid,
    pub community_id: Uuid,
    pub community_name: String,
    pub reason: String,
    pub started_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

/// `GET /api/v1/dev/on-duty/active` — Lists active non-expired On-Duty sessions for the current dev.
pub async fn list_active_on_duty(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
) -> Result<Json<Vec<ActiveOnDutySession>>, AppError> {
    ensure_dev(&auth)?;
    let rows = sqlx::query_as::<_, ActiveOnDutySession>(
        "SELECT s.id, s.community_id, c.name AS community_name, s.reason, s.started_at, s.expires_at
         FROM dev_on_duty_sessions s
         JOIN communities c ON c.id = s.community_id
         WHERE s.dev_user_id = $1 AND s.ended_at IS NULL AND s.expires_at > NOW()
         ORDER BY s.started_at DESC",
    )
    .bind(auth.user_id)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct DevUserSearchQuery {
    #[serde(default)]
    pub q: String,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct DevUserSummary {
    pub id: Uuid,
    pub uid: String,
    pub username: String,
    pub display_name: String,
    pub email: String,
    pub platform_role: String,
    pub platform_badge: Option<String>,
    pub is_verified: bool,
    pub suspended_until: Option<DateTime<Utc>>,
    pub suspended_reason: Option<String>,
    pub banned_at: Option<DateTime<Utc>>,
    pub banned_reason: Option<String>,
    pub global_level: i32,
    pub created_at: DateTime<Utc>,
}

/// `GET /api/v1/dev/users?q=...` — Searches users for Dev Panel governance.
pub async fn search_dev_users(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Query(query): Query<DevUserSearchQuery>,
) -> Result<Json<Vec<DevUserSummary>>, AppError> {
    ensure_dev(&auth)?;
    let limit = query.limit.unwrap_or(25).clamp(1, 100);
    let q = query.q.trim();
    let pattern = format!("%{q}%");

    let rows = if q.is_empty() {
        sqlx::query_as::<_, DevUserSummary>(
            "SELECT id, uid, username, display_name, email, platform_role, platform_badge,
                    is_verified, suspended_until, suspended_reason, banned_at, banned_reason,
                    global_level, created_at
             FROM users
             ORDER BY
               CASE WHEN platform_role = 'dev' THEN 0 WHEN platform_role = 'moderator' THEN 1 ELSE 2 END,
               created_at DESC
             LIMIT $1",
        )
        .bind(limit)
        .fetch_all(&state.pg)
        .await?
    } else {
        sqlx::query_as::<_, DevUserSummary>(
            "SELECT id, uid, username, display_name, email, platform_role, platform_badge,
                    is_verified, suspended_until, suspended_reason, banned_at, banned_reason,
                    global_level, created_at
             FROM users
             WHERE username ILIKE $1 OR display_name ILIKE $1 OR email ILIKE $1 OR uid ILIKE $1
             ORDER BY created_at DESC
             LIMIT $2",
        )
        .bind(&pattern)
        .bind(limit)
        .fetch_all(&state.pg)
        .await?
    };

    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct ToggleVerifiedRequest {
    pub is_verified: bool,
    pub reason: Option<String>,
}

/// `PATCH /api/v1/dev/users/{id}/verified` — Grants or revokes Community Verified flag.
pub async fn set_user_verified(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(target_id): Path<Uuid>,
    Json(req): Json<ToggleVerifiedRequest>,
) -> Result<Json<DevUserSummary>, AppError> {
    ensure_dev(&auth)?;
    let updated = sqlx::query_as::<_, DevUserSummary>(
        "UPDATE users
         SET is_verified = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, uid, username, display_name, email, platform_role, platform_badge,
                   is_verified, suspended_until, suspended_reason, banned_at, banned_reason,
                   global_level, created_at",
    )
    .bind(req.is_verified)
    .bind(target_id)
    .fetch_optional(&state.pg)
    .await?
    .ok_or_else(|| AppError::NotFound("user not found".to_string()))?;

    let action = if req.is_verified {
        "DEV_VERIFY_USER"
    } else {
        "DEV_UNVERIFY_USER"
    };
    record_audit_log(
        &state.pg,
        auth.user_id,
        None,
        action,
        Some(target_id),
        req.reason.as_deref(),
    )
    .await?;

    Ok(Json(updated))
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserGovernanceRequest {
    pub platform_role: String,
    pub platform_badge: Option<String>,
    pub reason: Option<String>,
    pub root_key: Option<String>,
}

/// `PATCH /api/v1/dev/users/{id}/governance` — Updates a user's `platform_role` and `platform_badge`
/// respecting `platform_weight` hierarchy.
pub async fn update_user_governance(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(target_id): Path<Uuid>,
    Json(req): Json<UpdateUserGovernanceRequest>,
) -> Result<Json<DevUserSummary>, AppError> {
    ensure_dev(&auth)?;
    let root_override = has_valid_root_key(&state, &headers)
        || req
            .root_key
            .as_deref()
            .is_some_and(|k| has_valid_root_key_str(&state, k));
    if target_id == auth.user_id && !root_override {
        return Err(AppError::BadRequest(
            "cannot modify your own platform role or badge".to_string(),
        ));
    }

    let next_role = req.platform_role.trim();
    if !matches!(next_role, "user" | "moderator" | "dev") {
        return Err(AppError::BadRequest(
            "platform_role must be 'user', 'moderator', or 'dev'".to_string(),
        ));
    }

    let next_badge = req
        .platform_badge
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    if let Some(ref b) = next_badge
        && !ALLOWED_BADGES.contains(&b.as_str())
    {
        return Err(AppError::BadRequest(
            "platform_badge must be one of: Founder, Vice Founder, Senior Admin, Admin, Moderator"
                .to_string(),
        ));
    }

    let (_, _, db_actor_weight) = get_actor_weight(&state.pg, auth.user_id).await?;
    let actor_weight = if root_override {
        ROOT_KEY_WEIGHT
    } else {
        db_actor_weight
    };
    let target_curr: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT platform_role, platform_badge FROM users WHERE id = $1")
            .bind(target_id)
            .fetch_optional(&state.pg)
            .await?;
    let Some((target_role, target_badge)) = target_curr else {
        return Err(AppError::NotFound("user not found".to_string()));
    };

    let target_weight = platform_weight(&target_role, target_badge.as_deref());
    let next_weight = platform_weight(next_role, next_badge.as_deref());

    if actor_weight <= target_weight {
        return Err(AppError::Forbidden(
            "insufficient platform hierarchy weight to modify this user".to_string(),
        ));
    }
    if actor_weight <= next_weight {
        return Err(AppError::Forbidden(
            "cannot assign a role or badge equal to or higher than your own weight".to_string(),
        ));
    }

    let updated = sqlx::query_as::<_, DevUserSummary>(
        "UPDATE users
         SET platform_role = $1, platform_badge = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING id, uid, username, display_name, email, platform_role, platform_badge,
                   is_verified, suspended_until, suspended_reason, banned_at, banned_reason,
                   global_level, created_at",
    )
    .bind(next_role)
    .bind(next_badge.as_deref())
    .bind(target_id)
    .fetch_one(&state.pg)
    .await?;

    let summary = format!(
        "role={} badge={}{}",
        next_role,
        next_badge.as_deref().unwrap_or("none"),
        req.reason
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|r| format!(" | {r}"))
            .unwrap_or_default()
    );
    record_audit_log(
        &state.pg,
        auth.user_id,
        None,
        "DEV_ROLE_TAG_UPDATE",
        Some(target_id),
        Some(&summary),
    )
    .await?;

    Ok(Json(updated))
}

#[derive(Debug, Deserialize)]
pub struct SuspendUserRequest {
    pub duration_hours: i64,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
pub struct ReasonRequest {
    pub reason: String,
}

/// `POST /api/v1/dev/users/{id}/suspend` — Temporarily suspends a user (mandatory reason).
pub async fn suspend_user(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(target_id): Path<Uuid>,
    Json(req): Json<SuspendUserRequest>,
) -> Result<Json<DevUserSummary>, AppError> {
    ensure_dev(&auth)?;
    if target_id == auth.user_id {
        return Err(AppError::BadRequest("cannot suspend yourself".to_string()));
    }
    let reason = require_reason(&req.reason)?;
    let hours = req.duration_hours.clamp(1, 24 * 365);

    let (_, _, actor_weight) = get_actor_weight(&state.pg, auth.user_id).await?;
    let target_curr: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT platform_role, platform_badge FROM users WHERE id = $1")
            .bind(target_id)
            .fetch_optional(&state.pg)
            .await?;
    let Some((t_role, t_badge)) = target_curr else {
        return Err(AppError::NotFound("user not found".to_string()));
    };
    if actor_weight <= platform_weight(&t_role, t_badge.as_deref()) {
        return Err(AppError::Forbidden(
            "insufficient platform hierarchy weight to suspend this user".to_string(),
        ));
    }

    let until = Utc::now() + Duration::hours(hours);
    let updated = sqlx::query_as::<_, DevUserSummary>(
        "UPDATE users
         SET suspended_until = $1, suspended_reason = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING id, uid, username, display_name, email, platform_role, platform_badge,
                   is_verified, suspended_until, suspended_reason, banned_at, banned_reason,
                   global_level, created_at",
    )
    .bind(until)
    .bind(&reason)
    .bind(target_id)
    .fetch_one(&state.pg)
    .await?;

    if state.valkey_initialized {
        let suspend_key = format!("suspend:user:{target_id}");
        let ttl = (until - Utc::now()).num_seconds().max(1);
        let _ = state
            .valkey
            .set::<(), _, _>(
                &suspend_key,
                until.timestamp().to_string(),
                Some(fred::types::Expiration::EX(ttl)),
                None,
                false,
            )
            .await;
    }

    let log_reason = format!("{hours}h: {reason}");
    record_audit_log(
        &state.pg,
        auth.user_id,
        None,
        "DEV_SUSPEND_USER",
        Some(target_id),
        Some(&log_reason),
    )
    .await?;

    Ok(Json(updated))
}

/// `POST /api/v1/dev/users/{id}/unsuspend` — Lifts an active suspension (mandatory reason).
pub async fn unsuspend_user(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(target_id): Path<Uuid>,
    Json(req): Json<ReasonRequest>,
) -> Result<Json<DevUserSummary>, AppError> {
    ensure_dev(&auth)?;
    let reason = require_reason(&req.reason)?;

    let updated = sqlx::query_as::<_, DevUserSummary>(
        "UPDATE users
         SET suspended_until = NULL, suspended_reason = NULL, updated_at = NOW()
         WHERE id = $1
         RETURNING id, uid, username, display_name, email, platform_role, platform_badge,
                   is_verified, suspended_until, suspended_reason, banned_at, banned_reason,
                   global_level, created_at",
    )
    .bind(target_id)
    .fetch_optional(&state.pg)
    .await?
    .ok_or_else(|| AppError::NotFound("user not found".to_string()))?;

    if state.valkey_initialized {
        let suspend_key = format!("suspend:user:{target_id}");
        let _ = state.valkey.del::<(), _>(&suspend_key).await;
    }

    record_audit_log(
        &state.pg,
        auth.user_id,
        None,
        "DEV_UNSUSPEND_USER",
        Some(target_id),
        Some(&reason),
    )
    .await?;

    Ok(Json(updated))
}

/// `POST /api/v1/dev/users/{id}/ban` — Permanently bans a user and revokes all active device sessions.
pub async fn ban_user(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(target_id): Path<Uuid>,
    Json(req): Json<ReasonRequest>,
) -> Result<Json<DevUserSummary>, AppError> {
    ensure_dev(&auth)?;
    if target_id == auth.user_id {
        return Err(AppError::BadRequest("cannot ban yourself".to_string()));
    }
    let reason = require_reason(&req.reason)?;

    let (_, _, actor_weight) = get_actor_weight(&state.pg, auth.user_id).await?;
    let target_curr: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT platform_role, platform_badge FROM users WHERE id = $1")
            .bind(target_id)
            .fetch_optional(&state.pg)
            .await?;
    let Some((t_role, t_badge)) = target_curr else {
        return Err(AppError::NotFound("user not found".to_string()));
    };
    if actor_weight <= platform_weight(&t_role, t_badge.as_deref()) {
        return Err(AppError::Forbidden(
            "insufficient platform hierarchy weight to ban this user".to_string(),
        ));
    }

    let mut tx = state.pg.begin().await?;
    let updated = sqlx::query_as::<_, DevUserSummary>(
        "UPDATE users
         SET banned_at = NOW(), banned_reason = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, uid, username, display_name, email, platform_role, platform_badge,
                   is_verified, suspended_until, suspended_reason, banned_at, banned_reason,
                   global_level, created_at",
    )
    .bind(&reason)
    .bind(target_id)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "UPDATE user_devices SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
    )
    .bind(target_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    if state.valkey_initialized {
        let ban_key = format!("ban:user:{target_id}");
        let _ = state
            .valkey
            .set::<(), _, _>(
                &ban_key,
                "1",
                Some(fred::types::Expiration::EX(3600)),
                None,
                false,
            )
            .await;
    }

    record_audit_log(
        &state.pg,
        auth.user_id,
        None,
        "DEV_BAN_USER",
        Some(target_id),
        Some(&reason),
    )
    .await?;

    Ok(Json(updated))
}

/// `POST /api/v1/dev/users/{id}/unban` — Lifts a permanent ban (mandatory reason).
pub async fn unban_user(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(target_id): Path<Uuid>,
    Json(req): Json<ReasonRequest>,
) -> Result<Json<DevUserSummary>, AppError> {
    ensure_dev(&auth)?;
    let reason = require_reason(&req.reason)?;

    let updated = sqlx::query_as::<_, DevUserSummary>(
        "UPDATE users
         SET banned_at = NULL, banned_reason = NULL, updated_at = NOW()
         WHERE id = $1
         RETURNING id, uid, username, display_name, email, platform_role, platform_badge,
                   is_verified, suspended_until, suspended_reason, banned_at, banned_reason,
                   global_level, created_at",
    )
    .bind(target_id)
    .fetch_optional(&state.pg)
    .await?
    .ok_or_else(|| AppError::NotFound("user not found".to_string()))?;

    if state.valkey_initialized {
        let ban_key = format!("ban:user:{target_id}");
        let _ = state.valkey.del::<(), _>(&ban_key).await;
    }

    record_audit_log(
        &state.pg,
        auth.user_id,
        None,
        "DEV_UNBAN_USER",
        Some(target_id),
        Some(&reason),
    )
    .await?;

    Ok(Json(updated))
}

/// `POST /api/v1/dev/social/posts/{id}/delete` — Dev deletes any social post with mandatory reason.
pub async fn dev_delete_social_post(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(post_id): Path<Uuid>,
    Json(req): Json<ReasonRequest>,
) -> Result<StatusCode, AppError> {
    ensure_dev(&auth)?;
    let reason = require_reason(&req.reason)?;
    let owner_id = crate::social::repo::dev_delete_post(&state, post_id).await?;
    record_audit_log(
        &state.pg,
        auth.user_id,
        None,
        "DEV_DELETE_SOCIAL_POST",
        Some(owner_id),
        Some(&format!("post={post_id} | {reason}")),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/v1/dev/social/replies/{id}/delete` — Dev deletes any social reply with mandatory reason.
pub async fn dev_delete_social_reply(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(reply_id): Path<Uuid>,
    Json(req): Json<ReasonRequest>,
) -> Result<StatusCode, AppError> {
    ensure_dev(&auth)?;
    let reason = require_reason(&req.reason)?;
    let owner_id = crate::social::repo::dev_delete_reply(&state, reply_id).await?;
    record_audit_log(
        &state.pg,
        auth.user_id,
        None,
        "DEV_DELETE_SOCIAL_REPLY",
        Some(owner_id),
        Some(&format!("reply={reply_id} | {reason}")),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn execute_dev_delete_chat_message(
    state: &AppState,
    dev_user_id: Uuid,
    message_id: Uuid,
    reason: &str,
) -> Result<(), AppError> {
    let row: Option<(Uuid, Option<Uuid>, Option<Uuid>)> = sqlx::query_as(
        "SELECT m.channel_id, m.sender_id, ch.community_id
         FROM messages m
         JOIN channels ch ON ch.id = m.channel_id
         WHERE m.id = $1 AND m.deleted_at IS NULL",
    )
    .bind(message_id)
    .fetch_optional(&state.pg)
    .await?;

    let Some((channel_id, sender_id, maybe_community_id)) = row else {
        return Err(AppError::NotFound("message not found".to_string()));
    };
    let Some(community_id) = maybe_community_id else {
        return Err(AppError::Forbidden(
            "cannot moderate non-community messages".to_string(),
        ));
    };

    if !is_dev_on_duty(&state.pg, dev_user_id, community_id).await? {
        return Err(AppError::Forbidden(
            "active On-Duty session required for this server".to_string(),
        ));
    }

    sqlx::query("UPDATE messages SET content = NULL, deleted_at = NOW() WHERE id = $1")
        .bind(message_id)
        .execute(&state.pg)
        .await?;

    let event = serde_json::json!({"type":"MESSAGE_DELETE","id":message_id,"channelId":channel_id});
    let _: Result<i64, _> = state
        .valkey
        .next()
        .publish(format!("pubsub:ch:{channel_id}"), event.to_string())
        .await;

    record_audit_log(
        &state.pg,
        dev_user_id,
        Some(community_id),
        "DEV_DELETE_CHAT_MESSAGE",
        sender_id,
        Some(&format!("msg={message_id} | {reason}")),
    )
    .await?;

    Ok(())
}

/// `POST /api/v1/dev/chat/messages/{id}/delete` — Dev deletes a server chat message (requires On-Duty + reason).
pub async fn dev_delete_chat_message(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(message_id): Path<Uuid>,
    Json(req): Json<ReasonRequest>,
) -> Result<StatusCode, AppError> {
    ensure_dev(&auth)?;
    let reason = require_reason(&req.reason)?;
    execute_dev_delete_chat_message(&state, auth.user_id, message_id, &reason).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct CreateReportRequest {
    pub target_type: String,
    pub target_id: Uuid,
    pub reason: String,
}

#[derive(Debug, Serialize)]
pub struct CreateReportResponse {
    pub id: Uuid,
    pub status: String,
}

/// `POST /api/v1/reports` — Allows any user to report a social post, reply, or chat message.
pub async fn create_content_report(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(req): Json<CreateReportRequest>,
) -> Result<(StatusCode, Json<CreateReportResponse>), AppError> {
    let reason = require_reason(&req.reason)?;
    let target_type = req.target_type.trim();
    if !matches!(target_type, "social_post" | "social_reply" | "chat_message") {
        return Err(AppError::BadRequest(
            "target_type must be 'social_post', 'social_reply', or 'chat_message'".to_string(),
        ));
    }

    let (target_user_id, community_id): (Option<Uuid>, Option<Uuid>) = match target_type {
        "social_post" => {
            let uid: Option<Uuid> = sqlx::query_scalar("SELECT user_id FROM posts WHERE id = $1")
                .bind(req.target_id)
                .fetch_optional(&state.pg)
                .await?;
            let Some(uid) = uid else {
                return Err(AppError::NotFound("post not found".to_string()));
            };
            (Some(uid), None)
        }
        "social_reply" => {
            let uid: Option<Uuid> =
                sqlx::query_scalar("SELECT user_id FROM post_replies WHERE id = $1")
                    .bind(req.target_id)
                    .fetch_optional(&state.pg)
                    .await?;
            let Some(uid) = uid else {
                return Err(AppError::NotFound("reply not found".to_string()));
            };
            (Some(uid), None)
        }
        "chat_message" => {
            let row: Option<(Option<Uuid>, Option<Uuid>)> = sqlx::query_as(
                "SELECT m.sender_id, ch.community_id
                 FROM messages m
                 JOIN channels ch ON ch.id = m.channel_id
                 WHERE m.id = $1 AND m.deleted_at IS NULL",
            )
            .bind(req.target_id)
            .fetch_optional(&state.pg)
            .await?;
            let Some((uid, cid)) = row else {
                return Err(AppError::NotFound("message not found".to_string()));
            };
            (uid, cid)
        }
        _ => unreachable!(),
    };

    let report_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO content_reports (id, reporter_id, target_type, target_id, target_user_id, community_id, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(report_id)
    .bind(auth.user_id)
    .bind(target_type)
    .bind(req.target_id)
    .bind(target_user_id)
    .bind(community_id)
    .bind(&reason)
    .execute(&state.pg)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(CreateReportResponse {
            id: report_id,
            status: "pending".to_string(),
        }),
    ))
}

#[derive(Debug, Deserialize)]
pub struct ListReportsQuery {
    pub status: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct DevReportItem {
    pub id: Uuid,
    pub reporter_id: Uuid,
    pub reporter_username: String,
    pub target_type: String,
    pub target_id: Uuid,
    pub target_user_id: Option<Uuid>,
    pub target_username: Option<String>,
    pub community_id: Option<Uuid>,
    pub target_preview: Option<String>,
    pub reason: String,
    pub status: String,
    pub resolution_note: Option<String>,
    pub created_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
}

/// `GET /api/v1/dev/reports` — Lists content reports for Dev Panel review.
pub async fn list_dev_reports(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Query(query): Query<ListReportsQuery>,
) -> Result<Json<Vec<DevReportItem>>, AppError> {
    ensure_dev(&auth)?;
    let status = query.status.as_deref().unwrap_or("pending").trim();

    let rows = sqlx::query_as::<_, DevReportItem>(
        "SELECT
            cr.id,
            cr.reporter_id,
            rep.username AS reporter_username,
            cr.target_type,
            cr.target_id,
            cr.target_user_id,
            tgt.username AS target_username,
            cr.community_id,
            CASE
                WHEN cr.target_type = 'social_post' THEN (SELECT LEFT(content, 160) FROM posts WHERE id = cr.target_id)
                WHEN cr.target_type = 'social_reply' THEN (SELECT LEFT(content, 160) FROM post_replies WHERE id = cr.target_id)
                WHEN cr.target_type = 'chat_message' THEN (SELECT LEFT(content, 160) FROM messages WHERE id = cr.target_id AND deleted_at IS NULL)
                ELSE NULL
            END AS target_preview,
            cr.reason,
            cr.status,
            cr.resolution_note,
            cr.created_at,
            cr.resolved_at
         FROM content_reports cr
         JOIN users rep ON rep.id = cr.reporter_id
         LEFT JOIN users tgt ON tgt.id = cr.target_user_id
         WHERE ($1 = 'all' OR cr.status = $1)
         ORDER BY cr.created_at DESC
         LIMIT 100",
    )
    .bind(status)
    .fetch_all(&state.pg)
    .await?;

    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct ResolveReportRequest {
    pub action: String, // 'dismiss' | 'resolve' | 'delete_content'
    pub reason: String,
}

/// `POST /api/v1/dev/reports/{id}/resolve` — Resolves or dismisses a report (optionally deleting the content).
pub async fn resolve_dev_report(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(report_id): Path<Uuid>,
    Json(req): Json<ResolveReportRequest>,
) -> Result<StatusCode, AppError> {
    ensure_dev(&auth)?;
    let reason = require_reason(&req.reason)?;
    let action = req.action.trim();
    if !matches!(action, "dismiss" | "resolve" | "delete_content") {
        return Err(AppError::BadRequest(
            "action must be 'dismiss', 'resolve', or 'delete_content'".to_string(),
        ));
    }

    let report: Option<(String, Uuid, Option<Uuid>, Option<Uuid>)> = sqlx::query_as(
        "SELECT target_type, target_id, target_user_id, community_id FROM content_reports WHERE id = $1",
    )
    .bind(report_id)
    .fetch_optional(&state.pg)
    .await?;
    let Some((target_type, target_id, target_user_id, community_id)) = report else {
        return Err(AppError::NotFound("report not found".to_string()));
    };

    if action == "delete_content" {
        match target_type.as_str() {
            "social_post" => {
                let _ = crate::social::repo::dev_delete_post(&state, target_id).await;
            }
            "social_reply" => {
                let _ = crate::social::repo::dev_delete_reply(&state, target_id).await;
            }
            "chat_message" => {
                execute_dev_delete_chat_message(&state, auth.user_id, target_id, &reason).await?;
            }
            _ => {}
        }
    }

    let next_status = if action == "dismiss" {
        "dismissed"
    } else {
        "resolved"
    };
    sqlx::query(
        "UPDATE content_reports
         SET status = $1, resolved_by = $2, resolution_note = $3, resolved_at = NOW()
         WHERE id = $4",
    )
    .bind(next_status)
    .bind(auth.user_id)
    .bind(&reason)
    .bind(report_id)
    .execute(&state.pg)
    .await?;

    record_audit_log(
        &state.pg,
        auth.user_id,
        community_id,
        "DEV_RESOLVE_REPORT",
        target_user_id,
        Some(&format!("report={report_id} action={action} | {reason}")),
    )
    .await?;

    Ok(StatusCode::NO_CONTENT)
}
