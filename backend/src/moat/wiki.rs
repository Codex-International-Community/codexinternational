//! Solved-to-Wiki: converts chat discussions or social threads into public,
//! SEO-friendly Q&A wiki articles.

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    ai::keys::call_deepseek_chat,
    auth::extractor::{AuthUser, OptionalAuthUser},
    chat::repo::{channel_access, history},
    communities::permissions::PERM_VIEW_CHANNEL,
    error::AppError,
    state::AppState,
};

#[derive(Debug, Serialize, FromRow)]
pub struct WikiArticle {
    pub id: Uuid,
    pub community_id: Option<Uuid>,
    pub channel_id: Option<Uuid>,
    pub source_type: String,
    pub source_id: Uuid,
    pub slug: String,
    pub title: String,
    pub question_summary: String,
    pub solution_markdown: String,
    pub tags: Vec<String>,
    pub author_id: Option<Uuid>,
    pub solved_by_id: Option<Uuid>,
    pub is_public: bool,
    pub view_count: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct PromoteChannelWikiRequest {
    pub title: String,
    #[serde(default)]
    pub from_seq: Option<i64>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_true")]
    pub is_public: bool,
    pub solved_by_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct PromotePostWikiRequest {
    pub title: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_true")]
    pub is_public: bool,
    pub solved_by_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct ListWikiQuery {
    pub tag: Option<String>,
    pub q: Option<String>,
    pub limit: Option<i64>,
}

fn default_true() -> bool {
    true
}

pub fn make_wiki_slug(title: &str, id: Uuid) -> String {
    let mut slug = String::new();
    let mut prev_dash = false;
    for ch in title.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash && !slug.is_empty() {
            slug.push('-');
            prev_dash = true;
        }
        if slug.len() >= 72 {
            break;
        }
    }
    let trimmed = slug.trim_matches('-');
    let suffix = &id.simple().to_string()[..8];
    if trimmed.is_empty() {
        format!("wiki-{suffix}")
    } else {
        format!("{trimmed}-{suffix}")
    }
}

pub fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for raw in tags {
        let cleaned = raw.trim().trim_start_matches('#').to_ascii_lowercase();
        if !cleaned.is_empty() && cleaned.len() <= 48 && !out.contains(&cleaned) {
            out.push(cleaned);
        }
        if out.len() >= 8 {
            break;
        }
    }
    out
}

async fn synthesize_qa_markdown(
    state: &AppState,
    title: &str,
    transcript: &str,
) -> (String, String) {
    let system = "Convert this technical discussion into a clean Q&A wiki entry. Return JSON with keys: \"question_summary\" (1-2 sentences) and \"solution_markdown\" (clean Markdown with code blocks if relevant).";
    let prompt = format!("Title: {title}\n\nDiscussion:\n{transcript}");

    if let Ok(ai) = call_deepseek_chat(state, system, &prompt, 1500, true).await
        && let Ok(val) = serde_json::from_str::<serde_json::Value>(&ai.content)
    {
        let q = val["question_summary"]
            .as_str()
            .unwrap_or(title)
            .to_string();
        let sol = val["solution_markdown"]
            .as_str()
            .unwrap_or(transcript)
            .to_string();
        return (q, sol);
    }

    // Fallback when no active AI key is configured yet.
    (
        title.to_string(),
        format!("## Discussion Summary\n\n{transcript}"),
    )
}

/// `POST /api/v1/moat/wiki/from-channel/{channel_id}`
pub async fn promote_channel_to_wiki(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<PromoteChannelWikiRequest>,
) -> Result<(StatusCode, Json<WikiArticle>), AppError> {
    let last_seq =
        channel_access(&state, channel_id, auth.user_id, PERM_VIEW_CHANNEL, false).await?;
    let title = req.title.trim();
    if title.is_empty() || title.chars().count() > 200 {
        return Err(AppError::BadRequest(
            "title must be 1-200 characters".into(),
        ));
    }

    let community_id: Option<Uuid> =
        sqlx::query_scalar("SELECT community_id FROM channels WHERE id = $1")
            .bind(channel_id)
            .fetch_optional(&state.pg)
            .await?
            .flatten();

    let after_seq = req.from_seq.unwrap_or_else(|| (last_seq - 40).max(0));
    let messages = history(&state, channel_id, after_seq, 50).await?;
    if messages.is_empty() {
        return Err(AppError::BadRequest(
            "no messages found in channel range to promote".into(),
        ));
    }

    let transcript = messages
        .iter()
        .filter(|m| !m.text.trim().is_empty())
        .map(|m| format!("**{}**: {}", m.author, m.text.trim()))
        .collect::<Vec<_>>()
        .join("\n\n");

    let (question_summary, solution_markdown) =
        synthesize_qa_markdown(&state, title, &transcript).await;
    let id = Uuid::now_v7();
    let slug = make_wiki_slug(title, id);
    let tags = normalize_tags(&req.tags);

    let article = sqlx::query_as::<_, WikiArticle>(
        "INSERT INTO wiki_articles
            (id, community_id, channel_id, source_type, source_id, slug, title,
             question_summary, solution_markdown, tags, author_id, solved_by_id, is_public)
         VALUES ($1, $2, $3, 'chat', $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *",
    )
    .bind(id)
    .bind(community_id)
    .bind(channel_id)
    .bind(channel_id)
    .bind(&slug)
    .bind(title)
    .bind(&question_summary)
    .bind(&solution_markdown)
    .bind(&tags)
    .bind(auth.user_id)
    .bind(req.solved_by_id)
    .bind(req.is_public)
    .fetch_one(&state.pg)
    .await?;

    Ok((StatusCode::CREATED, Json(article)))
}

/// `POST /api/v1/moat/wiki/from-post/{post_id}`
pub async fn promote_post_to_wiki(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(post_id): Path<Uuid>,
    Json(req): Json<PromotePostWikiRequest>,
) -> Result<(StatusCode, Json<WikiArticle>), AppError> {
    let post_content: Option<String> =
        sqlx::query_scalar("SELECT content FROM posts WHERE id = $1")
            .bind(post_id)
            .fetch_optional(&state.pg)
            .await?;
    let Some(post_content) = post_content else {
        return Err(AppError::NotFound("post not found".into()));
    };

    let replies: Vec<(String, String)> = sqlx::query_as(
        "SELECT u.display_name, r.content
         FROM post_replies r
         JOIN users u ON u.id = r.user_id
         WHERE r.post_id = $1
         ORDER BY r.created_at ASC
         LIMIT 50",
    )
    .bind(post_id)
    .fetch_all(&state.pg)
    .await?;

    let title = req
        .title
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            let first_line = post_content.lines().next().unwrap_or("Solved Thread");
            first_line.chars().take(120).collect()
        });

    let mut transcript = format!("**Question/Thread**: {post_content}");
    for (author, body) in replies {
        transcript.push_str(&format!("\n\n**{author}**: {body}"));
    }

    let (question_summary, solution_markdown) =
        synthesize_qa_markdown(&state, &title, &transcript).await;
    let id = Uuid::now_v7();
    let slug = make_wiki_slug(&title, id);
    let tags = normalize_tags(&req.tags);

    let article = sqlx::query_as::<_, WikiArticle>(
        "INSERT INTO wiki_articles
            (id, source_type, source_id, slug, title, question_summary,
             solution_markdown, tags, author_id, solved_by_id, is_public)
         VALUES ($1, 'thread', $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *",
    )
    .bind(id)
    .bind(post_id)
    .bind(&slug)
    .bind(&title)
    .bind(&question_summary)
    .bind(&solution_markdown)
    .bind(&tags)
    .bind(auth.user_id)
    .bind(req.solved_by_id)
    .bind(req.is_public)
    .fetch_one(&state.pg)
    .await?;

    Ok((StatusCode::CREATED, Json(article)))
}

/// `GET /api/v1/moat/wiki` (Public Read-Only)
pub async fn list_public_wiki(
    State(state): State<Arc<AppState>>,
    OptionalAuthUser(_user): OptionalAuthUser,
    Query(query): Query<ListWikiQuery>,
) -> Result<Json<Vec<WikiArticle>>, AppError> {
    let limit = query.limit.unwrap_or(30).clamp(1, 100);
    let tag_filter = query
        .tag
        .as_deref()
        .map(|s| s.trim().trim_start_matches('#').to_ascii_lowercase())
        .filter(|s| !s.is_empty());
    let like_q = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{}%", s.to_ascii_lowercase()));

    let rows = sqlx::query_as::<_, WikiArticle>(
        "SELECT *
         FROM wiki_articles
         WHERE is_public = TRUE
           AND ($1::text IS NULL OR $1 = ANY(tags))
           AND ($2::text IS NULL OR LOWER(title) LIKE $2 OR LOWER(question_summary) LIKE $2)
         ORDER BY created_at DESC
         LIMIT $3",
    )
    .bind(tag_filter)
    .bind(like_q)
    .bind(limit)
    .fetch_all(&state.pg)
    .await?;

    Ok(Json(rows))
}

/// `GET /api/v1/moat/wiki/{slug}` (Public Read-Only)
pub async fn get_wiki_by_slug(
    State(state): State<Arc<AppState>>,
    OptionalAuthUser(user): OptionalAuthUser,
    Path(slug): Path<String>,
) -> Result<Json<WikiArticle>, AppError> {
    let article = sqlx::query_as::<_, WikiArticle>(
        "UPDATE wiki_articles
         SET view_count = view_count + 1
         WHERE slug = $1
         RETURNING *",
    )
    .bind(slug.trim())
    .fetch_optional(&state.pg)
    .await?
    .ok_or_else(|| AppError::NotFound("wiki article not found".into()))?;

    if !article.is_public && user.is_none() {
        return Err(AppError::Unauthorized("authentication required".into()));
    }

    Ok(Json(article))
}
