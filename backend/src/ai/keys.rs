//! Dev-only Multi-API-Key pool for DeepSeek v4.1 Flash with weighted
//! round-robin load balancing, automatic cooldown on 429/5xx, and audit logging.

use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    auth::{dev_governance::record_audit_log, extractor::AuthUser},
    error::AppError,
    media::HTTP_CLIENT,
    state::AppState,
};

static KEY_RR_COUNTER: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Serialize, FromRow)]
pub struct DevAiKeySummary {
    pub id: Uuid,
    pub label: String,
    pub provider: String,
    pub model: String,
    pub base_url: String,
    pub key_preview: String,
    pub weight: i32,
    pub is_active: bool,
    pub max_concurrency: i32,
    pub total_requests: i64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub error_count: i64,
    pub cooldown_until: Option<DateTime<Utc>>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateAiKeyRequest {
    pub label: String,
    pub api_key: String,
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default = "default_weight")]
    pub weight: i32,
    #[serde(default = "default_concurrency")]
    pub max_concurrency: i32,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAiKeyRequest {
    pub label: Option<String>,
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub weight: Option<i32>,
    pub is_active: Option<bool>,
    pub clear_cooldown: Option<bool>,
}

#[derive(Debug, Clone, FromRow)]
pub struct ActiveAiKey {
    pub id: Uuid,
    pub model: String,
    pub base_url: String,
    pub api_key_encrypted: String,
    pub weight: i32,
}

fn default_provider() -> String {
    "deepseek".to_string()
}

fn default_model() -> String {
    "deepseek-chat".to_string()
}

fn default_base_url() -> String {
    "https://api.deepseek.com".to_string()
}

fn default_weight() -> i32 {
    1
}

fn default_concurrency() -> i32 {
    2500
}

fn ensure_dev(auth: &AuthUser) -> Result<(), AppError> {
    if auth.platform_role != "dev" {
        return Err(AppError::Forbidden("dev role required".into()));
    }
    Ok(())
}

pub fn mask_api_key(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.len() <= 8 {
        return "••••••••".to_string();
    }
    let prefix = &trimmed[..4];
    let suffix = &trimmed[trimmed.len() - 4..];
    format!("{prefix}••••{suffix}")
}

/// `GET /api/v1/dev/ai/keys`
pub async fn list_ai_keys(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
) -> Result<Json<Vec<DevAiKeySummary>>, AppError> {
    ensure_dev(&auth)?;
    let rows = sqlx::query_as::<_, DevAiKeySummary>(
        "SELECT id, label, provider, model, base_url, key_preview, weight, is_active,
                max_concurrency, total_requests, total_input_tokens, total_output_tokens,
                error_count, cooldown_until, last_used_at, created_at
         FROM ai_api_keys
         ORDER BY created_at DESC",
    )
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

/// `POST /api/v1/dev/ai/keys`
pub async fn create_ai_key(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(req): Json<CreateAiKeyRequest>,
) -> Result<(StatusCode, Json<DevAiKeySummary>), AppError> {
    ensure_dev(&auth)?;
    let label = req.label.trim();
    let api_key = req.api_key.trim();
    if label.is_empty() || label.chars().count() > 80 {
        return Err(AppError::BadRequest(
            "label must be 1-80 characters".to_string(),
        ));
    }
    if api_key.len() < 12 || api_key.len() > 512 {
        return Err(AppError::BadRequest(
            "api_key must be 12-512 characters".to_string(),
        ));
    }
    let base_url = req.base_url.trim().trim_end_matches('/').to_string();
    if !base_url.starts_with("https://") {
        return Err(AppError::BadRequest(
            "base_url must use https://".to_string(),
        ));
    }

    let id = Uuid::now_v7();
    let preview = mask_api_key(api_key);
    let weight = req.weight.clamp(1, 100);
    let max_conc = req.max_concurrency.clamp(1, 2500);

    let row = sqlx::query_as::<_, DevAiKeySummary>(
        "INSERT INTO ai_api_keys
            (id, label, provider, model, base_url, api_key_encrypted, key_preview, weight, max_concurrency, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, label, provider, model, base_url, key_preview, weight, is_active,
                   max_concurrency, total_requests, total_input_tokens, total_output_tokens,
                   error_count, cooldown_until, last_used_at, created_at",
    )
    .bind(id)
    .bind(label)
    .bind(req.provider.trim())
    .bind(req.model.trim())
    .bind(&base_url)
    .bind(api_key)
    .bind(&preview)
    .bind(weight)
    .bind(max_conc)
    .bind(auth.user_id)
    .fetch_one(&state.pg)
    .await?;

    let _ = record_audit_log(
        &state.pg,
        auth.user_id,
        None,
        "AI_API_KEY_ADDED",
        Some(id),
        Some(label),
    )
    .await;

    Ok((StatusCode::CREATED, Json(row)))
}

/// `PATCH /api/v1/dev/ai/keys/{id}`
pub async fn update_ai_key(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateAiKeyRequest>,
) -> Result<Json<DevAiKeySummary>, AppError> {
    ensure_dev(&auth)?;

    if let Some(ref url) = req.base_url
        && !url.trim().starts_with("https://")
    {
        return Err(AppError::BadRequest(
            "base_url must use https://".to_string(),
        ));
    }

    let clear_cooldown = req.clear_cooldown.unwrap_or(false);
    let row = sqlx::query_as::<_, DevAiKeySummary>(
        "UPDATE ai_api_keys
         SET label = COALESCE($2, label),
             model = COALESCE($3, model),
             base_url = COALESCE($4, base_url),
             weight = COALESCE($5, weight),
             is_active = COALESCE($6, is_active),
             cooldown_until = CASE WHEN $7 THEN NULL ELSE cooldown_until END
         WHERE id = $1
         RETURNING id, label, provider, model, base_url, key_preview, weight, is_active,
                   max_concurrency, total_requests, total_input_tokens, total_output_tokens,
                   error_count, cooldown_until, last_used_at, created_at",
    )
    .bind(id)
    .bind(req.label.as_deref().map(str::trim))
    .bind(req.model.as_deref().map(str::trim))
    .bind(
        req.base_url
            .as_deref()
            .map(|u| u.trim().trim_end_matches('/')),
    )
    .bind(req.weight.map(|w| w.clamp(1, 100)))
    .bind(req.is_active)
    .bind(clear_cooldown)
    .fetch_optional(&state.pg)
    .await?
    .ok_or_else(|| AppError::NotFound("AI API key not found".into()))?;

    let _ = record_audit_log(
        &state.pg,
        auth.user_id,
        None,
        "AI_API_KEY_UPDATED",
        Some(id),
        Some(&row.label),
    )
    .await;

    Ok(Json(row))
}

/// `DELETE /api/v1/dev/ai/keys/{id}`
pub async fn delete_ai_key(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    ensure_dev(&auth)?;
    let res = sqlx::query("DELETE FROM ai_api_keys WHERE id = $1")
        .bind(id)
        .execute(&state.pg)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("AI API key not found".into()));
    }
    let _ = record_audit_log(
        &state.pg,
        auth.user_id,
        None,
        "AI_API_KEY_DELETED",
        Some(id),
        None,
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Clone)]
pub struct AiCompletionResult {
    pub content: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub model: String,
}

/// Calls DeepSeek Chat Completions using weighted round-robin across all active
/// keys, failing over to the next key if a key returns 429 or 5xx.
pub async fn call_deepseek_chat(
    state: &AppState,
    system_prompt: &str,
    user_prompt: &str,
    max_tokens: u32,
    json_mode: bool,
) -> Result<AiCompletionResult, AppError> {
    let keys = sqlx::query_as::<_, ActiveAiKey>(
        "SELECT id, model, base_url, api_key_encrypted, weight
         FROM ai_api_keys
         WHERE is_active = TRUE
           AND (cooldown_until IS NULL OR cooldown_until <= NOW())
         ORDER BY total_requests ASC, created_at ASC",
    )
    .fetch_all(&state.pg)
    .await?;

    if keys.is_empty() {
        return Err(AppError::ServiceUnavailable {
            retry_after_secs: 30,
            message: "No active DeepSeek API keys configured in Dev Panel".into(),
        });
    }

    // Build weighted pool indices for even traffic distribution.
    let mut ring = Vec::new();
    for (idx, k) in keys.iter().enumerate() {
        for _ in 0..k.weight.clamp(1, 20) {
            ring.push(idx);
        }
    }
    let start = KEY_RR_COUNTER.fetch_add(1, Ordering::Relaxed) % ring.len();

    let mut tried = Vec::with_capacity(keys.len());
    let mut last_err = String::new();

    for offset in 0..ring.len() {
        let key_idx = ring[(start + offset) % ring.len()];
        if tried.contains(&key_idx) {
            continue;
        }
        tried.push(key_idx);
        let key = &keys[key_idx];

        let mut body = serde_json::json!({
            "model": key.model,
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": user_prompt }
            ],
            "max_tokens": max_tokens,
            "temperature": 0.3
        });
        if json_mode {
            body["response_format"] = serde_json::json!({ "type": "json_object" });
        }

        let endpoint = format!("{}/chat/completions", key.base_url.trim_end_matches('/'));
        let resp = HTTP_CLIENT
            .post(&endpoint)
            .bearer_auth(&key.api_key_encrypted)
            .json(&body)
            .send()
            .await;

        match resp {
            Ok(r) if r.status().is_success() => {
                let val: serde_json::Value = r.json().await.map_err(|e| {
                    AppError::Internal(anyhow::anyhow!("invalid DeepSeek JSON: {e}"))
                })?;
                let content = val["choices"][0]["message"]["content"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string();
                let in_tok = val["usage"]["prompt_tokens"].as_i64().unwrap_or(0);
                let out_tok = val["usage"]["completion_tokens"].as_i64().unwrap_or(0);

                let _ = sqlx::query(
                    "UPDATE ai_api_keys
                     SET total_requests = total_requests + 1,
                         total_input_tokens = total_input_tokens + $2,
                         total_output_tokens = total_output_tokens + $3,
                         last_used_at = NOW()
                     WHERE id = $1",
                )
                .bind(key.id)
                .bind(in_tok)
                .bind(out_tok)
                .execute(&state.pg)
                .await;

                return Ok(AiCompletionResult {
                    content,
                    input_tokens: in_tok,
                    output_tokens: out_tok,
                    model: key.model.clone(),
                });
            }
            Ok(r) => {
                let status = r.status();
                let text = r.text().await.unwrap_or_default();
                last_err = format!("DeepSeek HTTP {status}: {text}");
                let cooldown = if status.as_u16() == 429 || status.is_server_error() {
                    Some(Utc::now() + Duration::seconds(60))
                } else {
                    None
                };
                let _ = sqlx::query(
                    "UPDATE ai_api_keys
                     SET error_count = error_count + 1,
                         cooldown_until = COALESCE($2, cooldown_until)
                     WHERE id = $1",
                )
                .bind(key.id)
                .bind(cooldown)
                .execute(&state.pg)
                .await;
            }
            Err(e) => {
                last_err = e.to_string();
                let _ = sqlx::query(
                    "UPDATE ai_api_keys SET error_count = error_count + 1 WHERE id = $1",
                )
                .bind(key.id)
                .execute(&state.pg)
                .await;
            }
        }
    }

    Err(AppError::ServiceUnavailable {
        retry_after_secs: 60,
        message: format!("All DeepSeek API keys failed: {last_err}"),
    })
}
