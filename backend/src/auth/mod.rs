pub mod oauth;

use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use tower_sessions::Session;
use uuid::Uuid;

use crate::{db::AppState, error::AppError, models::User};

pub const SESSION_USER_KEY: &str = "user_id";

pub async fn require_auth(
    State(state): State<AppState>,
    session: Session,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let user_id: Option<Uuid> = session.get(SESSION_USER_KEY).await.ok().flatten();
    let Some(id) = user_id else {
        return Err(AppError(StatusCode::UNAUTHORIZED, "Not signed in".into()));
    };
    let user: Option<User> = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;
    let Some(user) = user else {
        return Err(AppError(StatusCode::UNAUTHORIZED, "User not found".into()));
    };
    req.extensions_mut().insert(user);
    Ok(next.run(req).await)
}

pub fn initials_from(name: &str) -> String {
    name.split_whitespace()
        .filter_map(|w| w.chars().next())
        .take(2)
        .collect::<String>()
        .to_uppercase()
}

pub fn tone_for(seed: &str) -> String {
    const TONES: [&str; 6] = ["rose", "blue", "amber", "green", "violet", "pink"];
    let sum: u32 = seed.bytes().map(|b| b as u32).sum();
    TONES[(sum as usize) % TONES.len()].to_string()
}

pub async fn upsert_user(
    pool: &sqlx::PgPool,
    provider: &str,
    provider_id: &str,
    email: Option<&str>,
    display_name: &str,
) -> anyhow::Result<User> {
    let initials = initials_from(display_name);
    let tone = tone_for(provider_id);
    let user = sqlx::query_as::<_, User>(
        r#"
        INSERT INTO users (provider, provider_id, email, display_name, initials, tone)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (provider, provider_id)
        DO UPDATE SET email = EXCLUDED.email,
                      display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), users.display_name)
        RETURNING *
        "#,
    )
    .bind(provider)
    .bind(provider_id)
    .bind(email)
    .bind(display_name)
    .bind(&initials)
    .bind(&tone)
    .fetch_one(pool)
    .await?;
    Ok(user)
}