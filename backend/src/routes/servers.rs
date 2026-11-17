use axum::{extract::State, Extension, Json};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;

use crate::{db::AppState, error::AppError, models::{Channel, Server, User}};

pub async fn list(
    State(state): State<AppState>,
    Extension(_user): Extension<User>,
) -> Result<Json<serde_json::Value>, AppError> {
    let servers: Vec<Server> =
        sqlx::query_as("SELECT id, name, abbr, tone, owner_id FROM servers ORDER BY created_at")
            .fetch_all(&state.pool)
            .await?;

    let rows: Vec<Channel> = sqlx::query_as(
        "SELECT id, server_id, name, type AS kind, position FROM channels ORDER BY server_id, position",
    )
    .fetch_all(&state.pool)
    .await?;

    let mut grouped: HashMap<String, Vec<Channel>> = HashMap::new();
    for c in rows {
        grouped.entry(c.server_id.clone()).or_default().push(c);
    }

    Ok(Json(json!({ "servers": servers, "channels": grouped })))
}

#[derive(Deserialize)]
pub struct CreateServer {
    pub name: String,
    pub abbr: Option<String>,
    pub tone: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(body): Json<CreateServer>,
) -> Result<Json<serde_json::Value>, AppError> {
    let id = slug(&body.name);
    sqlx::query(
        "INSERT INTO servers (id, name, abbr, tone, owner_id) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING",
    )
    .bind(&id)
    .bind(&body.name)
    .bind(body.abbr.unwrap_or_else(|| body.name.chars().take(2).collect::<String>().to_uppercase()))
    .bind(body.tone.unwrap_or_else(|| "lavender".into()))
    .bind(user.id)
    .execute(&state.pool)
    .await?;

    sqlx::query(
        "INSERT INTO channels (id, server_id, name, type, position) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING",
    )
    .bind(format!("{id}:general"))
    .bind(&id)
    .bind("general")
    .bind("text")
    .bind(0)
    .execute(&state.pool)
    .await?;

    Ok(Json(json!({ "id": id })))
}

fn slug(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}