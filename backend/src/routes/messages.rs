use axum::{extract::{Path, State}, Extension, Json};
use serde_json::json;
use uuid::Uuid;

use crate::{db::AppState, error::AppError, models::{CreateMessage, Message, User}};

const SELECT_MSG: &str = r#"
SELECT m.id, m.channel_id, m.author_id, m.text, m.reactions, m.reply_to, m.attachment,
       m.edited, m.created_at,
       u.display_name AS author_name, u.initials AS author_initials, u.tone AS author_tone
FROM messages m
JOIN users u ON u.id = m.author_id
"#;

pub async fn list(
    State(state): State<AppState>,
    Extension(_user): Extension<User>,
    Path(channel_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let rows: Vec<Message> = sqlx::query_as(&format!(
        "{SELECT_MSG} WHERE m.channel_id = $1 ORDER BY m.created_at ASC"
    ))
    .bind(&channel_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(json!({ "messages": rows })))
}

pub async fn create(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(channel_id): Path<String>,
    Json(body): Json<CreateMessage>,
) -> Result<Json<serde_json::Value>, AppError> {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO messages (id, channel_id, author_id, text, reply_to, attachment)
         VALUES ($1,$2,$3,$4,$5,$6)",
    )
    .bind(id)
    .bind(&channel_id)
    .bind(user.id)
    .bind(&body.text)
    .bind(body.reply_to)
    .bind(body.attachment.map(sqlx::types::Json))
    .execute(&state.pool)
    .await?;

    let msg: Message = sqlx::query_as(&format!("{SELECT_MSG} WHERE m.id = $1"))
        .bind(id)
        .fetch_one(&state.pool)
        .await?;
    Ok(Json(json!({ "message": msg })))
}

pub async fn delete(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    sqlx::query("DELETE FROM messages WHERE id = $1 AND author_id = $2")
        .bind(id)
        .bind(user.id)
        .execute(&state.pool)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(serde::Deserialize)]
pub struct ReactBody {
    pub emoji: String,
}

pub async fn react(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<Uuid>,
    Json(body): Json<ReactBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    // simple merge of reactions JSONB
    let row: Option<(sqlx::types::Json<serde_json::Value>,)> =
        sqlx::query_as("SELECT reactions FROM messages WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.pool)
            .await?;
    let Some((sqlx::types::Json(mut reactions),)) = row else {
        return Err(AppError(axum::http::StatusCode::NOT_FOUND, "message not found".into()));
    };
    let obj = reactions.as_object_mut().unwrap();
    let arr = obj.entry(&body.emoji).or_insert_with(|| json!([]));
    let list = arr.as_array_mut().unwrap();
    let uid = user.id.to_string();
    let pos = list.iter().position(|v| v.as_str() == Some(&uid));
    if let Some(i) = pos { list.remove(i); } else { list.push(json!(uid)); }

    sqlx::query("UPDATE messages SET reactions = $1 WHERE id = $2")
        .bind(sqlx::types::Json(&reactions))
        .bind(id)
        .execute(&state.pool)
        .await?;
    Ok(Json(json!({ "reactions": reactions })))
}