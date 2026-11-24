use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{auth::extractor::AuthUser, error::AppError, state::AppState};

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(list_friends))
        .route("/search", get(search_users))
        .route("/request", post(send_friend_request))
        .route("/requests/{id}/accept", post(accept_friend_request))
        .route("/requests/{id}/decline", post(decline_friend_request))
        .route("/{user_id}", delete(remove_friend))
}

#[derive(Debug, Serialize, FromRow)]
pub struct FriendUserItem {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub uid: String,
    pub bio: String,
    pub last_seen_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct FriendRequestItem {
    pub request_id: Uuid,
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub uid: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct FriendsOverviewResponse {
    pub friends: Vec<FriendUserItem>,
    pub incoming: Vec<FriendRequestItem>,
    pub outgoing: Vec<FriendRequestItem>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct UserSearchItem {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub uid: String,
    pub bio: String,
    pub relation: String, // "friend" | "incoming" | "outgoing" | "none"
}

#[derive(Debug, Deserialize)]
pub struct SearchUsersQuery {
    pub q: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SendFriendRequestBody {
    pub target: String,
}

async fn list_friends(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let friends = sqlx::query_as::<_, FriendUserItem>(
        "SELECT
            u.id AS user_id,
            u.username,
            u.display_name,
            u.uid,
            u.bio,
            u.last_seen_at
         FROM friendships f
         JOIN users u
           ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
         WHERE (f.requester_id = $1 OR f.addressee_id = $1)
           AND f.status = 'ACCEPTED'
           AND (u.suspended_until IS NULL OR u.suspended_until <= NOW())
         ORDER BY u.display_name ASC",
    )
    .bind(auth.user_id)
    .fetch_all(&state.pg)
    .await?;

    let incoming = sqlx::query_as::<_, FriendRequestItem>(
        "SELECT
            f.id AS request_id,
            u.id AS user_id,
            u.username,
            u.display_name,
            u.uid,
            f.created_at
         FROM friendships f
         JOIN users u ON u.id = f.requester_id
         WHERE f.addressee_id = $1
           AND f.status = 'PENDING'
           AND (u.suspended_until IS NULL OR u.suspended_until <= NOW())
         ORDER BY f.created_at DESC",
    )
    .bind(auth.user_id)
    .fetch_all(&state.pg)
    .await?;

    let outgoing = sqlx::query_as::<_, FriendRequestItem>(
        "SELECT
            f.id AS request_id,
            u.id AS user_id,
            u.username,
            u.display_name,
            u.uid,
            f.created_at
         FROM friendships f
         JOIN users u ON u.id = f.addressee_id
         WHERE f.requester_id = $1
           AND f.status = 'PENDING'
           AND (u.suspended_until IS NULL OR u.suspended_until <= NOW())
         ORDER BY f.created_at DESC",
    )
    .bind(auth.user_id)
    .fetch_all(&state.pg)
    .await?;

    Ok(Json(FriendsOverviewResponse {
        friends,
        incoming,
        outgoing,
    }))
}

async fn search_users(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Query(query): Query<SearchUsersQuery>,
) -> Result<impl IntoResponse, AppError> {
    let q = query.q.unwrap_or_default().trim().to_string();
    if q.is_empty() {
        return Ok(Json(Vec::<UserSearchItem>::new()));
    }
    let pattern = format!("%{q}%");

    let rows = sqlx::query_as::<_, UserSearchItem>(
        "SELECT
            u.id AS user_id,
            u.username,
            u.display_name,
            u.uid,
            u.bio,
            COALESCE(
                (SELECT
                    CASE
                        WHEN f.status = 'ACCEPTED' THEN 'friend'
                        WHEN f.requester_id = $1 THEN 'outgoing'
                        ELSE 'incoming'
                    END
                 FROM friendships f
                 WHERE (f.requester_id = $1 AND f.addressee_id = u.id)
                    OR (f.requester_id = u.id AND f.addressee_id = $1)
                 LIMIT 1),
                'none'
            ) AS relation
         FROM users u
         WHERE u.id <> $1
           AND (u.suspended_until IS NULL OR u.suspended_until <= NOW())
           AND (u.username ILIKE $2 OR u.display_name ILIKE $2 OR u.uid = $3)
         ORDER BY
           CASE WHEN LOWER(u.username) = LOWER($3) OR u.uid = $3 THEN 0 ELSE 1 END,
           u.display_name ASC
         LIMIT 20",
    )
    .bind(auth.user_id)
    .bind(&pattern)
    .bind(&q)
    .fetch_all(&state.pg)
    .await?;

    Ok(Json(rows))
}

async fn send_friend_request(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(body): Json<SendFriendRequestBody>,
) -> Result<impl IntoResponse, AppError> {
    let raw = body.target.trim().trim_start_matches('@');
    if raw.is_empty() {
        return Err(AppError::BadRequest("target user is required".to_string()));
    }

    let target_id: Uuid = if let Ok(uuid) = Uuid::parse_str(raw) {
        sqlx::query_scalar(
            "SELECT id FROM users WHERE id = $1 AND (suspended_until IS NULL OR suspended_until <= NOW())",
        )
        .bind(uuid)
        .fetch_optional(&state.pg)
        .await?
        .ok_or_else(|| AppError::NotFound("user not found".to_string()))?
    } else {
        sqlx::query_scalar(
            "SELECT id FROM users
             WHERE (LOWER(username) = LOWER($1) OR uid = $1)
               AND (suspended_until IS NULL OR suspended_until <= NOW())
             LIMIT 1",
        )
        .bind(raw)
        .fetch_optional(&state.pg)
        .await?
        .ok_or_else(|| AppError::NotFound("user not found".to_string()))?
    };

    if target_id == auth.user_id {
        return Err(AppError::BadRequest(
            "cannot send a friend request to yourself".to_string(),
        ));
    }

    // Check existing relationship in either direction.
    let existing: Option<(Uuid, Uuid, String)> = sqlx::query_as(
        "SELECT id, requester_id, status
         FROM friendships
         WHERE (requester_id = $1 AND addressee_id = $2)
            OR (requester_id = $2 AND addressee_id = $1)
         LIMIT 1",
    )
    .bind(auth.user_id)
    .bind(target_id)
    .fetch_optional(&state.pg)
    .await?;

    if let Some((existing_id, requester_id, status)) = existing {
        if status == "ACCEPTED" {
            return Ok((
                StatusCode::OK,
                Json(serde_json::json!({ "status": "ACCEPTED", "request_id": existing_id })),
            ));
        }
        if requester_id == target_id {
            // Mutual request: auto-accept!
            sqlx::query(
                "UPDATE friendships SET status = 'ACCEPTED', updated_at = NOW() WHERE id = $1",
            )
            .bind(existing_id)
            .execute(&state.pg)
            .await?;
            return Ok((
                StatusCode::OK,
                Json(serde_json::json!({ "status": "ACCEPTED", "request_id": existing_id })),
            ));
        }
        return Ok((
            StatusCode::OK,
            Json(serde_json::json!({ "status": "PENDING", "request_id": existing_id })),
        ));
    }

    let request_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO friendships (id, requester_id, addressee_id, status)
         VALUES ($1, $2, $3, 'PENDING')",
    )
    .bind(request_id)
    .bind(auth.user_id)
    .bind(target_id)
    .execute(&state.pg)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "status": "PENDING", "request_id": request_id })),
    ))
}

async fn accept_friend_request(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(request_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let updated = sqlx::query(
        "UPDATE friendships
         SET status = 'ACCEPTED', updated_at = NOW()
         WHERE id = $1 AND addressee_id = $2 AND status = 'PENDING'",
    )
    .bind(request_id)
    .bind(auth.user_id)
    .execute(&state.pg)
    .await?;

    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("friend request not found".to_string()));
    }

    Ok(Json(serde_json::json!({ "status": "ACCEPTED" })))
}

async fn decline_friend_request(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(request_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let deleted = sqlx::query(
        "DELETE FROM friendships
         WHERE id = $1 AND status = 'PENDING' AND (addressee_id = $2 OR requester_id = $2)",
    )
    .bind(request_id)
    .bind(auth.user_id)
    .execute(&state.pg)
    .await?;

    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound("friend request not found".to_string()));
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn remove_friend(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(target_user_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    sqlx::query(
        "DELETE FROM friendships
         WHERE status = 'ACCEPTED'
           AND ((requester_id = $1 AND addressee_id = $2)
             OR (requester_id = $2 AND addressee_id = $1))",
    )
    .bind(auth.user_id)
    .bind(target_user_id)
    .execute(&state.pg)
    .await?;

    Ok(StatusCode::NO_CONTENT)
}
