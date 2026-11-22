use super::protocol::{ClientMessage, MessageAck, MessageStreamRecord};
use crate::{
    auth::extractor::AuthUser,
    communities::permissions::{PERM_SEND_MESSAGES, PERM_VIEW_CHANNEL, has_permission},
    error::AppError,
    state::AppState,
};
use chrono::{DateTime, Utc};
use fred::interfaces::{LuaInterface, StreamsInterface};
use serde::Deserialize;
use sqlx::{FromRow, PgPool};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

pub const MESSAGE_STREAM: &str = "stream:messages";
pub const MESSAGE_GROUP: &str = "pg_flusher";

pub const ENQUEUE_LUA: &str = r#"
local old=redis.call('GET',KEYS[2])
if old then
 local prev=cjson.decode(old)
 if prev.senderId~=ARGV[2] or prev.channelId~=ARGV[3] then return redis.error_reply('IDEMPOTENCY_CONFLICT') end
 redis.call('PUBLISH',KEYS[4],prev.event)
 return prev.ack
end
if not redis.call('GET',KEYS[1]) then redis.call('SET',KEYS[1],ARGV[1]) end
local seq=redis.call('INCR',KEYS[1])
local msg=cjson.decode(ARGV[4]);msg.seqId=seq
local payload=cjson.encode(msg)
redis.call('XADD',KEYS[3],'*','payload',payload,'channel_id',ARGV[3],'seq_id',tostring(seq),'client_msg_id',ARGV[5])
local ack=cjson.encode({type='MESSAGE_ACK',client_msg_id=ARGV[5],id=msg.id,channel_id=ARGV[3],seq_id=seq,created_at=msg.createdAt})
local event=cjson.encode({type='MESSAGE_CREATE',message=msg})
redis.call('SET',KEYS[2],cjson.encode({senderId=ARGV[2],channelId=ARGV[3],ack=ack,event=event}),'EX',86400)
redis.call('PUBLISH',KEYS[4],event)
return ack
"#;

#[derive(Debug, FromRow)]
struct AccessRow {
    community_id: Option<Uuid>,
    member: bool,
    permissions: i64,
    timed_out: bool,
    last_seq_id: i64,
}
#[derive(Debug, FromRow)]
struct AuthorRow {
    display_name: String,
    username: String,
    role: Option<String>,
}
#[derive(Debug, FromRow)]
struct MessageRow {
    id: Uuid,
    channel_id: Uuid,
    seq_id: i64,
    client_msg_id: Uuid,
    sender_id: Option<Uuid>,
    content: Option<String>,
    media_id: Option<Uuid>,
    reply_to_id: Option<Uuid>,
    created_at: DateTime<Utc>,
    edited_at: Option<DateTime<Utc>>,
    author: String,
    role: Option<String>,
    media_file_name: Option<String>,
    media_mime_type: Option<String>,
    media_size_bytes: Option<i64>,
    media_r2_key: Option<String>,
}
#[derive(Debug, Deserialize)]
pub struct SendMessageInput {
    pub client_msg_id: Uuid,
    pub content: Option<String>,
    pub media_id: Option<Uuid>,
    pub reply_to_id: Option<Uuid>,
    pub reply_to_story_id: Option<Uuid>,
}

pub async fn channel_access(
    state: &AppState,
    channel: Uuid,
    user: Uuid,
    required: i64,
    sending: bool,
) -> Result<i64, AppError> {
    let row=sqlx::query_as::<_,AccessRow>(
 "SELECT ch.community_id,ch.last_seq_id,
 EXISTS(SELECT 1 FROM channel_members cm WHERE cm.channel_id=ch.id AND cm.user_id=$2) AS member,
 COALESCE(r.permissions,0)::BIGINT AS permissions,COALESCE(cm.timed_out_until>NOW(),FALSE) AS timed_out
 FROM channels ch LEFT JOIN community_members cm ON cm.community_id=ch.community_id AND cm.user_id=$2
 LEFT JOIN community_roles r ON r.id=cm.role_id WHERE ch.id=$1"
 ).bind(channel).bind(user).fetch_optional(&state.pg).await?.ok_or_else(||AppError::NotFound("channel not found".into()))?;
    if !row.member {
        return Err(AppError::Forbidden("channel membership required".into()));
    }
    if row.community_id.is_some() {
        if !has_permission(row.permissions, PERM_VIEW_CHANNEL) {
            return Err(AppError::Forbidden(
                "missing VIEW_CHANNEL permission".into(),
            ));
        }
        if sending && row.timed_out {
            return Err(AppError::Forbidden(
                "you are timed out in this community".into(),
            ));
        }
        if !has_permission(row.permissions, required) {
            return Err(AppError::Forbidden("missing channel permission".into()));
        }
    }
    Ok(row.last_seq_id)
}

pub async fn enqueue(
    state: &AppState,
    user: &AuthUser,
    channel: Uuid,
    input: SendMessageInput,
) -> Result<MessageAck, AppError> {
    let content = input.content.as_deref().unwrap_or("").trim();
    if content.chars().count() > 4000 {
        return Err(AppError::BadRequest("message too long".into()));
    }
    if content.is_empty() && input.media_id.is_none() {
        return Err(AppError::BadRequest(
            "message content or media is required".into(),
        ));
    }
    let last = channel_access(state, channel, user.user_id, PERM_SEND_MESSAGES, true).await?;
    if let Some(reply) = input.reply_to_id {
        let ok = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM messages WHERE id=$1 AND channel_id=$2)",
        )
        .bind(reply)
        .bind(channel)
        .fetch_one(&state.pg)
        .await?;
        if !ok {
            return Err(AppError::BadRequest(
                "reply target is not in this channel".into(),
            ));
        }
    }
    if let Some(story_id) = input.reply_to_story_id {
        let ok = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM stories WHERE id=$1)")
            .bind(story_id)
            .fetch_one(&state.pg)
            .await?;
        if !ok {
            return Err(AppError::BadRequest(
                "reply story target does not exist".into(),
            ));
        }
    }
    let already_persisted = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM messages WHERE client_msg_id=$1)",
    )
    .bind(input.client_msg_id)
    .fetch_one(&state.pg)
    .await?;
    if already_persisted {
        return Err(AppError::Conflict("duplicate client_msg_id".into()));
    }
    let author=sqlx::query_as::<_,AuthorRow>("SELECT u.display_name,u.username,r.name AS role FROM users u LEFT JOIN channels ch ON ch.id=$2 LEFT JOIN community_members cm ON cm.community_id=ch.community_id AND cm.user_id=u.id LEFT JOIN community_roles r ON r.id=cm.role_id WHERE u.id=$1").bind(user.user_id).bind(channel).fetch_optional(&state.pg).await?.ok_or_else(||AppError::Unauthorized("user account no longer exists".into()))?;
    let attachment = if let Some(media_id) = input.media_id {
        let row=sqlx::query_as::<_,(String,String,i64,String)>("SELECT file_name,mime_type,COALESCE(size_bytes,0),r2_key FROM media_assets WHERE id=$1 AND uploader_id=$2 AND purpose='chat' AND status='READY'")
   .bind(media_id).bind(user.user_id).fetch_optional(&state.pg).await?
   .ok_or_else(||AppError::BadRequest("uploaded attachment is unavailable or does not belong to you".into()))?;
        Some(crate::media::attachment_from_record(
            &state.config,
            media_id,
            row.0,
            row.1,
            row.2,
            row.3,
        )?)
    } else {
        None
    };
    let initials = author
        .display_name
        .split_whitespace()
        .filter_map(|p| p.chars().next())
        .take(2)
        .collect::<String>()
        .to_uppercase();
    let record = MessageStreamRecord {
        id: Uuid::now_v7(),
        channel_id: channel,
        seq_id: 0,
        client_msg_id: input.client_msg_id,
        sender_id: user.user_id,
        content: if content.is_empty() {
            None
        } else {
            Some(content.to_string())
        },
        media_id: input.media_id,
        reply_to_id: input.reply_to_id,
        reply_to_story_id: input.reply_to_story_id,
        created_at: Utc::now(),
        author: author.display_name,
        username: author.username,
        initials,
        role: author.role,
        attachment,
    };
    let ack: String = state
        .valkey
        .eval(
            ENQUEUE_LUA,
            vec![
                format!("ch:{channel}:seq"),
                format!("msg:idem:{}", input.client_msg_id),
                MESSAGE_STREAM.into(),
                format!("pubsub:ch:{channel}"),
            ],
            vec![
                last.to_string(),
                user.user_id.to_string(),
                channel.to_string(),
                serde_json::to_string(&record).map_err(|e| AppError::Internal(e.into()))?,
                input.client_msg_id.to_string(),
            ],
        )
        .await
        .map_err(|e| {
            if e.to_string().contains("IDEMPOTENCY_CONFLICT") {
                AppError::Conflict("client_msg_id reused".into())
            } else {
                AppError::from(e)
            }
        })?;
    serde_json::from_str(&ack).map_err(|e| AppError::Internal(e.into()))
}

type StreamTail = std::sync::Arc<Vec<(String, HashMap<String, String>)>>;
type TailCache = tokio::sync::Mutex<Option<(std::time::Instant, StreamTail)>>;

static TAIL_CACHE: std::sync::OnceLock<TailCache> = std::sync::OnceLock::new();
const TAIL_TTL: std::time::Duration = std::time::Duration::from_millis(250);

/// Unflushed stream entries, shared across concurrent `history` calls for `TAIL_TTL`.
/// The lock is held while refreshing so concurrent callers wait for one XRANGE
/// instead of each issuing their own (XRANGE of 1000 entries blocks Valkey ~3 ms).
async fn pending_tail(state: &AppState) -> Option<StreamTail> {
    let cache = TAIL_CACHE.get_or_init(|| tokio::sync::Mutex::new(None));
    let mut guard = cache.lock().await;
    if let Some((at, entries)) = guard.as_ref()
        && at.elapsed() < TAIL_TTL
    {
        return Some(entries.clone());
    }
    let fetched: Result<Vec<(String, HashMap<String, String>)>, _> = state
        .valkey
        .xrange_values(MESSAGE_STREAM, "-", "+", Some(1000))
        .await;
    let entries = std::sync::Arc::new(fetched.ok()?);
    *guard = Some((std::time::Instant::now(), entries.clone()));
    Some(entries)
}

type HistoryKey = (Uuid, i64, i64);
type HistorySlot = std::sync::Arc<
    tokio::sync::Mutex<Option<(std::time::Instant, std::sync::Arc<Vec<ClientMessage>>)>>,
>;

static HISTORY_CACHE: std::sync::OnceLock<std::sync::Mutex<HashMap<HistoryKey, HistorySlot>>> =
    std::sync::OnceLock::new();
const HISTORY_TTL: std::time::Duration = std::time::Duration::from_millis(300);
const HISTORY_MAX_KEYS: usize = 2000;

/// Postgres part of `history`, shared across concurrent callers for `HISTORY_TTL`.
/// One caller per key queries the DB while the rest await its result.
/// Pending (unflushed) messages are merged fresh by `history` via `pending_tail`.
async fn history_db_cached(
    state: &AppState,
    channel: Uuid,
    after: i64,
    n: i64,
) -> Result<std::sync::Arc<Vec<ClientMessage>>, AppError> {
    let key: HistoryKey = (channel, after.max(0), n);
    let slot = {
        let map = HISTORY_CACHE.get_or_init(|| std::sync::Mutex::new(HashMap::new()));
        let mut map = map.lock().unwrap_or_else(|e| e.into_inner());
        if map.len() >= HISTORY_MAX_KEYS && !map.contains_key(&key) {
            map.clear();
        }
        map.entry(key).or_default().clone()
    };
    let mut guard = slot.lock().await;
    if let Some((at, rows)) = guard.as_ref()
        && at.elapsed() < HISTORY_TTL
    {
        return Ok(rows.clone());
    }
    let rows = std::sync::Arc::new(history_db(state, channel, after, n).await?);
    *guard = Some((std::time::Instant::now(), rows.clone()));
    Ok(rows)
}

async fn history_db(
    state: &AppState,
    channel: Uuid,
    after: i64,
    n: i64,
) -> Result<Vec<ClientMessage>, AppError> {
    let rows=sqlx::query_as::<_,MessageRow>(
 "SELECT m.id,m.channel_id,m.seq_id,m.client_msg_id,m.sender_id,m.content,m.media_id,m.reply_to_id,m.created_at,m.edited_at,COALESCE(u.display_name,'Deleted user') AS author,r.name AS role,
         ma.file_name AS media_file_name,ma.mime_type AS media_mime_type,COALESCE(ma.size_bytes,0) AS media_size_bytes,ma.r2_key AS media_r2_key
 FROM (SELECT * FROM messages WHERE channel_id=$1 AND seq_id>$2 AND deleted_at IS NULL ORDER BY seq_id ASC LIMIT $3) m
 LEFT JOIN users u ON u.id=m.sender_id
 LEFT JOIN channels ch ON ch.id=m.channel_id
 LEFT JOIN community_members cm ON cm.community_id=ch.community_id AND cm.user_id=m.sender_id
 LEFT JOIN community_roles r ON r.id=cm.role_id
 LEFT JOIN media_assets ma ON ma.id=m.media_id AND ma.purpose='chat' AND ma.status='READY'
 ORDER BY m.seq_id ASC")
 .bind(channel).bind(after.max(0)).bind(n).fetch_all(&state.pg).await?;
    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let author_id = r.sender_id.unwrap_or(Uuid::nil());
        let initials = r
            .author
            .split_whitespace()
            .filter_map(|p| p.chars().next())
            .take(2)
            .collect::<String>()
            .to_uppercase();
        let attachment = match (
            r.media_id,
            r.media_file_name,
            r.media_mime_type,
            r.media_r2_key,
        ) {
            (Some(media_id), Some(name), Some(mime), Some(key)) => {
                Some(crate::media::attachment_from_record(
                    &state.config,
                    media_id,
                    name,
                    mime,
                    r.media_size_bytes.unwrap_or(0),
                    key,
                )?)
            }
            _ => None,
        };
        out.push(ClientMessage {
            id: r.id.to_string(),
            channel_id: r.channel_id.to_string(),
            seq_id: r.seq_id,
            client_msg_id: r.client_msg_id.to_string(),
            author_id: author_id.to_string(),
            author: r.author,
            initials,
            tone: "member".into(),
            time: r.created_at.format("%H:%M").to_string(),
            created_at: r.created_at,
            text: r.content.unwrap_or_default(),
            reactions: serde_json::json!({}),
            role: r.role,
            attachment,
            reply_to: r.reply_to_id.map(|id| id.to_string()),
            edited: r.edited_at.is_some(),
        });
    }
    Ok(out)
}

pub async fn history(
    state: &AppState,
    channel: Uuid,
    after: i64,
    limit: i64,
) -> Result<Vec<ClientMessage>, AppError> {
    let n = limit.clamp(1, 100);
    let db_rows = history_db_cached(state, channel, after, n).await?;
    let mut out: Vec<ClientMessage> = (*db_rows).clone();
    let tail = pending_tail(state).await;
    if let Some(entries) = tail {
        let mut seen = out.iter().map(|m| m.id.clone()).collect::<HashSet<_>>();
        let key = channel.to_string();
        for (_, fields) in entries.iter() {
            if fields.get("channel_id").map(String::as_str) != Some(key.as_str()) {
                continue;
            }
            if let Some(raw) = fields.get("payload")
                && let Ok(rec) = serde_json::from_str::<MessageStreamRecord>(raw)
                && rec.seq_id > after
                && seen.insert(rec.id.to_string())
            {
                out.push(ClientMessage::from(rec));
            }
        }
    }
    out.sort_by_key(|m| m.seq_id);
    out.truncate(n as usize);
    Ok(out)
}

pub async fn persist_batch(
    pool: &PgPool,
    batch: &[(String, MessageStreamRecord)],
) -> Result<(), AppError> {
    if batch.is_empty() {
        return Ok(());
    }
    let mut tx = pool.begin().await?;
    let mut latest = HashMap::<Uuid, i64>::new();
    for (_, m) in batch {
        sqlx::query("INSERT INTO messages(id,channel_id,sender_id,seq_id,client_msg_id,content,media_id,reply_to_id,reply_to_story_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(client_msg_id) DO NOTHING")
   .bind(m.id).bind(m.channel_id).bind(m.sender_id).bind(m.seq_id).bind(m.client_msg_id).bind(&m.content).bind(m.media_id).bind(m.reply_to_id).bind(m.reply_to_story_id).bind(m.created_at).execute(&mut *tx).await?;
        latest
            .entry(m.channel_id)
            .and_modify(|v| *v = (*v).max(m.seq_id))
            .or_insert(m.seq_id);
    }
    for (ch, seq) in latest {
        sqlx::query("UPDATE channels SET last_seq_id=GREATEST(last_seq_id,$2) WHERE id=$1")
            .bind(ch)
            .bind(seq)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}
