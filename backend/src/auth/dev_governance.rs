use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use chrono::{DateTime, Duration, Utc};
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
