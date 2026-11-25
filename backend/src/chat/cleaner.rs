//! Background cleaner worker for Cold Message Archiving (`>= 1 year`) and
//! R2 Media Retention (`> 3 months`, `P§8.4`).

use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use fred::interfaces::KeysInterface;
use fred::types::SetOptions;
use sqlx::FromRow;
use tokio::sync::watch;
use tokio::time::interval;
use uuid::Uuid;

use super::archive::{
    ArchiveStorage, ArchivedMessageRecord, R2ArchiveStorage, encode_archive_jsonl_zst,
};
use crate::{error::AppError, state::AppState};

const ARCHIVE_LOCK_KEY: &str = "lock:cleaner:archive";
const MEDIA_RETENTION_LOCK_KEY: &str = "lock:cleaner:media_retention";
const LOCK_TTL_SECS: i64 = 300;
const ARCHIVE_BATCH_SIZE: i64 = 5000;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct CleanerStats {
    pub archived_messages: usize,
    pub expired_media: usize,
}

#[derive(Debug, FromRow)]
struct ArchivableMsgRow {
    id: Uuid,
    channel_id: Uuid,
    seq_id: i64,
    client_msg_id: Uuid,
    sender_id: Option<Uuid>,
    content: Option<String>,
    reply_to_id: Option<Uuid>,
    created_at: DateTime<Utc>,
    edited_at: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow)]
struct ExpiredMediaRow {
    id: Uuid,
    r2_key: Option<String>,
    r2_thumb_key: Option<String>,
    r2_raw_key: Option<String>,
}

/// Runs the hourly archive & media retention cleaner with distributed Valkey locks.
pub async fn run_archive_and_media_cleaner(
    state: Arc<AppState>,
    mut shutdown: watch::Receiver<bool>,
) {
    let storage = R2ArchiveStorage::new(state.config.clone());
    let mut ticker = interval(Duration::from_secs(3600));

    loop {
        tokio::select! {
            _ = ticker.tick() => {
                if let Err(err) = run_cleaner_cycle(&state, &storage).await {
                    tracing::warn!(error = %err, "archive/media cleaner cycle failed");
                }
            }
            changed = shutdown.changed() => {
                if changed.is_err() || *shutdown.borrow() {
                    tracing::info!("archive/media cleaner stopped");
                    break;
                }
            }
        }
    }
}

/// Executes one distributed-locked cycle of cold archiving + >3-month media retention.
pub async fn run_cleaner_cycle(
    state: &AppState,
    storage: &dyn ArchiveStorage,
) -> Result<CleanerStats, AppError> {
    let mut stats = CleanerStats::default();

    if acquire_lock(state, ARCHIVE_LOCK_KEY).await? {
        stats.archived_messages = archive_old_messages(state, storage).await?;
    }
    if acquire_lock(state, MEDIA_RETENTION_LOCK_KEY).await? {
        stats.expired_media = expire_old_media(state, storage).await?;
    }

    Ok(stats)
}

async fn acquire_lock(state: &AppState, key: &str) -> Result<bool, AppError> {
    let res: Option<String> = state
        .valkey
        .set(
            key,
            "1",
            Some(fred::types::Expiration::EX(LOCK_TTL_SECS)),
            Some(SetOptions::NX),
            false,
        )
        .await?;
    Ok(res.is_some())
}

/// Moves messages older than 1 year (`365 days`) to R2 `archive/{channel_id}/{min}_{max}.jsonl.zst`
/// (`STANDARD_IA`), inserts into `archive_manifests`, and deletes them from `messages`.
pub async fn archive_old_messages(
    state: &AppState,
    storage: &dyn ArchiveStorage,
) -> Result<usize, AppError> {
    let channels: Vec<Uuid> = sqlx::query_scalar(
        "SELECT DISTINCT channel_id
         FROM messages
         WHERE created_at < NOW() - INTERVAL '365 days'",
    )
    .fetch_all(&state.pg)
    .await?;

    let mut total_archived = 0usize;

    for channel_id in channels {
        let rows: Vec<ArchivableMsgRow> = sqlx::query_as(
            "SELECT id, channel_id, seq_id, client_msg_id, sender_id, content,
                    reply_to_id, created_at, edited_at
             FROM messages
             WHERE channel_id = $1 AND created_at < NOW() - INTERVAL '365 days'
             ORDER BY seq_id ASC
             LIMIT $2",
        )
        .bind(channel_id)
        .bind(ARCHIVE_BATCH_SIZE)
        .fetch_all(&state.pg)
        .await?;

        if rows.is_empty() {
            continue;
        }

        let min_seq = rows.first().map(|r| r.seq_id).unwrap_or(0);
        let max_seq = rows.last().map(|r| r.seq_id).unwrap_or(0);
        let r2_key = format!("archive/{channel_id}/{min_seq}_{max_seq}.jsonl.zst");

        let records: Vec<ArchivedMessageRecord> = rows
            .iter()
            .map(|r| ArchivedMessageRecord {
                id: r.id,
                channel_id: r.channel_id,
                seq_id: r.seq_id,
                client_msg_id: r.client_msg_id,
                author_id: r.sender_id,
                content: r.content.clone(),
                reply_to_id: r.reply_to_id,
                created_at: r.created_at,
                edited: r.edited_at.is_some(),
            })
            .collect();

        let compressed = encode_archive_jsonl_zst(&records).await?;
        storage.put_archive_zst(&r2_key, compressed).await?;

        let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
        let mut tx = state.pg.begin().await?;
        sqlx::query(
            "INSERT INTO archive_manifests (id, channel_id, min_seq, max_seq, r2_object_key, message_count)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (channel_id, min_seq, max_seq) DO NOTHING",
        )
        .bind(Uuid::now_v7())
        .bind(channel_id)
        .bind(min_seq)
        .bind(max_seq)
        .bind(&r2_key)
        .bind(rows.len() as i32)
        .execute(&mut *tx)
        .await?;

        sqlx::query("DELETE FROM messages WHERE id = ANY($1)")
            .bind(&ids)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;

        total_archived += rows.len();
    }

    Ok(total_archived)
}

/// Deletes R2 media objects older than 3 months (`90 days`) and marks
/// `media_assets.status = 'EXPIRED'`, keeping `messages` text rows intact (`P§8.4`).
/// (Super Server / subscribed DM retention exceptions will be joined in Task 7.4.)
pub async fn expire_old_media(
    state: &AppState,
    storage: &dyn ArchiveStorage,
) -> Result<usize, AppError> {
    let rows: Vec<ExpiredMediaRow> = sqlx::query_as(
        "SELECT id, r2_key, r2_thumb_key, r2_raw_key
         FROM media_assets
         WHERE created_at < NOW() - INTERVAL '90 days'
           AND status <> 'EXPIRED'
         ORDER BY created_at ASC
         LIMIT 500",
    )
    .fetch_all(&state.pg)
    .await?;

    if rows.is_empty() {
        return Ok(0);
    }

    let mut expired_ids = Vec::with_capacity(rows.len());
    for row in rows {
        for key in [row.r2_key, row.r2_thumb_key, row.r2_raw_key]
            .into_iter()
            .flatten()
        {
            if !key.trim().is_empty()
                && let Err(err) = storage.delete_object(&key).await
            {
                tracing::warn!(media_id = %row.id, r2_key = %key, error = %err, "failed to delete expired R2 object");
            }
        }
        expired_ids.push(row.id);
    }

    let res = sqlx::query(
        "UPDATE media_assets
         SET status = 'EXPIRED'
         WHERE id = ANY($1)",
    )
    .bind(&expired_ids)
    .execute(&state.pg)
    .await?;

    Ok(res.rows_affected() as usize)
}
