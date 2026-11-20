//! Global exponential-backoff rate limiter backed by Valkey (`INV-16`).
//!
//! Every API route shares a single sliding-window + exponential-backoff Lua
//! script:
//! - Normal requests increment `rl:{scope}:{caller_key}` within `window_secs`.
//! - Exceeding `max_requests` increments `strikes` in `rl:backoff:{scope}:{caller_key}`
//!   and computes `cooldown = min(base * 2^(strikes - 1), max_cooldown)`.
//! - `rl:backoff:{scope}:{caller_key}` carries a **24-hour (`86400s`)** TTL so
//!   callers automatically reset to default limits after 24 hours without abuse.

use std::{net::IpAddr, sync::Arc};

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
    let client_ip = extract_client_ip(&req, &state.config.trusted_proxies);
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

/// Checks whether an IP address matches loopback or an entry in `trusted_proxies` (exact IP or IPv4 CIDR).
pub fn is_trusted_proxy(ip: &IpAddr, trusted_proxies: &[String]) -> bool {
    if ip.is_loopback() {
        return true;
    }
    for entry in trusted_proxies {
        if let Ok(trusted_ip) = entry.parse::<IpAddr>()
            && trusted_ip == *ip
        {
            return true;
        }
        if let Some((addr_str, prefix_str)) = entry.split_once('/')
            && let (Ok(net_addr), Ok(prefix_len)) = (
                addr_str.parse::<std::net::Ipv4Addr>(),
                prefix_str.parse::<u32>(),
            )
            && let IpAddr::V4(ipv4) = ip
            && prefix_len <= 32
        {
            let mask = if prefix_len == 0 {
                0
            } else {
                !0u32 << (32 - prefix_len)
            };
            if (u32::from(*ipv4) & mask) == (u32::from(net_addr) & mask) {
                return true;
            }
        }
    }
    false
}

/// Safely extracts the client IP address from the request (`RL-01`).
///
/// Security:
/// - If a peer IP is known via `ConnectInfo<SocketAddr>`, `X-Forwarded-For` and `X-Real-IP`
///   are ONLY accepted if the direct socket peer is a verified trusted proxy or loopback.
/// - If connecting through a trusted reverse proxy, the client IP is taken from `X-Real-IP`
///   or the rightmost valid IP in `X-Forwarded-For` (where proxies append the connecting hop),
///   preventing untrusted clients from injecting spoofed header prefixes.
pub fn extract_client_ip(req: &Request<Body>, trusted_proxies: &[String]) -> String {
    let peer_ip = req
        .extensions()
        .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
        .map(|ci| ci.0.ip());

    if let Some(peer) = peer_ip
        && !is_trusted_proxy(&peer, trusted_proxies)
    {
        return peer.to_string();
    }

    if let Some(real_ip) = req
        .headers()
        .get("x-real-ip")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| s.parse::<IpAddr>().is_ok())
    {
        return real_ip.to_string();
    }

    if let Some(xff) = req
        .headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| {
            s.rsplit(',')
                .map(str::trim)
                .find(|p| p.parse::<IpAddr>().is_ok())
        })
    {
        return xff.to_string();
    }

    if let Some(peer) = peer_ip {
        return peer.to_string();
    }

    "127.0.0.1".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::ConnectInfo;
    use std::net::SocketAddr;

    #[test]
    fn test_is_trusted_proxy() {
        let loopback: IpAddr = "127.0.0.1".parse().unwrap();
        let loopback_v6: IpAddr = "::1".parse().unwrap();
        let public_ip: IpAddr = "203.0.113.1".parse().unwrap();
        let private_ip: IpAddr = "10.1.2.3".parse().unwrap();

        let trusted = vec!["10.0.0.0/8".to_string(), "198.51.100.5".to_string()];

        assert!(is_trusted_proxy(&loopback, &trusted));
        assert!(is_trusted_proxy(&loopback_v6, &trusted));
        assert!(is_trusted_proxy(&private_ip, &trusted));
        assert!(is_trusted_proxy(&"198.51.100.5".parse().unwrap(), &trusted));
        assert!(!is_trusted_proxy(&public_ip, &trusted));
        assert!(!is_trusted_proxy(&"192.168.1.1".parse().unwrap(), &trusted));
    }

    #[test]
    fn test_extract_client_ip_untrusted_peer_cannot_spoof_headers() {
        let peer_addr: SocketAddr = "203.0.113.55:12345".parse().unwrap();
        let mut req = Request::builder()
            .header("x-forwarded-for", "1.1.1.1, 8.8.8.8")
            .header("x-real-ip", "9.9.9.9")
            .body(Body::empty())
            .unwrap();
        req.extensions_mut().insert(ConnectInfo(peer_addr));

        let trusted = vec!["127.0.0.1".to_string()];
        let ip = extract_client_ip(&req, &trusted);
        assert_eq!(
            ip, "203.0.113.55",
            "untrusted peer must be locked to direct socket peer IP"
        );
    }

    #[test]
    fn test_extract_client_ip_trusted_proxy_extracts_rightmost_forwarded_hop() {
        let proxy_addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
        let mut req = Request::builder()
            // Client sent 1.1.1.1, proxy appended real client IP 198.51.100.77
            .header("x-forwarded-for", "1.1.1.1, 198.51.100.77")
            .body(Body::empty())
            .unwrap();
        req.extensions_mut().insert(ConnectInfo(proxy_addr));

        let trusted = vec!["127.0.0.1".to_string()];
        let ip = extract_client_ip(&req, &trusted);
        assert_eq!(
            ip, "198.51.100.77",
            "must extract the rightmost hop appended by the trusted proxy"
        );
    }

    #[test]
    fn test_extract_client_ip_trusted_proxy_prefers_x_real_ip() {
        let proxy_addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
        let mut req = Request::builder()
            .header("x-real-ip", "198.51.100.88")
            .header("x-forwarded-for", "1.1.1.1")
            .body(Body::empty())
            .unwrap();
        req.extensions_mut().insert(ConnectInfo(proxy_addr));

        let trusted = vec!["127.0.0.1".to_string()];
        let ip = extract_client_ip(&req, &trusted);
        assert_eq!(ip, "198.51.100.88");
    }
}
