use axum::{extract::State, Extension, Json};
use serde::Deserialize;
use serde_json::json;

use crate::{db::AppState, error::AppError, models::User};

#[derive(Deserialize)]
pub struct UpdateMe {
    pub display_name: Option<String>,
}

pub async fn get_me(Extension(user): Extension<User>) -> Json<serde_json::Value> {
    Json(json!({ "user": user }))
}

pub async fn update_me(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(body): Json<UpdateMe>,
) -> Result<Json<serde_json::Value>, AppError> {
    if let Some(name) = body.display_name {
        sqlx::query("UPDATE users SET display_name = $1 WHERE id = $2")
            .bind(&name)
            .bind(user.id)
            .execute(&state.pool)
            .await?;
    }
    let fresh: User = sqlx::query_as("SELECT * FROM users WHERE id = $1")
        .bind(user.id)
        .fetch_one(&state.pool)
        .await?;
    Ok(Json(json!({ "user": fresh })))
}