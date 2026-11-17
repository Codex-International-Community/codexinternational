use axum::{extract::{Path, State}, Extension, Json};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::{db::AppState, error::AppError, models::User};

pub async fn list(
    State(state): State<AppState>,
    Extension(_user): Extension<User>,
) -> Result<Json<serde_json::Value>, AppError> {
    let posts: Vec<sqlx::postgres::PgRow> = sqlx::query(
        r#"
        SELECT p.*, u.display_name, u.initials, u.tone,
               (SELECT COUNT(*) FROM social_reactions r WHERE r.post_id=p.id AND r.kind='like') AS likes,
               (SELECT COUNT(*) FROM social_reactions r WHERE r.post_id=p.id AND r.kind='repost') AS reposts
        FROM social_posts p JOIN users u ON u.id = p.author_id
        ORDER BY p.created_at DESC
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    use sqlx::Row;
    let list: Vec<serde_json::Value> = posts
        .into_iter()
        .map(|row| {
            let id: Uuid = row.get("id");
            json!({
                "id": id,
                "author": row.get::<String,_>("display_name"),
                "handle": row.get::<String,_>("display_name").to_lowercase().replace(' ', ""),
                "initials": row.get::<String,_>("initials"),
                "tone": row.get::<String,_>("tone"),
                "time": row.get::<chrono::DateTime<chrono::Utc>,_>("created_at").to_rfc3339(),
                "createdAt": row.get::<chrono::DateTime<chrono::Utc>,_>("created_at").timestamp_millis(),
                "text": row.get::<String,_>("text"),
                "media": row.get::<Option<String>,_>("media"),
                "mediaAlt": row.get::<Option<String>,_>("media_alt"),
                "verified": row.get::<bool,_>("verified"),
                "likes": row.get::<i64,_>("likes"),
                "reposts": row.get::<i64,_>("reposts"),
                "replies": [],
                "liked": false, "reposted": false, "saved": false,
            })
        })
        .collect();
    Ok(Json(json!({ "posts": list })))
}

#[derive(Deserialize)]
pub struct CreatePost {
    pub text: String,
    pub media: Option<String>,
    pub media_alt: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(body): Json<CreatePost>,
) -> Result<Json<serde_json::Value>, AppError> {
    let id: (Uuid,) = sqlx::query_as(
        "INSERT INTO social_posts (author_id, text, media, media_alt)
         VALUES ($1,$2,$3,$4) RETURNING id",
    )
    .bind(user.id)
    .bind(&body.text)
    .bind(body.media)
    .bind(body.media_alt)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(json!({ "id": id.0 })))
}

#[derive(Deserialize)]
pub struct ToggleBody {
    pub kind: String, // 'like' | 'repost' | 'save'
}

pub async fn toggle(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(post_id): Path<Uuid>,
    Json(body): Json<ToggleBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let exists: Option<(i32,)> = sqlx::query_as(
        "SELECT 1 FROM social_reactions WHERE post_id=$1 AND user_id=$2 AND kind=$3",
    )
    .bind(post_id)
    .bind(user.id)
    .bind(&body.kind)
    .fetch_optional(&state.pool)
    .await?;

    if exists.is_some() {
        sqlx::query(
            "DELETE FROM social_reactions WHERE post_id=$1 AND user_id=$2 AND kind=$3",
        )
        .bind(post_id)
        .bind(user.id)
        .bind(&body.kind)
        .execute(&state.pool)
        .await?;
        Ok(Json(json!({ "active": false })))
    } else {
        sqlx::query(
            "INSERT INTO social_reactions (post_id, user_id, kind) VALUES ($1,$2,$3)",
        )
        .bind(post_id)
        .bind(user.id)
        .bind(&body.kind)
        .execute(&state.pool)
        .await?;
        Ok(Json(json!({ "active": true })))
    }
}