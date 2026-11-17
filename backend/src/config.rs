use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub app_url: String,
    pub api_url: String,
    pub database_url: String,
    pub session_secret: String,
    pub mock_auth: bool,
    pub google: OAuthConfig,
    pub github: OAuthConfig,
    pub discord: OAuthConfig,
}

#[derive(Debug, Clone)]
pub struct OAuthConfig {
    pub client_id: String,
    pub client_secret: String,
    pub enabled: bool,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            port: env::var("PORT").unwrap_or_else(|_| "4000".into()).parse()?,
            app_url: env::var("APP_URL").unwrap_or_else(|_| "http://localhost:5173".into()),
            api_url: env::var("API_URL").unwrap_or_else(|_| "http://localhost:4000".into()),
            database_url: env::var("DATABASE_URL")
                .map_err(|_| anyhow::anyhow!("DATABASE_URL must be set"))?,
            session_secret: env::var("SESSION_SECRET")
                .map_err(|_| anyhow::anyhow!("SESSION_SECRET must be set"))?,
            mock_auth: env::var("MOCK_AUTH").map(|v| v == "true").unwrap_or(false),
            google: oauth_from_env("GOOGLE"),
            github: oauth_from_env("GITHUB"),
            discord: oauth_from_env("DISCORD"),
        })
    }
}

fn oauth_from_env(prefix: &str) -> OAuthConfig {
    let client_id = env::var(format!("{prefix}_CLIENT_ID")).unwrap_or_default();
    let client_secret = env::var(format!("{prefix}_CLIENT_SECRET")).unwrap_or_default();
    OAuthConfig {
        enabled: !client_id.is_empty() && !client_secret.is_empty(),
        client_id,
        client_secret,
    }
}