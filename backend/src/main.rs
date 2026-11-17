mod auth;
mod config;
mod db;
mod error;
mod models;
mod routes;

use axum::{
    middleware,
    routing::{delete, get, patch, post},
    Router,
};
use std::net::SocketAddr;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tower_sessions::{Expiry, SessionManagerLayer};
use tower_sessions_sqlx_store::PostgresStore;
use axum::http::{header, HeaderValue, Method};

use crate::{
    auth::require_auth,
    config::Config,
    db::AppState,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,tower_http=info".into()),
        )
        .init();

    let config = Config::from_env()?;
    let pool = db::connect(&config.database_url).await?;

    let session_store = PostgresStore::new(pool.clone());
    session_store.migrate().await?;

    let session_layer = SessionManagerLayer::new(session_store)
        .with_secure(false) // dev only — set true in prod with HTTPS
        .with_expiry(Expiry::OnInactivity(tower_sessions::cookie::time::Duration::days(14)));

    let cors = CorsLayer::new()
    .allow_origin(config.app_url.parse::<HeaderValue>()?)
    .allow_credentials(true)
    .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE, Method::OPTIONS])
    .allow_headers([header::CONTENT_TYPE]);

    let state = AppState {
        pool: pool.clone(),
        config: config.clone(),
    };

    // public routes (no auth)
    let public = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/auth/mock-login", post(auth::oauth::mock_login))
        .route("/auth/logout", post(auth::oauth::logout))
        .route("/auth/google", get(auth::oauth::google_start))
        .route("/auth/google/callback", get(auth::oauth::google_callback))
        .route("/auth/github", get(auth::oauth::github_start))
        .route("/auth/github/callback", get(auth::oauth::github_callback))
        .route("/auth/discord", get(auth::oauth::discord_start))
        .route("/auth/discord/callback", get(auth::oauth::discord_callback));

    // protected routes
    let protected = Router::new()
        .route("/api/me", get(routes::me::get_me).patch(routes::me::update_me))
        .route("/api/servers", get(routes::servers::list).post(routes::servers::create))
        .route("/api/channels/:channel_id/messages", get(routes::messages::list).post(routes::messages::create))
        .route("/api/messages/:id", delete(routes::messages::delete))
        .route("/api/messages/:id/react", post(routes::messages::react))
        .route("/api/dm/:other_user", get(routes::dm::list).post(routes::dm::send))
        .route("/api/social/posts", get(routes::social::list).post(routes::social::create))
        .route("/api/social/posts/:post_id/toggle", post(routes::social::toggle))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_auth));

    let app = Router::new()
        .merge(public)
        .merge(protected)
        .layer(session_layer)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr: SocketAddr = format!("0.0.0.0:{}", config.port).parse()?;
    tracing::info!("🚀 API listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

// minimal `time` shim so we don't need the whole crate
mod time {
    pub struct Duration;
    impl Duration {
        pub fn days(n: i64) -> std::time::Duration {
            std::time::Duration::from_secs(60 * 60 * 24 * n as u64)
        }
    }
}