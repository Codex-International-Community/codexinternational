//! Global exponential-backoff rate limiter backed by Valkey (`INV-16`).
//!
//! Every API route shares a single sliding-window + exponential-backoff Lua
//! script:
//! - Normal requests increment `rl:{scope}:{caller_key}` within `window_secs`.
//! - Exceeding `max_requests` increments `strikes` in `rl:backoff:{scope}:{caller_key}`
//!   and computes `cooldown = min(base * 2^(strikes - 1), max_cooldown)`.
//! - `rl:backoff:{scope}:{caller_key}` carries a **24-hour (`86400s`)** TTL so
//!   callers automatically reset to default limits after 24 hours without abuse.

use std::sync::Arc;

use axum::{
    body::Body,
    extract::State,
    http::{Request, header::AUTHORIZATION},
    middleware::Next,
    response::Response,
};
use chrono::Utc;
use fred::interfaces::{KeysInterface, LuaInterface};

use crate::{auth::jwt::hash_token, error::AppError, state::AppState};

pub const BACKOFF_RESET_WINDOW_SECS: u64 = 86_400; // 24 hours (`INV-16`)

/// Atomically checks active backoff, increments the window counter, and triggers
/// exponential backoff on limit violation with a 24-hour TTL reset.
///
/// KEYS[1] = `rl:{scope}:{key}`
/// KEYS[2] = `rl:backoff:{scope}:{key}`
/// ARGV[1] = now_unix_secs
/// ARGV[2] = max_requests
/// ARGV[3] = window_secs
/// ARGV[4] = base_cooldown_secs
/// ARGV[5] = max_cooldown_secs
/// ARGV[6] = backoff_reset_ttl_secs (86400)
///
/// Returns `[allowed (1|0), retry_after_secs, strikes]`.
pub const GLOBAL_RATE_LIMIT_LUA: &str = r#"
local win_key = KEYS[1]
local backoff_key = KEYS[2]
local now = tonumber(ARGV[1])
local max_req = tonumber(ARGV[2])
local win_secs = tonumber(ARGV[3])
local base_cd = tonumber(ARGV[4])
local max_cd = tonumber(ARGV[5])
local reset_ttl = tonumber(ARGV[6])

local blocked_until = tonumber(redis.call('HGET', backoff_key, 'blocked_until') or '0')
local strikes = tonumber(redis.call('HGET', backoff_key, 'strikes') or '0')

if blocked_until > now then
    return {0, blocked_until - now, strikes}
end

local count = redis.call('INCR', win_key)
if count == 1 then
    redis.call('EXPIRE', win_key, win_secs)
end

if count > max_req then
    strikes = strikes + 1
    local cooldown = math.min(base_cd * (2 ^ (strikes - 1)), max_cd)
    redis.call('HSET', backoff_key, 'strikes', tostring(strikes), 'blocked_until', tostring(now + cooldown))
    redis.call('EXPIRE', backoff_key, reset_ttl)
    return {0, cooldown, strikes}
end

return {1, 0, strikes}
"#;

#[derive(Debug, Clone, Copy)]
pub struct RateLimitPolicy {
    pub scope: &'static str,
    pub max_requests: u64,
    pub window_secs: u64,
    pub base_cooldown_secs: u64,
    pub max_cooldown_secs: u64,
}

impl RateLimitPolicy {
    /// Computes exponential cooldown for a given violation strike count.
    pub fn cooldown_for_strikes(self, strikes: u32) -> u64 {
        if strikes == 0 {
            return 0;
        }
        let exp = strikes.saturating_sub(1).min(16);
        self.base_cooldown_secs
            .saturating_mul(1u64 << exp)
            .min(self.max_cooldown_secs)
    }
}

pub fn policy_for_request(path: &str, is_bot: bool) -> RateLimitPolicy {
    if is_bot {
        return RateLimitPolicy {
            scope: "bot",
            max_requests: 120,
            window_secs: 60,
            base_cooldown_secs: 10,
            max_cooldown_secs: 3_600,
        };
    }

    if path.starts_with("/api/v1/auth/") {
        RateLimitPolicy {
            scope: "auth",
            max_requests: 20,
            window_secs: 60,
            base_cooldown_secs: 10,
            max_cooldown_secs: 3_600,
        }
    } else if path.starts_with("/api/v1/media/presign") {
        RateLimitPolicy {
            scope: "media",
            max_requests: 30,
            window_secs: 60,
            base_cooldown_secs: 15,
            max_cooldown_secs: 3_600,
        }
    } else {
        RateLimitPolicy {
            scope: "api",
            max_requests: 120,
            window_secs: 60,
            base_cooldown_secs: 5,
            max_cooldown_secs: 1_800,
        }
    }
}

/// Evaluates a rate limit policy in Valkey directly (used by middleware and tests).
pub async fn check_rate_limit(
    valkey: &fred::clients::Pool,
    policy: RateLimitPolicy,
    caller_key: &str,
) -> Result<(), AppError> {
    let win_key = format!("rl:{}:{caller_key}", policy.scope);
    let backoff_key = format!("rl:backoff:{}:{caller_key}", policy.scope);
    let now = Utc::now().timestamp();

    let res: Vec<i64> = valkey
        .eval(
            GLOBAL_RATE_LIMIT_LUA,
            vec![win_key, backoff_key],
            vec![
                now.to_string(),
                policy.max_requests.to_string(),
                policy.window_secs.to_string(),
                policy.base_cooldown_secs.to_string(),
                policy.max_cooldown_secs.to_string(),
                BACKOFF_RESET_WINDOW_SECS.to_string(),
            ],
        )
        .await?;

    let allowed = res.first().copied().unwrap_or(1) == 1;
    let retry_after = res
        .get(1)
        .copied()
        .unwrap_or(policy.base_cooldown_secs as i64);

    if !allowed {
        return Err(AppError::TooManyRequests {
            retry_after_secs: retry_after.max(1) as u64,
            message: format!(
                "rate limit exceeded on '{}'; retry after {retry_after}s",
                policy.scope
            ),
        });
    }

    Ok(())
}

/// Resolves the rate-limit policy and caller bucket key for an incoming API request.
///
/// Security:
/// - Public/auth endpoints (`/api/v1/auth/*`) NEVER use the `bot` policy or `bot:` key,
///   preventing unauthenticated callers from rotating arbitrary `Authorization: Bot <rand>`
///   headers to bypass IP rate limits and `INV-16` backoff.
/// - Non-auth routes only switch to the `bot:` bucket when the presented bot token is
///   verified in Valkey's `bot:token:{hash}` cache; unknown/unverified `Bot` headers
///   fall back to the caller IP bucket.
pub async fn resolve_caller_bucket(
    state: &AppState,
    path: &str,
    auth_header: &str,
    client_ip: &str,
) -> (RateLimitPolicy, String) {
    let bot_token = (!path.starts_with("/api/v1/auth/"))
        .then(|| {
            auth_header
                .strip_prefix("Bot ")
                .or_else(|| auth_header.strip_prefix("bot "))
                .map(str::trim)
                .filter(|t| !t.is_empty())
        })
        .flatten();

    if let Some(tok) = bot_token {
        let token_hash = hash_token(tok);
        let cache_key = format!("bot:token:{token_hash}");
        let is_cached_valid_bot = state.valkey_initialized
            && matches!(
                tokio::time::timeout(
                    std::time::Duration::from_millis(100),
                    state.valkey.get::<Option<String>, _>(&cache_key),
                )
                .await,
                Ok(Ok(Some(_)))
            );

        if is_cached_valid_bot {
            return (
                policy_for_request(path, true),
                format!("bot:{}", &token_hash[..16]),
            );
        }
    }

    (policy_for_request(path, false), client_ip.to_string())
}

/// Axum middleware applying global exponential-backoff rate limiting to `/api/v1/*`.
/// Excludes `/health/*` probes and `/ws` upgrade (`INV-14`).
pub async fn rate_limit_middleware(
    State(state): State<Arc<AppState>>,
    req: Request<Body>,
    next: Next,
) -> Result<Response, AppError> {
    let path = req.uri().path();
    if path.starts_with("/health/") || path == "/ws" || !state.valkey_initialized {
        return Ok(next.run(req).await);
    }

    let auth_header = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let client_ip = extract_client_ip(&req);
    let (policy, caller_key) = resolve_caller_bucket(&state, path, auth_header, &client_ip).await;

    match tokio::time::timeout(
        std::time::Duration::from_millis(250),
        check_rate_limit(&state.valkey, policy, &caller_key),
    )
    .await
    {
        Ok(Ok(())) => {}
        Ok(Err(err @ AppError::TooManyRequests { .. })) => return Err(err),
        Ok(Err(err)) => {
            tracing::warn!(error = %err, scope = policy.scope, "rate limiter valkey unavailable");
        }
        Err(_) => {
            tracing::warn!(scope = policy.scope, "rate limiter valkey check timed out");
        }
    }

    Ok(next.run(req).await)
}

fn extract_client_ip(req: &Request<Body>) -> String {
    if let Some(xff) = req
        .headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return xff.to_string();
    }
    if let Some(real_ip) = req
        .headers()
        .get("x-real-ip")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return real_ip.to_string();
    }
    "127.0.0.1".to_string()
}
