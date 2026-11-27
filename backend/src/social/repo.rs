use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use fred::interfaces::{KeysInterface, LuaInterface};
use serde::Deserialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use super::protocol::{
    CreatePostRequest, CreateReplyRequest, SocialActionKind, SocialActionStreamRecord,
    SocialActivityItem, SocialPostResponse, SocialReplyResponse, SocialStickerRef,
    ToggleActionResponse,
};
use crate::{error::AppError, state::AppState};

pub const SOCIAL_ACTION_STREAM: &str = "stream:social_actions";
pub const SOCIAL_ACTION_GROUP: &str = "social_pg_flusher";

const TOGGLE_ACTION_LUA: &str = r#"
local cur = redis.call('GET', KEYS[1])
if not cur then
  cur = ARGV[1]
end
local next_active = '1'
local delta = 1
if cur == '1' then
  next_active = '0'
  delta = -1
end
redis.call('SET', KEYS[1], next_active, 'EX', 3600)

local new_count = 0
if ARGV[3] ~= 'bookmark' then
  local cnt = redis.call('GET', KEYS[2])
  if not cnt then
    redis.call('SET', KEYS[2], ARGV[2], 'EX', 3600)
  end
  new_count = redis.call('INCRBY', KEYS[2], delta)
  if new_count < 0 then
    redis.call('SET', KEYS[2], '0', 'EX', 3600)
    new_count = 0
  else
    redis.call('EXPIRE', KEYS[2], 3600)
  end
end

local payload = cjson.encode({
  user_id = ARGV[4],
  post_id = ARGV[5],
  kind = ARGV[3],
  active = (next_active == '1'),
  timestamp_ms = tonumber(ARGV[6])
})
redis.call('XADD', KEYS[3], '*', 'payload', payload)
return cjson.encode({ active = (next_active == '1'), count = new_count })
"#;

#[derive(Debug, Deserialize)]
struct LuaToggleResult {
    active: bool,
    count: i64,
}

#[derive(Debug, FromRow)]
struct PostRow {
    id: Uuid,
    user_id: Uuid,
    author: String,
    handle: String,
    avatar_media_id: Option<Uuid>,
    platform_role: String,
    platform_badge: Option<String>,
    is_verified: bool,
    content: String,
    media_url: Option<String>,
    media_alt: Option<String>,
    sticker_id: Option<Uuid>,
    sticker_kind: Option<String>,
    sticker_label: Option<String>,
    sticker_media_url: Option<String>,
    likes_count: i32,
    reposts_count: i32,
    liked: bool,
    reposted: bool,
    saved: bool,
    created_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct ReplyRow {
    id: Uuid,
    post_id: Uuid,
    user_id: Uuid,
    parent_reply_id: Option<Uuid>,
    author: String,
    handle: String,
    avatar_media_id: Option<Uuid>,
    platform_role: String,
    platform_badge: Option<String>,
    is_verified: bool,
    content: String,
    media_url: Option<String>,
    media_alt: Option<String>,
    sticker_id: Option<Uuid>,
    sticker_kind: Option<String>,
    sticker_label: Option<String>,
    sticker_media_url: Option<String>,
    created_at: DateTime<Utc>,
}

fn build_sticker_ref(
    id: Option<Uuid>,
    kind: Option<String>,
    label: Option<String>,
    media_url: Option<String>,
) -> Option<SocialStickerRef> {
    match (id, kind, media_url) {
        (Some(id), Some(kind), Some(media_url)) => Some(SocialStickerRef {
            id,
            kind,
            label: label.unwrap_or_default(),
            media_url,
        }),
        _ => None,
    }
}

async fn fetch_sticker_ref(
    pg: &PgPool,
    sticker_id: Option<Uuid>,
) -> Result<Option<SocialStickerRef>, AppError> {
    let Some(sid) = sticker_id else {
        return Ok(None);
    };
    let row: Option<(Uuid, String, String, String)> =
        sqlx::query_as("SELECT id, kind, label, media_url FROM stickers WHERE id = $1")
            .bind(sid)
            .fetch_optional(pg)
            .await?;
    let (id, kind, label, media_url) =
        row.ok_or_else(|| AppError::NotFound("sticker not found".into()))?;
    Ok(Some(SocialStickerRef {
        id,
        kind,
        label,
        media_url,
    }))
}

#[derive(Debug, FromRow)]
struct PostCountsRow {
    likes_count: i32,
    reposts_count: i32,
}

fn user_action_key(kind: SocialActionKind, user_id: Uuid, post_id: Uuid) -> String {
    format!("social:user_action:{}:{user_id}:{post_id}", kind.as_str())
}

fn post_count_key(kind: SocialActionKind, post_id: Uuid) -> String {
    format!("social:count:{}:{post_id}", kind.as_str())
}

pub async fn create_post(
    state: &AppState,
    user_id: Uuid,
    req: CreatePostRequest,
) -> Result<SocialPostResponse, AppError> {
    let content = req.content.trim().to_string();
    let media_url = req
        .media_url
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let media_alt = req
        .media_alt
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let sticker = fetch_sticker_ref(&state.pg, req.sticker_id).await?;

    if content.is_empty() && media_url.is_none() && sticker.is_none() {
        return Err(AppError::BadRequest(
            "post must have text, media, or a sticker".into(),
        ));
    }
    if content.chars().count() > 500 {
        return Err(AppError::BadRequest(
            "post content cannot exceed 500 characters".into(),
        ));
    }

    let post_id = Uuid::now_v7();
    let now = Utc::now();
    let stored_content = encode_mentions(&state.pg, &content).await?;

    sqlx::query(
        "INSERT INTO posts (id, user_id, content, media_url, media_alt, sticker_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)",
    )
    .bind(post_id)
    .bind(user_id)
    .bind(&stored_content)
    .bind(&media_url)
    .bind(&media_alt)
    .bind(sticker.as_ref().map(|s| s.id))
    .bind(now)
    .execute(&state.pg)
    .await?;

    let user: (String, String, String, Option<String>, bool, Option<Uuid>) = sqlx::query_as(
        "SELECT display_name, username, platform_role, platform_badge, is_verified, avatar_media_id FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_one(&state.pg)
    .await?;

    Ok(SocialPostResponse {
        id: post_id,
        user_id,
        author: user.0,
        handle: user.1,
        avatar_media_id: user.5,
        verified: user.2 == "dev" || user.4,
        platform_badge: user.3,
        text: content,
        media: media_url,
        media_alt,
        sticker,
        likes: 0,
        reposts: 0,
        reposted_by: Vec::new(),
        replies: Vec::new(),
        liked: false,
        reposted: false,
        saved: false,
        created_at: now,
    })
}

pub async fn create_reply(
    state: &AppState,
    user_id: Uuid,
    post_id: Uuid,
    req: CreateReplyRequest,
) -> Result<SocialReplyResponse, AppError> {
    let content = req.content.trim().to_string();
    let media_url = req
        .media_url
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let media_alt = req
        .media_alt
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let sticker = fetch_sticker_ref(&state.pg, req.sticker_id).await?;

    if content.is_empty() && media_url.is_none() && sticker.is_none() {
        return Err(AppError::BadRequest(
            "reply must have text, media, or a sticker".into(),
        ));
    }
    if content.chars().count() > 500 {
        return Err(AppError::BadRequest(
            "reply content cannot exceed 500 characters".into(),
        ));
    }

    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM posts WHERE id = $1)")
        .bind(post_id)
        .fetch_one(&state.pg)
        .await?;
    if !exists {
        return Err(AppError::NotFound("post not found".into()));
    }

    if let Some(parent_id) = req.parent_reply_id {
        let parent_valid: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM post_replies WHERE id = $1 AND post_id = $2)",
        )
        .bind(parent_id)
        .bind(post_id)
        .fetch_one(&state.pg)
        .await?;
        if !parent_valid {
            return Err(AppError::NotFound("parent reply not found".into()));
        }
    }

    let reply_id = Uuid::now_v7();
    let now = Utc::now();

    let mut tx = state.pg.begin().await?;
    let stored_content = encode_mentions(&state.pg, &content).await?;

    sqlx::query(
        "INSERT INTO post_replies (id, post_id, user_id, parent_reply_id, content, media_url, media_alt, sticker_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(reply_id)
    .bind(post_id)
    .bind(user_id)
    .bind(req.parent_reply_id)
    .bind(&stored_content)
    .bind(&media_url)
    .bind(&media_alt)
    .bind(sticker.as_ref().map(|s| s.id))
    .bind(now)
    .execute(&mut *tx)
    .await?;

    sqlx::query("UPDATE posts SET replies_count = replies_count + 1 WHERE id = $1")
        .bind(post_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    let user: (String, String, String, Option<String>, bool, Option<Uuid>) = sqlx::query_as(
        "SELECT display_name, username, platform_role, platform_badge, is_verified, avatar_media_id FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_one(&state.pg)
    .await?;

    Ok(SocialReplyResponse {
        id: reply_id,
        user_id,
        parent_reply_id: req.parent_reply_id,
        author: user.0,
        handle: user.1,
        avatar_media_id: user.5,
        verified: user.2 == "dev" || user.4,
        platform_badge: user.3,
        text: content,
        media: media_url,
        media_alt,
        sticker,
        created_at: now,
    })
}

pub async fn delete_post(state: &AppState, user_id: Uuid, post_id: Uuid) -> Result<(), AppError> {
    let row: Option<(Uuid, Option<String>)> =
        sqlx::query_as("SELECT user_id, media_url FROM posts WHERE id = $1")
            .bind(post_id)
            .fetch_optional(&state.pg)
            .await?;
    let Some((owner_id, post_media_url)) = row else {
        return Err(AppError::NotFound("post not found".into()));
    };
    if owner_id != user_id {
        return Err(AppError::Forbidden(
            "cannot delete another user's post".into(),
        ));
    }

    let reply_media_urls: Vec<String> = sqlx::query_scalar(
        "SELECT media_url FROM post_replies WHERE post_id = $1 AND media_url IS NOT NULL",
    )
    .bind(post_id)
    .fetch_all(&state.pg)
    .await
    .unwrap_or_default();

    sqlx::query("DELETE FROM posts WHERE id = $1")
        .bind(post_id)
        .execute(&state.pg)
        .await?;

    let mut candidate_urls = reply_media_urls;
    if let Some(url) = post_media_url {
        candidate_urls.push(url);
    }
    if !candidate_urls.is_empty() {
        let pg = state.pg.clone();
        let cfg = state.config.clone();
        tokio::spawn(async move {
            for url in candidate_urls {
                crate::media::delete_orphan_media_by_url(&pg, &cfg, &url).await;
            }
        });
    }
    Ok(())
}

pub async fn delete_reply(state: &AppState, user_id: Uuid, reply_id: Uuid) -> Result<(), AppError> {
    let row: Option<(Uuid, Uuid, Option<String>)> =
        sqlx::query_as("SELECT user_id, post_id, media_url FROM post_replies WHERE id = $1")
            .bind(reply_id)
            .fetch_optional(&state.pg)
            .await?;
    let Some((owner_id, post_id, reply_media_url)) = row else {
        return Err(AppError::NotFound("reply not found".into()));
    };
    if owner_id != user_id {
        return Err(AppError::Forbidden(
            "cannot delete another user's reply".into(),
        ));
    }
    let mut tx = state.pg.begin().await?;
    sqlx::query("DELETE FROM post_replies WHERE id = $1")
        .bind(reply_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "UPDATE posts SET replies_count = (SELECT COUNT(*)::INT FROM post_replies WHERE post_id = $1) WHERE id = $1",
    )
    .bind(post_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    if let Some(url) = reply_media_url {
        let pg = state.pg.clone();
        let cfg = state.config.clone();
        tokio::spawn(async move {
            crate::media::delete_orphan_media_by_url(&pg, &cfg, &url).await;
        });
    }
    Ok(())
}

pub async fn dev_delete_post(state: &AppState, post_id: Uuid) -> Result<Uuid, AppError> {
    let row: Option<(Uuid, Option<String>)> =
        sqlx::query_as("SELECT user_id, media_url FROM posts WHERE id = $1")
            .bind(post_id)
            .fetch_optional(&state.pg)
            .await?;
    let Some((owner_id, post_media_url)) = row else {
        return Err(AppError::NotFound("post not found".into()));
    };

    let reply_media_urls: Vec<String> = sqlx::query_scalar(
        "SELECT media_url FROM post_replies WHERE post_id = $1 AND media_url IS NOT NULL",
    )
    .bind(post_id)
    .fetch_all(&state.pg)
    .await
    .unwrap_or_default();

    sqlx::query("DELETE FROM posts WHERE id = $1")
        .bind(post_id)
        .execute(&state.pg)
        .await?;

    let mut candidate_urls = reply_media_urls;
    if let Some(url) = post_media_url {
        candidate_urls.push(url);
    }
    if !candidate_urls.is_empty() {
        let pg = state.pg.clone();
        let cfg = state.config.clone();
        tokio::spawn(async move {
            for url in candidate_urls {
                crate::media::delete_orphan_media_by_url(&pg, &cfg, &url).await;
            }
        });
    }
    Ok(owner_id)
}

pub async fn dev_delete_reply(state: &AppState, reply_id: Uuid) -> Result<Uuid, AppError> {
    let row: Option<(Uuid, Uuid, Option<String>)> =
        sqlx::query_as("SELECT user_id, post_id, media_url FROM post_replies WHERE id = $1")
            .bind(reply_id)
            .fetch_optional(&state.pg)
            .await?;
    let Some((owner_id, post_id, reply_media_url)) = row else {
        return Err(AppError::NotFound("reply not found".into()));
    };
    let mut tx = state.pg.begin().await?;
    sqlx::query("DELETE FROM post_replies WHERE id = $1")
        .bind(reply_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "UPDATE posts SET replies_count = (SELECT COUNT(*)::INT FROM post_replies WHERE post_id = $1) WHERE id = $1",
    )
    .bind(post_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    if let Some(url) = reply_media_url {
        let pg = state.pg.clone();
        let cfg = state.config.clone();
        tokio::spawn(async move {
            crate::media::delete_orphan_media_by_url(&pg, &cfg, &url).await;
        });
    }
    Ok(owner_id)
}

pub async fn list_posts(
    state: &AppState,
    user_id: Uuid,
    tab: Option<&str>,
    limit: i64,
    post_id: Option<Uuid>,
) -> Result<Vec<SocialPostResponse>, AppError> {
    let limit = limit.clamp(1, 100);
    let rows = sqlx::query_as::<_, PostRow>(
        "SELECT
            p.id,
            p.user_id,
            u.display_name AS author,
            u.username AS handle,
            u.avatar_media_id,
            u.platform_role,
            u.platform_badge,
            u.is_verified,
            p.content,
            p.media_url,
            p.media_alt,
            s.id AS sticker_id,
            s.kind AS sticker_kind,
            s.label AS sticker_label,
            s.media_url AS sticker_media_url,
            p.likes_count,
            p.reposts_count,
            EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = $1) AS liked,
            EXISTS(SELECT 1 FROM post_reposts pr WHERE pr.post_id = p.id AND pr.user_id = $1) AS reposted,
            EXISTS(SELECT 1 FROM post_bookmarks pb WHERE pb.post_id = p.id AND pb.user_id = $1) AS saved,
            p.created_at
         FROM posts p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN stickers s ON s.id = p.sticker_id
         WHERE ($3::uuid IS NULL OR p.id = $3)
         ORDER BY p.created_at DESC
         LIMIT $2",
    )
    .bind(user_id)
    .bind(limit)
    .bind(post_id)
    .fetch_all(&state.pg)
    .await?;

    if rows.is_empty() {
        return Ok(Vec::new());
    }

    let post_ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let reply_rows = sqlx::query_as::<_, ReplyRow>(
        "SELECT
            r.id,
            r.post_id,
            r.user_id,
            r.parent_reply_id,
            u.display_name AS author,
            u.username AS handle,
            u.avatar_media_id,
            u.platform_role,
            u.platform_badge,
            u.is_verified,
            r.content,
            r.media_url,
            r.media_alt,
            s.id AS sticker_id,
            s.kind AS sticker_kind,
            s.label AS sticker_label,
            s.media_url AS sticker_media_url,
            r.created_at
         FROM post_replies r
         JOIN users u ON u.id = r.user_id
         LEFT JOIN stickers s ON s.id = r.sticker_id
         WHERE r.post_id = ANY($1)
         ORDER BY r.created_at ASC",
    )
    .bind(&post_ids)
    .fetch_all(&state.pg)
    .await?;

    let mut replies_by_post: HashMap<Uuid, Vec<SocialReplyResponse>> = HashMap::new();
    for rr in reply_rows {
        replies_by_post
            .entry(rr.post_id)
            .or_default()
            .push(SocialReplyResponse {
                id: rr.id,
                user_id: rr.user_id,
                parent_reply_id: rr.parent_reply_id,
                author: rr.author,
                handle: rr.handle,
                avatar_media_id: rr.avatar_media_id,
                verified: rr.platform_role == "dev" || rr.is_verified,
                platform_badge: rr.platform_badge,
                text: rr.content,
                media: rr.media_url.map(crate::media::normalize_public_media_url),
                media_alt: rr.media_alt,
                sticker: build_sticker_ref(
                    rr.sticker_id,
                    rr.sticker_kind,
                    rr.sticker_label,
                    rr.sticker_media_url
                        .map(crate::media::normalize_public_media_url),
                ),
                created_at: rr.created_at,
            });
    }

    let reposter_rows: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT pr.post_id, u.display_name
         FROM post_reposts pr
         JOIN users u ON u.id = pr.user_id
         WHERE pr.post_id = ANY($1)
         ORDER BY pr.created_at DESC",
    )
    .bind(&post_ids)
    .fetch_all(&state.pg)
    .await?;

    let mut reposters_by_post: HashMap<Uuid, Vec<String>> = HashMap::new();
    for (pid, name) in reposter_rows {
        let entry = reposters_by_post.entry(pid).or_default();
        if entry.len() < 3 && !entry.contains(&name) {
            entry.push(name);
        }
    }

    // Overlay any live Redis state (including unflushed actions inside the 500ms window).
    let mut keys: Vec<String> = Vec::with_capacity(post_ids.len() * 5);
    for pid in &post_ids {
        keys.push(user_action_key(SocialActionKind::Like, user_id, *pid));
        keys.push(user_action_key(SocialActionKind::Repost, user_id, *pid));
        keys.push(user_action_key(SocialActionKind::Bookmark, user_id, *pid));
        keys.push(post_count_key(SocialActionKind::Like, *pid));
        keys.push(post_count_key(SocialActionKind::Repost, *pid));
    }
    let redis_vals: Vec<Option<String>> = state.valkey.mget(keys).await.unwrap_or_default();

    let mut posts = Vec::with_capacity(rows.len());
    for (idx, row) in rows.into_iter().enumerate() {
        let base = idx * 5;
        let liked = redis_vals
            .get(base)
            .and_then(|v| v.as_deref())
            .map(|s| s == "1")
            .unwrap_or(row.liked);
        let reposted = redis_vals
            .get(base + 1)
            .and_then(|v| v.as_deref())
            .map(|s| s == "1")
            .unwrap_or(row.reposted);
        let saved = redis_vals
            .get(base + 2)
            .and_then(|v| v.as_deref())
            .map(|s| s == "1")
            .unwrap_or(row.saved);
        let likes = redis_vals
            .get(base + 3)
            .and_then(|v| v.as_deref())
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(i64::from(row.likes_count));
        let reposts = redis_vals
            .get(base + 4)
            .and_then(|v| v.as_deref())
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(i64::from(row.reposts_count));

        posts.push(SocialPostResponse {
            id: row.id,
            user_id: row.user_id,
            author: row.author,
            handle: row.handle,
            avatar_media_id: row.avatar_media_id,
            verified: row.platform_role == "dev" || row.is_verified,
            platform_badge: row.platform_badge,
            text: row.content,
            media: row.media_url.map(crate::media::normalize_public_media_url),
            media_alt: row.media_alt,
            sticker: build_sticker_ref(
                row.sticker_id,
                row.sticker_kind,
                row.sticker_label,
                row.sticker_media_url
                    .map(crate::media::normalize_public_media_url),
            ),
            likes,
            reposts,
            reposted_by: reposters_by_post.remove(&row.id).unwrap_or_default(),
            replies: replies_by_post.remove(&row.id).unwrap_or_default(),
            liked,
            reposted,
            saved,
            created_at: row.created_at,
        });
    }

    if tab == Some("saved") {
        posts.retain(|p| p.saved);
    }

    resolve_mentions(&state.pg, &mut posts).await?;

    Ok(posts)
}

async fn encode_mentions(pool: &sqlx::PgPool, text: &str) -> Result<String, AppError> {
    if !text.contains('@') {
        return Ok(text.to_string());
    }

    let mut handles = Vec::new();
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'@' {
            let start = i + 1;
            let mut end = start;
            while end < bytes.len() && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'_') {
                end += 1;
            }
            let len = end - start;
            if (2..=32).contains(&len) {
                handles.push(text[start..end].to_ascii_lowercase());
            }
            i = end;
        } else {
            i += 1;
        }
    }

    if handles.is_empty() {
        return Ok(text.to_string());
    }
    handles.sort();
    handles.dedup();

    let rows: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT id, LOWER(username) FROM users WHERE LOWER(username) = ANY($1)")
            .bind(&handles)
            .fetch_all(pool)
            .await?;

    if rows.is_empty() {
        return Ok(text.to_string());
    }

    let map: HashMap<String, Uuid> = rows.into_iter().map(|(id, u)| (u, id)).collect();
    let mut out = String::with_capacity(text.len() + 32);
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'@' {
            let start = i + 1;
            let mut end = start;
            while end < bytes.len() && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'_') {
                end += 1;
            }
            let len = end - start;
            if (2..=32).contains(&len)
                && let Some(uid) = map.get(&text[start..end].to_ascii_lowercase())
            {
                out.push_str("<@");
                out.push_str(&uid.to_string());
                out.push('>');
                i = end;
                continue;
            }
        }
        let ch = text[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }

    Ok(out)
}

async fn resolve_mentions(
    pool: &sqlx::PgPool,
    posts: &mut [SocialPostResponse],
) -> Result<(), AppError> {
    let mut ids = Vec::new();
    let collect_ids = |text: &str, out: &mut Vec<Uuid>| {
        let mut rest = text;
        while let Some(pos) = rest.find("<@") {
            let after = &rest[pos + 2..];
            if let Some(end) = after.find('>') {
                if let Ok(uid) = Uuid::parse_str(&after[..end]) {
                    out.push(uid);
                }
                rest = &after[end + 1..];
            } else {
                break;
            }
        }
    };

    for p in posts.iter() {
        if p.text.contains("<@") {
            collect_ids(&p.text, &mut ids);
        }
        for r in &p.replies {
            if r.text.contains("<@") {
                collect_ids(&r.text, &mut ids);
            }
        }
    }

    if ids.is_empty() {
        return Ok(());
    }
    ids.sort();
    ids.dedup();

    let rows: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT id, username FROM users WHERE id = ANY($1)")
            .bind(&ids)
            .fetch_all(pool)
            .await?;

    if rows.is_empty() {
        return Ok(());
    }
    let map: HashMap<Uuid, String> = rows.into_iter().collect();

    let replace_text = |text: &mut String| {
        if !text.contains("<@") {
            return;
        }
        let mut out = String::with_capacity(text.len());
        let mut rest = text.as_str();
        while let Some(pos) = rest.find("<@") {
            out.push_str(&rest[..pos]);
            let after = &rest[pos + 2..];
            if let Some(end) = after.find('>') {
                if let Ok(uid) = Uuid::parse_str(&after[..end])
                    && let Some(username) = map.get(&uid)
                {
                    out.push('@');
                    out.push_str(username);
                    rest = &after[end + 1..];
                    continue;
                }
            }
            out.push_str("<@");
            rest = after;
        }
        out.push_str(rest);
        *text = out;
    };

    for p in posts.iter_mut() {
        replace_text(&mut p.text);
        for r in &mut p.replies {
            replace_text(&mut r.text);
        }
    }

    Ok(())
}

pub async fn toggle_action(
    state: &AppState,
    user_id: Uuid,
    post_id: Uuid,
    kind: SocialActionKind,
) -> Result<ToggleActionResponse, AppError> {
    let counts = sqlx::query_as::<_, PostCountsRow>(
        "SELECT likes_count, reposts_count FROM posts WHERE id = $1",
    )
    .bind(post_id)
    .fetch_optional(&state.pg)
    .await?
    .ok_or_else(|| AppError::NotFound("post not found".into()))?;

    let action_key = user_action_key(kind, user_id, post_id);
    let count_key = post_count_key(kind, post_id);

    // Hydrate initial user state from DB only if not already cached in Redis.
    let cached_state: Option<String> = state.valkey.get(&action_key).await.ok().flatten();
    let db_active_str = if let Some(s) = cached_state {
        s
    } else {
        let query = match kind {
            SocialActionKind::Like => {
                "SELECT EXISTS(SELECT 1 FROM post_likes WHERE user_id = $1 AND post_id = $2)"
            }
            SocialActionKind::Repost => {
                "SELECT EXISTS(SELECT 1 FROM post_reposts WHERE user_id = $1 AND post_id = $2)"
            }
            SocialActionKind::Bookmark => {
                "SELECT EXISTS(SELECT 1 FROM post_bookmarks WHERE user_id = $1 AND post_id = $2)"
            }
        };
        let active: bool = sqlx::query_scalar(query)
            .bind(user_id)
            .bind(post_id)
            .fetch_one(&state.pg)
            .await?;
        if active {
            "1".to_string()
        } else {
            "0".to_string()
        }
    };

    let db_count = match kind {
        SocialActionKind::Like => i64::from(counts.likes_count),
        SocialActionKind::Repost => i64::from(counts.reposts_count),
        SocialActionKind::Bookmark => 0,
    };

    let now_ms = Utc::now().timestamp_millis();
    let raw: String = state
        .valkey
        .eval(
            TOGGLE_ACTION_LUA,
            vec![action_key, count_key, SOCIAL_ACTION_STREAM.to_string()],
            vec![
                db_active_str,
                db_count.to_string(),
                kind.as_str().to_string(),
                user_id.to_string(),
                post_id.to_string(),
                now_ms.to_string(),
            ],
        )
        .await?;

    let parsed: LuaToggleResult =
        serde_json::from_str(&raw).map_err(|e| AppError::Internal(e.into()))?;

    let (likes, reposts) = match kind {
        SocialActionKind::Like => {
            let r: Option<String> = state
                .valkey
                .get(post_count_key(SocialActionKind::Repost, post_id))
                .await
                .ok()
                .flatten();
            let reposts = r
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(i64::from(counts.reposts_count));
            (parsed.count, reposts)
        }
        SocialActionKind::Repost => {
            let l: Option<String> = state
                .valkey
                .get(post_count_key(SocialActionKind::Like, post_id))
                .await
                .ok()
                .flatten();
            let likes = l
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(i64::from(counts.likes_count));
            (likes, parsed.count)
        }
        SocialActionKind::Bookmark => {
            let keys = vec![
                post_count_key(SocialActionKind::Like, post_id),
                post_count_key(SocialActionKind::Repost, post_id),
            ];
            let vals: Vec<Option<String>> = state.valkey.mget(keys).await.unwrap_or_default();
            let likes = vals
                .first()
                .and_then(|v| v.as_deref())
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(i64::from(counts.likes_count));
            let reposts = vals
                .get(1)
                .and_then(|v| v.as_deref())
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(i64::from(counts.reposts_count));
            (likes, reposts)
        }
    };

    Ok(ToggleActionResponse {
        post_id,
        action: kind.as_str().to_string(),
        active: parsed.active,
        likes,
        reposts,
    })
}

pub async fn persist_action_batch(
    pg: &PgPool,
    batch: &[(String, SocialActionStreamRecord)],
) -> Result<(), AppError> {
    if batch.is_empty() {
        return Ok(());
    }

    // Deduplicate by (user_id, post_id, kind), keeping the latest action in the 500ms window.
    let mut deduped: HashMap<(Uuid, Uuid, SocialActionKind), bool> =
        HashMap::with_capacity(batch.len());
    let mut affected_count_posts: HashSet<Uuid> = HashSet::new();

    for (_, rec) in batch {
        deduped.insert((rec.user_id, rec.post_id, rec.kind), rec.active);
        if matches!(rec.kind, SocialActionKind::Like | SocialActionKind::Repost) {
            affected_count_posts.insert(rec.post_id);
        }
    }

    let mut tx = pg.begin().await?;

    for ((user_id, post_id, kind), active) in deduped {
        let sql = match (kind, active) {
            (SocialActionKind::Like, true) => {
                "INSERT INTO post_likes (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
            }
            (SocialActionKind::Like, false) => {
                "DELETE FROM post_likes WHERE user_id = $1 AND post_id = $2"
            }
            (SocialActionKind::Repost, true) => {
                "INSERT INTO post_reposts (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
            }
            (SocialActionKind::Repost, false) => {
                "DELETE FROM post_reposts WHERE user_id = $1 AND post_id = $2"
            }
            (SocialActionKind::Bookmark, true) => {
                "INSERT INTO post_bookmarks (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
            }
            (SocialActionKind::Bookmark, false) => {
                "DELETE FROM post_bookmarks WHERE user_id = $1 AND post_id = $2"
            }
        };
        sqlx::query(sql)
            .bind(user_id)
            .bind(post_id)
            .execute(&mut *tx)
            .await?;
    }

    if !affected_count_posts.is_empty() {
        let ids: Vec<Uuid> = affected_count_posts.into_iter().collect();
        sqlx::query(
            "UPDATE posts p
             SET likes_count = (SELECT COUNT(*)::INT FROM post_likes WHERE post_id = p.id),
                 reposts_count = (SELECT COUNT(*)::INT FROM post_reposts WHERE post_id = p.id)
             WHERE p.id = ANY($1)",
        )
        .bind(&ids)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

#[derive(Debug, FromRow)]
struct ActivityRow {
    id: String,
    post_id: Uuid,
    kind: String,
    actor_name: String,
    actor_handle: String,
    preview: String,
    created_at: DateTime<Utc>,
}

pub async fn list_activity(
    state: &AppState,
    user_id: Uuid,
    limit: i64,
) -> Result<Vec<SocialActivityItem>, AppError> {
    let limit = limit.clamp(1, 50);
    let rows = sqlx::query_as::<_, ActivityRow>(
        "SELECT id, post_id, kind, actor_name, actor_handle, preview, created_at
         FROM (
             SELECT
                 'reply:' || r.id::text AS id,
                 r.post_id,
                 'reply'::text AS kind,
                 u.display_name AS actor_name,
                 u.username AS actor_handle,
                 r.content AS preview,
                 r.created_at
             FROM post_replies r
             JOIN posts p ON p.id = r.post_id
             JOIN users u ON u.id = r.user_id
             WHERE p.user_id = $1 AND r.user_id <> $1 AND r.parent_reply_id IS NULL

             UNION ALL

             SELECT
                 'reply_to_reply:' || r.id::text AS id,
                 r.post_id,
                 'reply_to_reply'::text AS kind,
                 u.display_name AS actor_name,
                 u.username AS actor_handle,
                 r.content AS preview,
                 r.created_at
             FROM post_replies r
             JOIN post_replies parent ON parent.id = r.parent_reply_id
             JOIN users u ON u.id = r.user_id
             WHERE parent.user_id = $1 AND r.user_id <> $1

             UNION ALL

             SELECT
                 'like:' || pl.user_id::text || ':' || pl.post_id::text AS id,
                 pl.post_id,
                 'like'::text AS kind,
                 u.display_name AS actor_name,
                 u.username AS actor_handle,
                 p.content AS preview,
                 pl.created_at
             FROM post_likes pl
             JOIN posts p ON p.id = pl.post_id
             JOIN users u ON u.id = pl.user_id
             WHERE p.user_id = $1 AND pl.user_id <> $1

             UNION ALL

             SELECT
                 'repost:' || pr.user_id::text || ':' || pr.post_id::text AS id,
                 pr.post_id,
                 'repost'::text AS kind,
                 u.display_name AS actor_name,
                 u.username AS actor_handle,
                 p.content AS preview,
                 pr.created_at
             FROM post_reposts pr
             JOIN posts p ON p.id = pr.post_id
             JOIN users u ON u.id = pr.user_id
             WHERE p.user_id = $1 AND pr.user_id <> $1
         ) AS activity
         ORDER BY created_at DESC
         LIMIT $2",
    )
    .bind(user_id)
    .bind(limit)
    .fetch_all(&state.pg)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| SocialActivityItem {
            id: r.id,
            post_id: r.post_id,
            kind: r.kind,
            actor_name: r.actor_name,
            actor_handle: r.actor_handle,
            preview: r.preview,
            created_at: r.created_at,
        })
        .collect())
}
