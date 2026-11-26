//! DeepSeek v4.1 Flash pricing model & per-tier Add-on quota guardrails.

use chrono::Utc;
use fred::interfaces::KeysInterface;
use serde::Serialize;
use uuid::Uuid;

use crate::{error::AppError, state::AppState};

/// Official DeepSeek v4.1 Flash pricing (USD) from provider spec:
/// - 1M Context, Concurrency Limit 2500
/// - Input Cache Hit: $0.003 off-peak / $0.006 peak
/// - Input Cache Miss: $0.15 off-peak / $0.30 peak
/// - Output: $0.60 off-peak / $1.20 peak
/// - Search/Fetch API: $0.75 / 1,000 req
/// - File Parsing / OCR: $0.225 / 1,000 pages
/// - TTS: $0.45 ($0.225 promo) / 10,000 chars
/// - ASR (Speech-to-Text): $0.116 ($0.058 promo) / hour
#[derive(Debug, Clone, Serialize)]
pub struct DeepSeekPricingSpec {
    pub model_name: &'static str,
    pub context_length: u32,
    pub concurrency_limit: u32,
    pub input_cache_hit_per_1m_usd: (f64, f64),
    pub input_cache_miss_per_1m_usd: (f64, f64),
    pub output_per_1m_usd: (f64, f64),
    pub search_fetch_per_1k_usd: f64,
    pub ocr_per_1k_pages_usd: f64,
    pub tts_per_10k_chars_usd: f64,
    pub asr_per_hour_usd: f64,
}

pub const DEEPSEEK_V4_1_FLASH_PRICING: DeepSeekPricingSpec = DeepSeekPricingSpec {
    model_name: "DeepSeek v4.1 Flash",
    context_length: 1_000_000,
    concurrency_limit: 2_500,
    input_cache_hit_per_1m_usd: (0.003, 0.006),
    input_cache_miss_per_1m_usd: (0.15, 0.30),
    output_per_1m_usd: (0.60, 1.20),
    search_fetch_per_1k_usd: 0.75,
    ocr_per_1k_pages_usd: 0.225,
    tts_per_10k_chars_usd: 0.225,
    asr_per_hour_usd: 0.058,
};

#[derive(Debug, Clone, Copy, Serialize)]
pub struct AiTierLimits {
    pub tier: &'static str,
    pub daily_ai_requests: i64,
    pub daily_semantic_searches: i64,
    pub max_input_tokens_per_req: usize,
    pub max_output_tokens_per_req: u32,
    pub monthly_asr_minutes: i64,
    pub monthly_ocr_pages: i64,
    pub monthly_web_search_requests: i64,
}

pub fn limits_for_tier(tier: &str) -> AiTierLimits {
    match tier.to_ascii_lowercase().as_str() {
        "dev" => AiTierLimits {
            tier: "dev",
            daily_ai_requests: 10_000,
            daily_semantic_searches: 10_000,
            max_input_tokens_per_req: 256_000,
            max_output_tokens_per_req: 8_192,
            monthly_asr_minutes: 6_000,
            monthly_ocr_pages: 10_000,
            monthly_web_search_requests: 5_000,
        },
        "sudo" => AiTierLimits {
            tier: "sudo",
            daily_ai_requests: 200,
            daily_semantic_searches: 500,
            max_input_tokens_per_req: 200_000,
            max_output_tokens_per_req: 4_096,
            monthly_asr_minutes: 180,
            monthly_ocr_pages: 500,
            monthly_web_search_requests: 200,
        },
        "super" => AiTierLimits {
            tier: "super",
            daily_ai_requests: 60,
            daily_semantic_searches: 150,
            max_input_tokens_per_req: 64_000,
            max_output_tokens_per_req: 2_500,
            monthly_asr_minutes: 60,
            monthly_ocr_pages: 100,
            monthly_web_search_requests: 50,
        },
        _ => AiTierLimits {
            tier: "free",
            daily_ai_requests: 10,
            daily_semantic_searches: 20,
            max_input_tokens_per_req: 16_000,
            max_output_tokens_per_req: 1_000,
            monthly_asr_minutes: 5,
            monthly_ocr_pages: 0,
            monthly_web_search_requests: 0,
        },
    }
}

#[derive(Debug, Clone, Copy)]
pub enum AiQuotaKind {
    AiRequest,
    SemanticSearch,
    AsrMinutes,
}

/// Atomically checks and increments the caller's Valkey quota counter.
pub async fn check_and_consume_quota(
    state: &AppState,
    user_id: Uuid,
    platform_role: &str,
    kind: AiQuotaKind,
    amount: i64,
) -> Result<AiTierLimits, AppError> {
    let tier = if platform_role == "dev" {
        "dev"
    } else {
        "free"
    };
    let limits = limits_for_tier(tier);
    let now = Utc::now();

    let (key, cap, ttl_secs, label) = match kind {
        AiQuotaKind::AiRequest => (
            format!("ai:quota:req:{user_id}:{}", now.format("%Y-%m-%d")),
            limits.daily_ai_requests,
            90_000_i64,
            "daily AI request",
        ),
        AiQuotaKind::SemanticSearch => (
            format!("ai:quota:search:{user_id}:{}", now.format("%Y-%m-%d")),
            limits.daily_semantic_searches,
            90_000_i64,
            "daily semantic search",
        ),
        AiQuotaKind::AsrMinutes => (
            format!("ai:quota:asr:{user_id}:{}", now.format("%Y-%m")),
            limits.monthly_asr_minutes,
            35 * 86_400_i64,
            "monthly voice ASR minutes",
        ),
    };

    if cap <= 0 {
        return Err(AppError::Forbidden(format!(
            "{label} add-on is not available on the '{}' tier",
            limits.tier
        )));
    }

    let next_val: i64 = state.valkey.incr_by(&key, amount.max(1)).await?;
    if next_val == amount.max(1) {
        let _: Result<bool, _> = state.valkey.expire(&key, ttl_secs, None).await;
    }
    if next_val > cap {
        return Err(AppError::TooManyRequests {
            retry_after_secs: 3600,
            message: format!(
                "{label} quota exceeded ({cap} limit for '{}' tier)",
                limits.tier
            ),
        });
    }

    Ok(limits)
}

pub async fn get_current_usage(
    state: &AppState,
    user_id: Uuid,
) -> Result<(i64, i64, i64), AppError> {
    let now = Utc::now();
    let req_key = format!("ai:quota:req:{user_id}:{}", now.format("%Y-%m-%d"));
    let search_key = format!("ai:quota:search:{user_id}:{}", now.format("%Y-%m-%d"));
    let asr_key = format!("ai:quota:asr:{user_id}:{}", now.format("%Y-%m"));

    let req: Option<i64> = state.valkey.get(&req_key).await.unwrap_or(None);
    let search: Option<i64> = state.valkey.get(&search_key).await.unwrap_or(None);
    let asr: Option<i64> = state.valkey.get(&asr_key).await.unwrap_or(None);

    Ok((req.unwrap_or(0), search.unwrap_or(0), asr.unwrap_or(0)))
}
