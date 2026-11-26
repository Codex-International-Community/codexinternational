//! 5 AI-Native features backed by the DeepSeek v4.1 Flash multi-key pool:
//! 1. Catch Me Up (channel summary with Valkey cache)
//! 2. Smart Semantic Search (async background indexer + hybrid scorer)
//! 3. Contextual Moderation & Auto-Triage (`tokio::spawn` non-blocking worker)
//! 4. Built-in Slash Commands (`/ai`, `/ask`, `/summarize`, `/translate`, `/code`)
//! 5. Voice Channel Transcription & Automatic Meeting Notes

use std::{collections::HashSet, sync::Arc};

use axum::{
    Json,
    extract::{Path, Query, State},
};
use chrono::{DateTime, Utc};
use fred::interfaces::KeysInterface;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::{
    keys::call_deepseek_chat,
    quotas::{
        AiQuotaKind, DEEPSEEK_V4_1_FLASH_PRICING, check_and_consume_quota, get_current_usage,
        limits_for_tier,
    },
};
use crate::{
    auth::extractor::AuthUser,
    chat::repo::{channel_access, history},
    communities::permissions::{PERM_SEND_MESSAGES, PERM_VIEW_CHANNEL},
    error::AppError,
    state::AppState,
};

#[derive(Debug, Serialize)]
pub struct AiLimitsResponse {
    pub pricing: super::quotas::DeepSeekPricingSpec,
    pub tiers: Vec<super::quotas::AiTierLimits>,
    pub current_usage: AiUsageSnapshot,
}

#[derive(Debug, Serialize)]
pub struct AiUsageSnapshot {
    pub daily_ai_requests: i64,
    pub daily_semantic_searches: i64,
    pub monthly_asr_minutes: i64,
}

/// `GET /api/v1/ai/limits`
pub async fn get_ai_limits(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
) -> Result<Json<AiLimitsResponse>, AppError> {
    let (daily_ai_requests, daily_semantic_searches, monthly_asr_minutes) =
        get_current_usage(&state, auth.user_id).await?;
    Ok(Json(AiLimitsResponse {
        pricing: DEEPSEEK_V4_1_FLASH_PRICING,
        tiers: vec![
            limits_for_tier("free"),
            limits_for_tier("super"),
            limits_for_tier("sudo"),
            limits_for_tier("dev"),
        ],
        current_usage: AiUsageSnapshot {
            daily_ai_requests,
            daily_semantic_searches,
            monthly_asr_minutes,
        },
    }))
}

// ── 1. Catch Me Up ──────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Default)]
pub struct CatchMeUpRequest {
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CatchMeUpResponse {
    pub channel_id: Uuid,
    pub from_seq: i64,
    pub to_seq: i64,
    pub message_count: usize,
    pub cached: bool,
    pub summary: String,
    pub highlights: Vec<String>,
}

/// `POST /api/v1/channels/{channel_id}/ai/catch-me-up`
pub async fn catch_me_up(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    body: Option<Json<CatchMeUpRequest>>,
) -> Result<Json<CatchMeUpResponse>, AppError> {
    let last_seq =
        channel_access(&state, channel_id, auth.user_id, PERM_VIEW_CHANNEL, false).await?;

    let last_read: i64 = sqlx::query_scalar(
        "SELECT COALESCE(last_read_seq_id, 0)
         FROM channel_members
         WHERE channel_id = $1 AND user_id = $2",
    )
    .bind(channel_id)
    .bind(auth.user_id)
    .fetch_optional(&state.pg)
    .await?
    .unwrap_or(0);

    let max_msgs = body.and_then(|b| b.limit).unwrap_or(80).clamp(10, 100);
    let after_seq = if last_seq > last_read {
        last_read
    } else {
        (last_seq - max_msgs).max(0)
    };

    let messages = history(&state, channel_id, after_seq, max_msgs).await?;
    if messages.is_empty() {
        return Ok(Json(CatchMeUpResponse {
            channel_id,
            from_seq: after_seq,
            to_seq: last_seq,
            message_count: 0,
            cached: false,
            summary: "No recent messages to summarize in this channel.".into(),
            highlights: Vec::new(),
        }));
    }

    let from_seq = messages.first().map(|m| m.seq_id).unwrap_or(after_seq);
    let to_seq = messages.last().map(|m| m.seq_id).unwrap_or(last_seq);
    let cache_key = format!("ai:summary:{channel_id}:{from_seq}:{to_seq}");

    if let Ok(Some(cached_json)) = state.valkey.get::<Option<String>, _>(&cache_key).await
        && let Ok(mut parsed) = serde_json::from_str::<CatchMeUpResponse>(&cached_json)
    {
        parsed.cached = true;
        return Ok(Json(parsed));
    }

    let limits = check_and_consume_quota(
        &state,
        auth.user_id,
        &auth.platform_role,
        AiQuotaKind::AiRequest,
        1,
    )
    .await?;

    let transcript = messages
        .iter()
        .filter(|m| !m.text.trim().is_empty())
        .map(|m| format!("[seq {}] {}: {}", m.seq_id, m.author, m.text.trim()))
        .collect::<Vec<_>>()
        .join("\n");

    let system = "You summarize IT community chat channels accurately. Return JSON with keys: \"summary\" (string, concise paragraph) and \"highlights\" (array of 3-6 short bullet strings mentioning who discussed what). Reply in the same language as the chat.";
    let user_prompt = format!(
        "Summarize these {} messages:\n{}",
        messages.len(),
        truncate_chars(&transcript, limits.max_input_tokens_per_req * 3)
    );

    let ai = call_deepseek_chat(
        &state,
        system,
        &user_prompt,
        limits.max_output_tokens_per_req.min(1200),
        true,
    )
    .await?;

    let parsed_json: serde_json::Value = serde_json::from_str(&ai.content).unwrap_or_else(|_| {
        serde_json::json!({
            "summary": ai.content,
            "highlights": []
        })
    });

    let summary = parsed_json["summary"]
        .as_str()
        .unwrap_or(&ai.content)
        .to_string();
    let highlights = parsed_json["highlights"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    let resp = CatchMeUpResponse {
        channel_id,
        from_seq,
        to_seq,
        message_count: messages.len(),
        cached: false,
        summary,
        highlights,
    };

    if let Ok(encoded) = serde_json::to_string(&resp) {
        let _: Result<(), _> = state
            .valkey
            .set(
                &cache_key,
                encoded,
                Some(fred::types::Expiration::EX(600)),
                None,
                false,
            )
            .await;
    }

    Ok(Json(resp))
}

// ── 2. Smart Semantic Search ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SemanticSearchQuery {
    pub q: String,
    pub channel_id: Option<Uuid>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct SemanticSearchResult {
    pub source_type: String,
    pub source_id: Uuid,
    pub channel_id: Option<Uuid>,
    pub author_id: Option<Uuid>,
    pub content_preview: String,
    pub score: f32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct IndexedRow {
    source_type: String,
    source_id: Uuid,
    channel_id: Option<Uuid>,
    author_id: Option<Uuid>,
    content_preview: String,
    keywords: Vec<String>,
    created_at: DateTime<Utc>,
}

pub fn extract_keywords(text: &str) -> Vec<String> {
    let mut set = HashSet::new();
    for raw in text.split(|c: char| !c.is_alphanumeric() && c != '_' && c != '-') {
        let w = raw.trim().to_ascii_lowercase();
        if w.len() >= 3 {
            set.insert(w);
        }
        if set.len() >= 48 {
            break;
        }
    }
    set.into_iter().collect()
}

/// Non-blocking background indexer for chat messages & social posts.
pub fn spawn_index_content(
    pg: sqlx::PgPool,
    source_type: &'static str,
    source_id: Uuid,
    channel_id: Option<Uuid>,
    author_id: Option<Uuid>,
    content: String,
) {
    let trimmed = content.trim().to_string();
    if trimmed.chars().count() < 20 {
        return;
    }
    tokio::spawn(async move {
        let keywords = extract_keywords(&trimmed);
        let preview = truncate_chars(&trimmed, 400);
        let _ = sqlx::query(
            "INSERT INTO ai_message_embeddings
                (id, source_type, source_id, channel_id, author_id, content_preview, keywords)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (source_type, source_id)
             DO UPDATE SET content_preview = EXCLUDED.content_preview,
                           keywords = EXCLUDED.keywords",
        )
        .bind(Uuid::now_v7())
        .bind(source_type)
        .bind(source_id)
        .bind(channel_id)
        .bind(author_id)
        .bind(preview)
        .bind(&keywords)
        .execute(&pg)
        .await;
    });
}

/// `GET /api/v1/ai/search?q=...&channel_id=...`
pub async fn semantic_search(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Query(query): Query<SemanticSearchQuery>,
) -> Result<Json<Vec<SemanticSearchResult>>, AppError> {
    let q = query.q.trim();
    if q.is_empty() {
        return Err(AppError::BadRequest("search query q is required".into()));
    }
    if let Some(cid) = query.channel_id {
        channel_access(&state, cid, auth.user_id, PERM_VIEW_CHANNEL, false).await?;
    }

    check_and_consume_quota(
        &state,
        auth.user_id,
        &auth.platform_role,
        AiQuotaKind::SemanticSearch,
        1,
    )
    .await?;

    let q_terms = extract_keywords(q);
    let like_pattern = format!("%{}%", q.to_ascii_lowercase());
    let limit = query.limit.unwrap_or(20).clamp(1, 50);

    let rows = sqlx::query_as::<_, IndexedRow>(
        "SELECT e.source_type, e.source_id, e.channel_id, e.author_id,
                e.content_preview, e.keywords, e.created_at
         FROM ai_message_embeddings e
         LEFT JOIN channel_members cm ON cm.channel_id = e.channel_id AND cm.user_id = $2
         WHERE ($1::uuid IS NULL OR e.channel_id = $1)
           AND (e.source_type = 'post' OR cm.user_id IS NOT NULL)
           AND (
               e.keywords && $3::text[]
               OR LOWER(e.content_preview) LIKE $4
           )
         ORDER BY e.created_at DESC
         LIMIT 200",
    )
    .bind(query.channel_id)
    .bind(auth.user_id)
    .bind(&q_terms)
    .bind(&like_pattern)
    .fetch_all(&state.pg)
    .await?;

    let q_set: HashSet<&str> = q_terms.iter().map(String::as_str).collect();
    let q_lower = q.to_ascii_lowercase();

    let mut scored: Vec<SemanticSearchResult> = rows
        .into_iter()
        .map(|r| {
            let overlap = r
                .keywords
                .iter()
                .filter(|k| q_set.contains(k.as_str()))
                .count() as f32;
            let exact_bonus = if r.content_preview.to_ascii_lowercase().contains(&q_lower) {
                2.0
            } else {
                0.0
            };
            let denom = (q_set.len().max(1) as f32).sqrt();
            let score = (overlap / denom) + exact_bonus;
            SemanticSearchResult {
                source_type: r.source_type,
                source_id: r.source_id,
                channel_id: r.channel_id,
                author_id: r.author_id,
                content_preview: r.content_preview,
                score,
                created_at: r.created_at,
            }
        })
        .collect();

    scored.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.created_at.cmp(&a.created_at))
    });
    scored.truncate(limit as usize);

    Ok(Json(scored))
}

// ── 3. Contextual Moderation & Auto-Triage ──────────────────────────────────

#[derive(Debug, Serialize, FromRow)]
pub struct AiTriageItem {
    pub report_id: Uuid,
    pub target_type: String,
    pub target_id: Uuid,
    pub reason: String,
    pub status: String,
    pub toxicity_score: f32,
    pub spam_score: f32,
    pub category: String,
    pub summary: String,
    pub recommended_action: String,
    pub analyzed_at: DateTime<Utc>,
}

/// Spawns non-blocking AI triage for a newly created content report.
pub fn spawn_auto_triage(
    state: Arc<AppState>,
    report_id: Uuid,
    target_type: String,
    target_id: Uuid,
    reason: String,
) {
    tokio::spawn(async move {
        if let Err(err) =
            run_triage_for_report(&state, report_id, &target_type, target_id, &reason).await
        {
            tracing::debug!(report_id = %report_id, error = %err, "auto-triage skipped");
        }
    });
}

async fn run_triage_for_report(
    state: &AppState,
    report_id: Uuid,
    target_type: &str,
    target_id: Uuid,
    reason: &str,
) -> Result<(), AppError> {
    let snippet: Option<String> = match target_type {
        "message" | "chat_message" => {
            sqlx::query_scalar("SELECT content FROM messages WHERE id = $1")
                .bind(target_id)
                .fetch_optional(&state.pg)
                .await?
        }
        "post" | "social_post" => {
            sqlx::query_scalar("SELECT content FROM posts WHERE id = $1")
                .bind(target_id)
                .fetch_optional(&state.pg)
                .await?
        }
        "reply" | "social_reply" => {
            sqlx::query_scalar("SELECT content FROM post_replies WHERE id = $1")
                .bind(target_id)
                .fetch_optional(&state.pg)
                .await?
        }
        _ => None,
    };

    let text = snippet.unwrap_or_else(|| "(content unavailable)".to_string());
    let system = "You are a trust & safety triage assistant. Return JSON only with keys: toxicity_score (0.0-1.0), spam_score (0.0-1.0), category (clean|spam|harassment|scam|nsfw|other), summary (short string), recommended_action (dismiss|review|delete_content).";
    let prompt = format!(
        "Target type: {target_type}\nReporter reason: {reason}\nContent: {}",
        truncate_chars(&text, 1500)
    );

    let ai = call_deepseek_chat(state, system, &prompt, 300, true).await?;
    let val: serde_json::Value = serde_json::from_str(&ai.content).unwrap_or_default();

    let toxicity = val["toxicity_score"].as_f64().unwrap_or(0.0) as f32;
    let spam = val["spam_score"].as_f64().unwrap_or(0.0) as f32;
    let category = val["category"].as_str().unwrap_or("other");
    let summary = val["summary"].as_str().unwrap_or(&ai.content);
    let action = val["recommended_action"].as_str().unwrap_or("review");

    sqlx::query(
        "INSERT INTO ai_triage_reports
            (report_id, toxicity_score, spam_score, category, summary, recommended_action)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (report_id)
         DO UPDATE SET toxicity_score = EXCLUDED.toxicity_score,
                       spam_score = EXCLUDED.spam_score,
                       category = EXCLUDED.category,
                       summary = EXCLUDED.summary,
                       recommended_action = EXCLUDED.recommended_action,
                       analyzed_at = NOW()",
    )
    .bind(report_id)
    .bind(toxicity.clamp(0.0, 1.0))
    .bind(spam.clamp(0.0, 1.0))
    .bind(truncate_chars(category, 40))
    .bind(truncate_chars(summary, 500))
    .bind(truncate_chars(action, 30))
    .execute(&state.pg)
    .await?;

    Ok(())
}

/// `GET /api/v1/dev/ai/triage`
pub async fn list_dev_triage(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
) -> Result<Json<Vec<AiTriageItem>>, AppError> {
    if auth.platform_role != "dev" {
        return Err(AppError::Forbidden("dev role required".into()));
    }
    let rows = sqlx::query_as::<_, AiTriageItem>(
        "SELECT t.report_id, r.target_type, r.target_id, r.reason, r.status,
                t.toxicity_score, t.spam_score, t.category, t.summary,
                t.recommended_action, t.analyzed_at
         FROM ai_triage_reports t
         JOIN content_reports r ON r.id = t.report_id
         ORDER BY GREATEST(t.toxicity_score, t.spam_score) DESC, t.analyzed_at DESC
         LIMIT 50",
    )
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

/// `POST /api/v1/dev/ai/triage/{report_id}`
pub async fn trigger_dev_triage(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(report_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    if auth.platform_role != "dev" {
        return Err(AppError::Forbidden("dev role required".into()));
    }
    let row: Option<(String, Uuid, String)> =
        sqlx::query_as("SELECT target_type, target_id, reason FROM content_reports WHERE id = $1")
            .bind(report_id)
            .fetch_optional(&state.pg)
            .await?;
    let (target_type, target_id, reason) =
        row.ok_or_else(|| AppError::NotFound("report not found".into()))?;

    run_triage_for_report(&state, report_id, &target_type, target_id, &reason).await?;
    Ok(Json(
        serde_json::json!({ "ok": true, "report_id": report_id }),
    ))
}

// ── 4. Built-in Slash Command AI ────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct AiSlashCommandRequest {
    pub command: String,
    pub prompt: String,
    #[serde(default = "default_true")]
    pub ephemeral: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize)]
pub struct AiSlashCommandResponse {
    pub command: String,
    pub prompt: String,
    pub answer: String,
    pub ephemeral: bool,
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
}

/// `POST /api/v1/channels/{channel_id}/ai/command`
pub async fn run_slash_command(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<AiSlashCommandRequest>,
) -> Result<Json<AiSlashCommandResponse>, AppError> {
    channel_access(&state, channel_id, auth.user_id, PERM_SEND_MESSAGES, true).await?;

    let cmd = req
        .command
        .trim()
        .trim_start_matches('/')
        .to_ascii_lowercase();
    let prompt = req.prompt.trim();
    if prompt.is_empty() && cmd != "summarize" {
        return Err(AppError::BadRequest("prompt is required".into()));
    }

    let system = match cmd.as_str() {
        "ai" | "ask" => {
            "You are Codex AI, a concise technical assistant inside an IT community chat. Use clean Markdown and fenced code blocks when writing code."
        }
        "summarize" => {
            "Summarize the user's text or recent channel messages clearly into concise bullet points."
        }
        "translate" => {
            "Translate the given text accurately into natural Indonesian (or English if already Indonesian), preserving technical terms."
        }
        "code" => {
            "You are a senior software engineer. Provide clean, production-ready code with fenced language blocks and brief explanation."
        }
        other => {
            return Err(AppError::BadRequest(format!(
                "unsupported AI command '/{other}'; use /ai, /ask, /summarize, /translate, or /code"
            )));
        }
    };

    let limits = check_and_consume_quota(
        &state,
        auth.user_id,
        &auth.platform_role,
        AiQuotaKind::AiRequest,
        1,
    )
    .await?;

    let effective_prompt = if cmd == "summarize" && prompt.is_empty() {
        let msgs = history(&state, channel_id, 0, 30).await?;
        let joined = msgs
            .iter()
            .map(|m| format!("{}: {}", m.author, m.text))
            .collect::<Vec<_>>()
            .join("\n");
        truncate_chars(&joined, limits.max_input_tokens_per_req * 3)
    } else {
        truncate_chars(prompt, limits.max_input_tokens_per_req * 3)
    };

    let ai = call_deepseek_chat(
        &state,
        system,
        &effective_prompt,
        limits.max_output_tokens_per_req,
        false,
    )
    .await?;

    Ok(Json(AiSlashCommandResponse {
        command: format!("/{cmd}"),
        prompt: prompt.to_string(),
        answer: ai.content,
        ephemeral: req.ephemeral,
        model: ai.model,
        input_tokens: ai.input_tokens,
        output_tokens: ai.output_tokens,
    }))
}

// ── 5. Voice Channel Transcription & Meeting Notes ──────────────────────────

#[derive(Debug, Deserialize)]
pub struct VoiceTranscribeRequest {
    pub channel_id: Option<Uuid>,
    pub duration_secs: i32,
    pub transcript_text: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct VoiceTranscribeResponse {
    pub id: Uuid,
    pub duration_secs: i32,
    pub transcript: String,
    pub meeting_notes: String,
    pub created_at: DateTime<Utc>,
}

/// `POST /api/v1/ai/voice/transcribe`
pub async fn transcribe_voice_notes(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(req): Json<VoiceTranscribeRequest>,
) -> Result<Json<VoiceTranscribeResponse>, AppError> {
    if let Some(cid) = req.channel_id {
        channel_access(&state, cid, auth.user_id, PERM_VIEW_CHANNEL, false).await?;
    }
    let duration_secs = req.duration_secs.max(1);
    let minutes = i64::from((duration_secs + 59) / 60);

    let limits = check_and_consume_quota(
        &state,
        auth.user_id,
        &auth.platform_role,
        AiQuotaKind::AsrMinutes,
        minutes,
    )
    .await?;

    let transcript = req
        .transcript_text
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::BadRequest("transcript_text is required for meeting notes generation".into())
        })?
        .to_string();

    let system = "Convert this voice channel transcript into structured Meeting Notes in Markdown with sections: Summary, Key Decisions, and Action Items.";
    let ai = call_deepseek_chat(
        &state,
        system,
        &truncate_chars(&transcript, limits.max_input_tokens_per_req * 3),
        limits.max_output_tokens_per_req.min(1500),
        false,
    )
    .await?;

    let id = Uuid::now_v7();
    let created_at = sqlx::query_scalar::<_, DateTime<Utc>>(
        "INSERT INTO ai_voice_transcripts (id, channel_id, user_id, duration_secs, transcript, meeting_notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING created_at",
    )
    .bind(id)
    .bind(req.channel_id)
    .bind(auth.user_id)
    .bind(duration_secs)
    .bind(&transcript)
    .bind(&ai.content)
    .fetch_one(&state.pg)
    .await?;

    Ok(Json(VoiceTranscribeResponse {
        id,
        duration_secs,
        transcript,
        meeting_notes: ai.content,
        created_at,
    }))
}

fn truncate_chars(raw: &str, max_chars: usize) -> String {
    if raw.chars().count() <= max_chars {
        raw.to_string()
    } else {
        raw.chars().take(max_chars).collect()
    }
}
