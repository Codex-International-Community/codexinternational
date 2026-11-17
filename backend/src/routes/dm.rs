use axum::{extract::{Path, State}, Extension, Json};
use serde_json::json;
use uuid::Uuid;

use crate::{db::AppState, error::AppError, models::{CreateMessage, Message, User}};

const SELECT_DM: &str = r#"
SELECT m.id, ''::text AS channel_id, m.author_id, m.text, m.reactions,
       NULL::uuid AS reply_to, m.attachment, m.edited, m.created_at,
       u.display_name AS author_name, u.initials AS author_initials, u.tone AS author_tone
FROM dm_messages m
JOIN users u ON u.id = m.author_id
"#;

async fn find_or_create_thread(
    pool: &sqlx::PgPool,
    a: Uuid,
    b: Uuid,
) -> Result<Uuid, AppError> {
    let (x, y) = if a < b { (a, b) } else { (b, a) };
    if let Some((id,)) =
        sqlx::query_as::<_, (Uuid,)>("SELECT id FROM dm_threads WHERE user_a=$1 AND user_b=$2")
            .bind(x)
            .bind(y)
            .fetch_optional(pool)
            .await?
    {
        return Ok(id);
    }
    let (id,): (Uuid,) =
        sqlx::query_as("INSERT INTO dm_threads (user_a, user_b) VALUES ($1,$2) RETURNING id")
            .bind(x)
            .bind(y)
            .fetch_one(pool)
            .await?;
    Ok(id)
}

pub async fn list(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(other): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let thread = find_or_create_thread(&state.pool, user.id, other).await?;
    let rows: Vec<Message> = sqlx::query_as(&format!(
        "{SELECT_DM} WHERE m.thread_id = $1 ORDER BY m.created_at ASC"
    ))
    .bind(thread)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(json!({ "threadId": thread, "messages": rows })))
}

pub async fn send(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(other): Path<Uuid>,
    Json(body): Json<CreateMessage>,
) -> Result<Json<serde_json::Value>, AppError> {
    let thread = find_or_create_thread(&state.pool, user.id, other).await?;
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO dm_messages (id, thread_id, author_id, text, attachment)
         VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(id)
    .bind(thread)
    .bind(user.id)
    .bind(&body.text)
    .bind(body.attachment.map(sqlx::types::Json))
    .execute(&state.pool)
    .await?;
    let msg: Message = sqlx::query_as(&format!("{SELECT_DM} WHERE m.id = $1"))
        .bind(id)
        .fetch_one(&state.pool)
        .await?;
    Ok(Json(json!({ "message": msg })))
}