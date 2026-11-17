use axum::{
    extract::{Query, State},
    response::{IntoResponse, Redirect},
    Json,
};
use serde::Deserialize;
use serde_json::json;
use tower_sessions::Session;

use crate::{
    auth::{upsert_user, SESSION_USER_KEY},
    config::{Config, OAuthConfig},
    db::AppState,
    error::AppError,
};

/* ═════════════ MOCK AUTH (dev only) ═════════════ */

#[derive(Debug, Deserialize)]
pub struct MockLoginBody {
    pub name: Option<String>,
    pub provider: Option<String>,
}

pub async fn mock_login(
    State(state): State<AppState>,
    session: Session,
    Json(body): Json<MockLoginBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !state.config.mock_auth {
        return Err(AppError(axum::http::StatusCode::BAD_REQUEST, "mock auth disabled".into()));
    }
    let name = body.name.unwrap_or_else(|| "Guest".into());
    let provider = body.provider.unwrap_or_else(|| "mock".into());
    let provider_id = uuid::Uuid::new_v4().to_string();
    let email = format!(
        "{}@codex.dev",
        name.to_lowercase().replace(' ', ".")
    );
    let user = upsert_user(&state.pool, &provider, &provider_id, Some(&email), &name).await?;
    session.insert(SESSION_USER_KEY, user.id).await.map_err(|e| {
        AppError(axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;
    Ok(Json(json!({ "user": user })))
}

pub async fn logout(session: Session) -> impl IntoResponse {
    let _ = session.delete().await;
    Json(json!({ "ok": true }))
}

/* ═════════════ GOOGLE ═════════════ */

pub async fn google_start(State(state): State<AppState>) -> impl IntoResponse {
    let cfg = &state.config;
    if cfg.mock_auth {
        return Redirect::to(&format!("{}/?mock=1", cfg.app_url));
    }
    if !cfg.google.enabled {
        return Redirect::to(&format!("{}/?error=google_not_configured", cfg.app_url));
    }
    let params = format!(
        "client_id={}&redirect_uri={}/auth/google/callback&response_type=code&scope={}&prompt=select_account",
        urlencoding::encode(&cfg.google.client_id),
        urlencoding::encode(&cfg.api_url),
        urlencoding::encode("openid email profile"),
    );
    Redirect::to(&format!("https://accounts.google.com/o/oauth2/v2/auth?{params}"))
}

#[derive(Deserialize)]
pub struct OAuthCallback {
    pub code: String,
}

#[derive(Deserialize)]
struct GoogleToken {
    access_token: String,
}

#[derive(Deserialize)]
struct GoogleUser {
    sub: String,
    email: Option<String>,
    name: Option<String>,
}

pub async fn google_callback(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<OAuthCallback>,
) -> Result<Redirect, AppError> {
    let cfg = &state.config;
    if cfg.mock_auth {
        return Ok(Redirect::to(&format!("{}/home", cfg.app_url)));
    }
    let client = reqwest::Client::new();
    let token: GoogleToken = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("code", q.code.as_str()),
            ("client_id", cfg.google.client_id.as_str()),
            ("client_secret", cfg.google.client_secret.as_str()),
            ("redirect_uri", &format!("{}/auth/google/callback", cfg.api_url)),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await?
        .json()
        .await?;

    let profile: GoogleUser = client
        .get("https://openidconnect.googleapis.com/v1/userinfo")
        .bearer_auth(&token.access_token)
        .send()
        .await?
        .json()
        .await?;

    let display = profile.name.unwrap_or_else(|| "Google User".into());
    let user = upsert_user(
        &state.pool,
        "google",
        &profile.sub,
        profile.email.as_deref(),
        &display,
    )
    .await?;
    session.insert(SESSION_USER_KEY, user.id).await.ok();
    Ok(Redirect::to(&format!("{}/home", cfg.app_url)))
}

/* ═════════════ GITHUB ═════════════ */

pub async fn github_start(State(state): State<AppState>) -> impl IntoResponse {
    let cfg = &state.config;
    if cfg.mock_auth {
        return Redirect::to(&format!("{}/?mock=1", cfg.app_url));
    }
    if !cfg.github.enabled {
        return Redirect::to(&format!("{}/?error=github_not_configured", cfg.app_url));
    }
    let params = format!(
        "client_id={}&redirect_uri={}/auth/github/callback&scope=read:user%20user:email",
        urlencoding::encode(&cfg.github.client_id),
        urlencoding::encode(&cfg.api_url),
    );
    Redirect::to(&format!("https://github.com/login/oauth/authorize?{params}"))
}

#[derive(Deserialize)]
struct GithubToken {
    access_token: String,
}

#[derive(Deserialize)]
struct GithubUser {
    id: u64,
    login: String,
    name: Option<String>,
    email: Option<String>,
}

pub async fn github_callback(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<OAuthCallback>,
) -> Result<Redirect, AppError> {
    let cfg = &state.config;
    if cfg.mock_auth {
        return Ok(Redirect::to(&format!("{}/home", cfg.app_url)));
    }
    let client = reqwest::Client::new();
    let token: GithubToken = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "client_id": cfg.github.client_id,
            "client_secret": cfg.github.client_secret,
            "code": q.code,
        }))
        .send()
        .await?
        .json()
        .await?;

    let profile: GithubUser = client
        .get("https://api.github.com/user")
        .header("User-Agent", "codex-community")
        .bearer_auth(&token.access_token)
        .send()
        .await?
        .json()
        .await?;

    let display = profile.name.unwrap_or(profile.login);
    let user = upsert_user(
        &state.pool,
        "github",
        &profile.id.to_string(),
        profile.email.as_deref(),
        &display,
    )
    .await?;
    session.insert(SESSION_USER_KEY, user.id).await.ok();
    Ok(Redirect::to(&format!("{}/home", cfg.app_url)))
}

/* ═════════════ DISCORD ═════════════ */

pub async fn discord_start(State(state): State<AppState>) -> impl IntoResponse {
    let cfg = &state.config;
    if cfg.mock_auth {
        return Redirect::to(&format!("{}/?mock=1", cfg.app_url));
    }
    if !cfg.discord.enabled {
        return Redirect::to(&format!("{}/?error=discord_not_configured", cfg.app_url));
    }
    let params = format!(
        "client_id={}&redirect_uri={}/auth/discord/callback&response_type=code&scope=identify%20email",
        urlencoding::encode(&cfg.discord.client_id),
        urlencoding::encode(&cfg.api_url),
    );
    Redirect::to(&format!("https://discord.com/oauth2/authorize?{params}"))
}

#[derive(Deserialize)]
struct DiscordToken {
    access_token: String,
}

#[derive(Deserialize)]
struct DiscordUser {
    id: String,
    username: String,
    global_name: Option<String>,
    email: Option<String>,
}

pub async fn discord_callback(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<OAuthCallback>,
) -> Result<Redirect, AppError> {
    let cfg = &state.config;
    if cfg.mock_auth {
        return Ok(Redirect::to(&format!("{}/home", cfg.app_url)));
    }
    let client = reqwest::Client::new();
    let token: DiscordToken = client
        .post("https://discord.com/api/oauth2/token")
        .form(&[
            ("client_id", cfg.discord.client_id.as_str()),
            ("client_secret", cfg.discord.client_secret.as_str()),
            ("grant_type", "authorization_code"),
            ("code", q.code.as_str()),
            ("redirect_uri", &format!("{}/auth/discord/callback", cfg.api_url)),
        ])
        .send()
        .await?
        .json()
        .await?;

    let profile: DiscordUser = client
        .get("https://discord.com/api/users/@me")
        .bearer_auth(&token.access_token)
        .send()
        .await?
        .json()
        .await?;

    let display = profile.global_name.unwrap_or(profile.username);
    let user = upsert_user(
        &state.pool,
        "discord",
        &profile.id,
        profile.email.as_deref(),
        &display,
    )
    .await?;
    session.insert(SESSION_USER_KEY, user.id).await.ok();
    Ok(Redirect::to(&format!("{}/home", cfg.app_url)))
}

/* Unused helper — keep OAuthConfig imported */
#[allow(dead_code)]
fn _unused(_: &OAuthConfig, _: &Config) {}