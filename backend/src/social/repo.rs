use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use fred::interfaces::{KeysInterface, LuaInterface};
use serde::Deserialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use super::protocol::{
    CreatePostRequest, CreateReplyRequest, SocialActionKind, SocialActionStreamRecord,
    SocialPostResponse, SocialReplyResponse, ToggleActionResponse,
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
    platform_role: String,
    email_verified_at: Option<DateTime<Utc>>,
    content: String,
    media_url: Option<String>,
    media_alt: Option<String>,
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
    author: String,
    handle: String,
    content: String,
    created_at: DateTime<Utc>,
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
    if content.is_empty() {
        return Err(AppError::BadRequest("post content cannot be empty".into()));
    }
    if content.chars().count() > 500 {
        return Err(AppError::BadRequest(
            "post content cannot exceed 500 characters".into(),
        ));
    }
    let media_url = req
        .media_url
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let media_alt = req
        .media_alt
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let post_id = Uuid::now_v7();
    let now = Utc::now();

    sqlx::query(
        "INSERT INTO posts (id, user_id, content, media_url, media_alt, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)",
    )
    .bind(post_id)
    .bind(user_id)
    .bind(&content)
    .bind(&media_url)
    .bind(&media_alt)
    .bind(now)
    .execute(&state.pg)
    .await?;

    let user: (String, String, String, Option<DateTime<Utc>>) = sqlx::query_as(
        "SELECT display_name, username, platform_role, email_verified_at FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_one(&state.pg)
    .await?;

    Ok(SocialPostResponse {
        id: post_id,
        user_id,
        author: user.0,
        handle: user.1,
        verified: user.2 == "dev" || user.2 == "moderator" || user.3.is_some(),
        text: content,
        media: media_url,
        media_alt,
        likes: 0,
        reposts: 0,
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
    if content.is_empty() {
        return Err(AppError::BadRequest("reply content cannot be empty".into()));
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

    let reply_id = Uuid::now_v7();
    let now = Utc::now();

    let mut tx = state.pg.begin().await?;
    sqlx::query(
        "INSERT INTO post_replies (id, post_id, user_id, content, created_at)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(reply_id)
    .bind(post_id)
    .bind(user_id)
    .bind(&content)
    .bind(now)
    .execute(&mut *tx)
    .await?;

    sqlx::query("UPDATE posts SET replies_count = replies_count + 1 WHERE id = $1")
        .bind(post_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    let user: (String, String) =
        sqlx::query_as("SELECT display_name, username FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&state.pg)
            .await?;

    Ok(SocialReplyResponse {
        id: reply_id,
        author: user.0,
        handle: user.1,
        text: content,
        created_at: now,
    })
}

pub async fn list_posts(
    state: &AppState,
    user_id: Uuid,
    tab: Option<&str>,
    limit: i64,
) -> Result<Vec<SocialPostResponse>, AppError> {
    let limit = limit.clamp(1, 100);
    let rows = sqlx::query_as::<_, PostRow>(
        "SELECT
            p.id,
            p.user_id,
            u.display_name AS author,
            u.username AS handle,
            u.platform_role,
            u.email_verified_at,
            p.content,
            p.media_url,
            p.media_alt,
            p.likes_count,
            p.reposts_count,
            EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = $1) AS liked,
            EXISTS(SELECT 1 FROM post_reposts pr WHERE pr.post_id = p.id AND pr.user_id = $1) AS reposted,
            EXISTS(SELECT 1 FROM post_bookmarks pb WHERE pb.post_id = p.id AND pb.user_id = $1) AS saved,
            p.created_at
         FROM posts p
         JOIN users u ON u.id = p.user_id
         ORDER BY p.created_at DESC
         LIMIT $2",
    )
    .bind(user_id)
    .bind(limit)
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
            u.display_name AS author,
            u.username AS handle,
            r.content,
            r.created_at
         FROM post_replies r
         JOIN users u ON u.id = r.user_id
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
                author: rr.author,
                handle: rr.handle,
                text: rr.content,
                created_at: rr.created_at,
            });
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
            verified: row.platform_role == "dev"
                || row.platform_role == "moderator"
                || row.email_verified_at.is_some(),
            text: row.content,
            media: row.media_url,
            media_alt: row.media_alt,
            likes,
            reposts,
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

    Ok(posts)
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
        if active { "1".to_string() } else { "0".to_string() }
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
            vec![
                action_key,
                count_key,
                SOCIAL_ACTION_STREAM.to_string(),
            ],
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
