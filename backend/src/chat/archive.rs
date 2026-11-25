//! Tiered Message Archive (`before_seq`), stateless `jsonl.zst` streaming
//! decompression, and Tombstone Overlay (`DEC-18`, `P§8`).

use std::{
    collections::{HashMap, HashSet},
    io::Cursor,
    pin::Pin,
};

use async_compression::tokio::{bufread::ZstdDecoder, write::ZstdEncoder};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader};
use uuid::Uuid;

use super::protocol::ClientMessage;
use crate::{
    config::AppConfig,
    error::AppError,
    media::{HTTP_CLIENT, presigned_r2_url},
    state::AppState,
};

pub const MOD_REMOVED_PLACEHOLDER: &str = "[Message removed by moderator]";

/// Minimal immutable archive record stored in `archive/{channel_id}/{min}_{max}.jsonl.zst`.
/// Stores `author_id` only so profile renames/anonymization hydrate dynamically.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchivedMessageRecord {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub seq_id: i64,
    pub client_msg_id: Uuid,
    #[serde(default)]
    pub author_id: Option<Uuid>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub reply_to_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub edited: bool,
}

#[derive(Debug, FromRow)]
struct ManifestRow {
    min_seq: i64,
    max_seq: i64,
    r2_object_key: String,
}

#[derive(Debug, FromRow)]
struct HotMessageRow {
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

pub type BoxedByteStream = Pin<Box<dyn AsyncRead + Send>>;

/// Storage abstraction for R2 Cold Archive & Media Retention (`P§8`),
/// allowing deterministic unit/integration tests without live R2 credentials.
#[async_trait]
pub trait ArchiveStorage: Send + Sync {
    async fn put_archive_zst(&self, key: &str, bytes: Vec<u8>) -> Result<(), AppError>;
    async fn get_archive_stream(&self, key: &str) -> Result<BoxedByteStream, AppError>;
    async fn delete_object(&self, key: &str) -> Result<(), AppError>;
}

/// Production Cloudflare R2 implementation using SigV4 presigned URLs.
pub struct R2ArchiveStorage {
    config: AppConfig,
}

impl R2ArchiveStorage {
    pub fn new(config: AppConfig) -> Self {
        Self { config }
    }
}

#[async_trait]
impl ArchiveStorage for R2ArchiveStorage {
    async fn put_archive_zst(&self, key: &str, bytes: Vec<u8>) -> Result<(), AppError> {
        let url = presigned_r2_url(&self.config, "PUT", key, 300)?;
        let resp = HTTP_CLIENT
            .put(url)
            .header("content-type", "application/zstd")
            .header("x-amz-storage-class", "STANDARD_IA")
            .body(bytes)
            .send()
            .await
            .map_err(|e| AppError::Internal(e.into()))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(anyhow::anyhow!(
                "R2 archive PUT failed ({status}): {body}"
            )));
        }
        Ok(())
    }

    async fn get_archive_stream(&self, key: &str) -> Result<BoxedByteStream, AppError> {
        let url = presigned_r2_url(&self.config, "GET", key, 300)?;
        let resp = HTTP_CLIENT
            .get(url)
            .send()
            .await
            .map_err(|e| AppError::Internal(e.into()))?;
        if !resp.status().is_success() {
            let status = resp.status();
            return Err(AppError::Internal(anyhow::anyhow!(
                "R2 archive GET failed ({status})"
            )));
        }
        // Stream response bytes into an in-memory cursor or chunked reader without
        // buffering decompressed JSONL or caching in Valkey (`P§8.1`).
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| AppError::Internal(e.into()))?;
        Ok(Box::pin(Cursor::new(bytes)))
    }

    async fn delete_object(&self, key: &str) -> Result<(), AppError> {
        let url = presigned_r2_url(&self.config, "DELETE", key, 300)?;
        let resp = HTTP_CLIENT
            .delete(url)
            .send()
            .await
            .map_err(|e| AppError::Internal(e.into()))?;
        if !resp.status().is_success() && resp.status().as_u16() != 404 {
            let status = resp.status();
            return Err(AppError::Internal(anyhow::anyhow!(
                "R2 object DELETE failed ({status})"
            )));
        }
        Ok(())
    }
}

/// Compresses `ArchivedMessageRecord` items as `jsonl.zst`.
pub async fn encode_archive_jsonl_zst(
    records: &[ArchivedMessageRecord],
) -> Result<Vec<u8>, AppError> {
    let mut encoder = ZstdEncoder::new(Vec::new());
    for rec in records {
        let mut line = serde_json::to_vec(rec).map_err(|e| AppError::Internal(e.into()))?;
        line.push(b'\n');
        encoder
            .write_all(&line)
            .await
            .map_err(|e| AppError::Internal(e.into()))?;
    }
    encoder
        .shutdown()
        .await
        .map_err(|e| AppError::Internal(e.into()))?;
    Ok(encoder.into_inner())
}

/// Fetches messages strictly before `before_seq` using Hot Path (PostgreSQL),
/// Boundary Crossing (PG + R2 `jsonl.zst`), or Cold Path (R2 `jsonl.zst` + Tombstone Overlay).
pub async fn history_before_seq(
    state: &AppState,
    storage: &dyn ArchiveStorage,
    channel_id: Uuid,
    before_seq: i64,
    limit: i64,
) -> Result<Vec<ClientMessage>, AppError> {
    let n = limit.clamp(1, 100) as usize;
    let mut out = query_hot_before_seq(state, channel_id, before_seq, n as i64).await?;

    // Hot Path: 100% satisfied from PostgreSQL without touching R2.
    if out.len() >= n {
        out.sort_by_key(|m| m.seq_id);
        return Ok(out);
    }

    // Boundary Crossing or Cold Path: search archive manifests below the
    // oldest seq returned by DB (or `< before_seq` if DB returned 0 rows).
    let mut cursor_seq = out.iter().map(|m| m.seq_id).min().unwrap_or(before_seq);

    while out.len() < n {
        let manifest: Option<ManifestRow> = sqlx::query_as(
            "SELECT min_seq, max_seq, r2_object_key
             FROM archive_manifests
             WHERE channel_id = $1 AND min_seq < $2
             ORDER BY max_seq DESC
             LIMIT 1",
        )
        .bind(channel_id)
        .bind(cursor_seq)
        .fetch_optional(&state.pg)
        .await?;

        let Some(manifest) = manifest else {
            break;
        };

        let remaining = n - out.len();
        let cold_msgs = read_cold_manifest_chunk(
            &state.pg, storage, channel_id, &manifest, cursor_seq, remaining,
        )
        .await?;
        out.extend(cold_msgs);

        if manifest.min_seq <= 1 {
            break;
        }
        cursor_seq = manifest.min_seq;
    }

    out.sort_by_key(|m| m.seq_id);
    Ok(out)
}

async fn query_hot_before_seq(
    state: &AppState,
    channel_id: Uuid,
    before_seq: i64,
    limit: i64,
) -> Result<Vec<ClientMessage>, AppError> {
    let rows = sqlx::query_as::<_, HotMessageRow>(
        "SELECT m.id, m.channel_id, m.seq_id, m.client_msg_id, m.sender_id, m.content,
                m.media_id, m.reply_to_id, m.created_at, m.edited_at,
                COALESCE(u.display_name, 'Deleted user') AS author, r.name AS role,
                ma.file_name AS media_file_name, ma.mime_type AS media_mime_type,
                COALESCE(ma.size_bytes, 0) AS media_size_bytes, ma.r2_key AS media_r2_key
         FROM (
             SELECT * FROM messages
             WHERE channel_id = $1 AND seq_id < $2 AND deleted_at IS NULL
             ORDER BY seq_id DESC
             LIMIT $3
         ) m
         LEFT JOIN users u ON u.id = m.sender_id
         LEFT JOIN channels ch ON ch.id = m.channel_id
         LEFT JOIN community_members cm ON cm.community_id = ch.community_id AND cm.user_id = m.sender_id
         LEFT JOIN community_roles r ON r.id = cm.role_id
         LEFT JOIN media_assets ma ON ma.id = m.media_id AND ma.purpose = 'chat' AND ma.status = 'READY'
         ORDER BY m.seq_id DESC",
    )
    .bind(channel_id)
    .bind(before_seq)
    .bind(limit)
    .fetch_all(&state.pg)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let author_id = r.sender_id.unwrap_or(Uuid::nil());
        let initials = initials_for(&r.author);
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

async fn read_cold_manifest_chunk(
    pg: &PgPool,
    storage: &dyn ArchiveStorage,
    channel_id: Uuid,
    manifest: &ManifestRow,
    upper_seq_exclusive: i64,
    needed: usize,
) -> Result<Vec<ClientMessage>, AppError> {
    // Parallel fetch: stream from R2 + Tombstones + Wiped Users (`P§8.3`).
    let tombstone_fut = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT message_id, action_type
         FROM archive_tombstones
         WHERE channel_id = $1 AND seq_id >= $2 AND seq_id <= $3",
    )
    .bind(channel_id)
    .bind(manifest.min_seq)
    .bind(manifest.max_seq)
    .fetch_all(pg);

    let wiped_fut = sqlx::query_as::<_, (Uuid, i64)>(
        "SELECT user_id, wiped_before_seq FROM wiped_archive_users",
    )
    .fetch_all(pg);

    let stream_fut = storage.get_archive_stream(&manifest.r2_object_key);

    let (tomb_res, wiped_res, stream_res) = tokio::join!(tombstone_fut, wiped_fut, stream_fut);

    let tombstones: HashMap<Uuid, String> = tomb_res?.into_iter().collect();
    let wiped_users: HashMap<Uuid, i64> = wiped_res?.into_iter().collect();
    let raw_stream = stream_res?;

    let decoder = ZstdDecoder::new(BufReader::new(raw_stream));
    let mut lines = BufReader::new(decoder).lines();
    let mut candidates = Vec::new();

    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|e| AppError::Internal(e.into()))?
    {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(rec) = serde_json::from_str::<ArchivedMessageRecord>(&line) else {
            continue;
        };
        if rec.seq_id >= upper_seq_exclusive {
            continue;
        }
        if let Some(uid) = rec.author_id
            && wiped_users.get(&uid).is_some_and(|&w| rec.seq_id <= w)
        {
            continue;
        }
        if let Some(action) = tombstones.get(&rec.id)
            && action == "USER_DELETED"
        {
            continue;
        }
        candidates.push(rec);
    }

    // Keep the top `needed` most recent messages strictly below `upper_seq_exclusive`.
    candidates.sort_by_key(|a| std::cmp::Reverse(a.seq_id));
    candidates.truncate(needed);

    let author_ids: Vec<Uuid> = candidates
        .iter()
        .filter_map(|r| r.author_id)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();

    let author_names: HashMap<Uuid, String> = if author_ids.is_empty() {
        HashMap::new()
    } else {
        sqlx::query_as::<_, (Uuid, String)>("SELECT id, display_name FROM users WHERE id = ANY($1)")
            .bind(&author_ids)
            .fetch_all(pg)
            .await?
            .into_iter()
            .collect()
    };

    let mut out = Vec::with_capacity(candidates.len());
    for rec in candidates {
        let is_mod_removed = tombstones.get(&rec.id).is_some_and(|a| a == "MOD_REMOVED");
        let author_id = rec.author_id.unwrap_or(Uuid::nil());
        let author = rec
            .author_id
            .and_then(|uid| author_names.get(&uid).cloned())
            .unwrap_or_else(|| "Deleted user".to_string());
        let initials = initials_for(&author);
        let text = if is_mod_removed {
            MOD_REMOVED_PLACEHOLDER.to_string()
        } else {
            rec.content.unwrap_or_default()
        };

        out.push(ClientMessage {
            id: rec.id.to_string(),
            channel_id: rec.channel_id.to_string(),
            seq_id: rec.seq_id,
            client_msg_id: rec.client_msg_id.to_string(),
            author_id: author_id.to_string(),
            author,
            initials,
            tone: "member".into(),
            time: rec.created_at.format("%H:%M").to_string(),
            created_at: rec.created_at,
            text,
            reactions: serde_json::json!({}),
            role: None,
            attachment: None,
            reply_to: rec.reply_to_id.map(|id| id.to_string()),
            edited: rec.edited,
        });
    }

    Ok(out)
}

fn initials_for(name: &str) -> String {
    name.split_whitespace()
        .filter_map(|p| p.chars().next())
        .take(2)
        .collect::<String>()
        .to_uppercase()
}
