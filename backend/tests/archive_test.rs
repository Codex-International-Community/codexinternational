//! Tiered Message Archive (`before_seq`), Tombstone Overlay & R2 Media
//! Retention tests (`DEC-18`, `P§8`, Task 2.7).
//!
//! Live Postgres/Valkey tests are marked `#[ignore]` so `cargo test` passes
//! offline, and run in CI / local infra via `-- --include-ignored`.

use std::{
    collections::HashMap,
    io::Cursor,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use async_compression::tokio::bufread::ZstdDecoder;
use async_trait::async_trait;
use backend::{
    chat::{
        archive::{
            ArchiveStorage, ArchivedMessageRecord, BoxedByteStream, MOD_REMOVED_PLACEHOLDER,
            encode_archive_jsonl_zst, history_before_seq,
        },
        cleaner::{archive_old_messages, expire_old_media},
    },
    config::AppConfig,
    error::AppError,
    shared::db::run_migrations,
    state::AppState,
};
use chrono::{Duration as ChronoDuration, Utc};
use tokio::io::{AsyncBufReadExt, BufReader};
use uuid::Uuid;

#[derive(Default)]
struct InMemoryArchiveStorage {
    objects: Mutex<HashMap<String, Vec<u8>>>,
    get_calls: AtomicUsize,
    deleted_keys: Mutex<Vec<String>>,
}

#[async_trait]
impl ArchiveStorage for InMemoryArchiveStorage {
    async fn put_archive_zst(&self, key: &str, bytes: Vec<u8>) -> Result<(), AppError> {
        self.objects.lock().unwrap().insert(key.to_string(), bytes);
        Ok(())
    }

    async fn get_archive_stream(&self, key: &str) -> Result<BoxedByteStream, AppError> {
        self.get_calls.fetch_add(1, Ordering::SeqCst);
        let bytes = self
            .objects
            .lock()
            .unwrap()
            .get(key)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("missing archive key {key}")))?;
        Ok(Box::pin(Cursor::new(bytes)))
    }

    async fn delete_object(&self, key: &str) -> Result<(), AppError> {
        self.objects.lock().unwrap().remove(key);
        self.deleted_keys.lock().unwrap().push(key.to_string());
        Ok(())
    }
}

#[tokio::test]
async fn test_jsonl_zst_streaming_roundtrip() {
    let channel_id = Uuid::now_v7();
    let records = vec![
        ArchivedMessageRecord {
            id: Uuid::now_v7(),
            channel_id,
            seq_id: 1,
            client_msg_id: Uuid::now_v7(),
            author_id: Some(Uuid::now_v7()),
            content: Some("first archived".into()),
            reply_to_id: None,
            created_at: Utc::now(),
            edited: false,
        },
        ArchivedMessageRecord {
            id: Uuid::now_v7(),
            channel_id,
            seq_id: 2,
            client_msg_id: Uuid::now_v7(),
            author_id: Some(Uuid::now_v7()),
            content: Some("second archived".into()),
            reply_to_id: None,
            created_at: Utc::now(),
            edited: true,
        },
    ];

    let compressed = encode_archive_jsonl_zst(&records).await.unwrap();
    let decoder = ZstdDecoder::new(BufReader::new(Cursor::new(compressed)));
    let mut lines = BufReader::new(decoder).lines();
    let mut decoded = Vec::new();
    while let Some(line) = lines.next_line().await.unwrap() {
        decoded.push(serde_json::from_str::<ArchivedMessageRecord>(&line).unwrap());
    }
    assert_eq!(decoded.len(), 2);
    assert_eq!(decoded[0].seq_id, 1);
    assert_eq!(decoded[1].seq_id, 2);
    assert!(decoded[1].edited);
}

async fn setup_state() -> Arc<AppState> {
    let cfg = AppConfig::from_env().expect("env config");
    let state = AppState::connect(cfg).await.expect("connect dependencies");
    run_migrations(&state.pg).await.expect("run migrations");
    Arc::new(state)
}

#[tokio::test]
#[ignore = "requires live postgres and valkey"]
async fn test_archive_hot_boundary_cold_tombstone_and_media_retention() {
    let state = setup_state().await;
    let storage = InMemoryArchiveStorage::default();

    let user_ok = Uuid::now_v7();
    let user_wiped = Uuid::now_v7();
    let channel_id = Uuid::now_v7();

    for (uid, name) in [(user_ok, "ActiveAuthor"), (user_wiped, "WipedAuthor")] {
        sqlx::query(
            "INSERT INTO users (id, username, display_name, email) VALUES ($1, $2, $3, $4)",
        )
        .bind(uid)
        .bind(format!("arch_{}", &uid.simple().to_string()[..8]))
        .bind(name)
        .bind(format!("arch_{}@example.com", uid.simple()))
        .execute(&state.pg)
        .await
        .unwrap();
    }

    sqlx::query("INSERT INTO channels (id, type, dm_pair_key) VALUES ($1, 'dm', $2)")
        .bind(channel_id)
        .bind(format!("{user_ok}:{user_wiped}"))
        .execute(&state.pg)
        .await
        .unwrap();

    // Insert 5 old messages (> 1 year) for cold archiving: seq 1..=5.
    let old_ts = Utc::now() - ChronoDuration::days(400);
    let mut old_ids = Vec::new();
    for seq in 1..=5_i64 {
        let mid = Uuid::now_v7();
        old_ids.push(mid);
        let sender = if seq == 2 { user_wiped } else { user_ok };
        sqlx::query(
            "INSERT INTO messages (id, channel_id, sender_id, seq_id, client_msg_id, content, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(mid)
        .bind(channel_id)
        .bind(sender)
        .bind(seq)
        .bind(Uuid::now_v7())
        .bind(format!("old msg {seq}"))
        .bind(old_ts)
        .execute(&state.pg)
        .await
        .unwrap();
    }

    // Archive old messages to R2 (InMemoryArchiveStorage).
    let archived_count = archive_old_messages(&state, &storage).await.unwrap();
    assert!(archived_count >= 5);

    // Apply Tombstone Overlay without rewriting immutable R2 archive:
    // seq 2 -> wiped_archive_users; seq 3 -> USER_DELETED; seq 4 -> MOD_REMOVED.
    sqlx::query("INSERT INTO wiped_archive_users (user_id, wiped_before_seq) VALUES ($1, 10)")
        .bind(user_wiped)
        .execute(&state.pg)
        .await
        .unwrap();

    sqlx::query(
        "INSERT INTO archive_tombstones (channel_id, message_id, seq_id, action_type)
         VALUES ($1, $2, 3, 'USER_DELETED'), ($1, $3, 4, 'MOD_REMOVED')",
    )
    .bind(channel_id)
    .bind(old_ids[2])
    .bind(old_ids[3])
    .execute(&state.pg)
    .await
    .unwrap();

    // Insert 50 hot messages: seq 6..=55.
    for seq in 6..=55_i64 {
        sqlx::query(
            "INSERT INTO messages (id, channel_id, sender_id, seq_id, client_msg_id, content)
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(Uuid::now_v7())
        .bind(channel_id)
        .bind(user_ok)
        .bind(seq)
        .bind(Uuid::now_v7())
        .bind(format!("hot msg {seq}"))
        .execute(&state.pg)
        .await
        .unwrap();
    }

    // (a) Hot Path: before_seq = 56, limit = 50 -> 50 rows from DB, 0 R2 gets.
    let hot = history_before_seq(&state, &storage, channel_id, 56, 50)
        .await
        .unwrap();
    assert_eq!(hot.len(), 50);
    assert_eq!(storage.get_calls.load(Ordering::SeqCst), 0);

    // (b) Boundary Crossing: before_seq = 8, limit = 5 -> seq 6, 7 (DB) + seq 5, 4 (MOD_REMOVED), 1 (R2).
    let boundary = history_before_seq(&state, &storage, channel_id, 8, 5)
        .await
        .unwrap();
    let seqs: Vec<i64> = boundary.iter().map(|m| m.seq_id).collect();
    assert_eq!(seqs, vec![1, 4, 5, 6, 7]);
    let mod_msg = boundary.iter().find(|m| m.seq_id == 4).unwrap();
    assert_eq!(mod_msg.text, MOD_REMOVED_PLACEHOLDER);

    // (c) Cold Path: before_seq = 6, limit = 5 -> only seq 1, 4, 5 (2 wiped, 3 user deleted).
    let cold = history_before_seq(&state, &storage, channel_id, 6, 5)
        .await
        .unwrap();
    let cold_seqs: Vec<i64> = cold.iter().map(|m| m.seq_id).collect();
    assert_eq!(cold_seqs, vec![1, 4, 5]);

    // (d) R2 Media Retention > 3 months: media expired while message row stays intact.
    let media_id = Uuid::now_v7();
    let r2_media_key = format!("chat/{channel_id}/{media_id}.webp");
    storage
        .put_archive_zst(&r2_media_key, b"img".to_vec())
        .await
        .unwrap();

    sqlx::query(
        "INSERT INTO media_assets (id, uploader_id, kind, purpose, status, r2_key, mime_type, created_at)
         VALUES ($1, $2, 'image', 'chat', 'READY', $3, 'image/webp', $4)",
    )
    .bind(media_id)
    .bind(user_ok)
    .bind(&r2_media_key)
    .bind(Utc::now() - ChronoDuration::days(100))
    .execute(&state.pg)
    .await
    .unwrap();

    let expired = expire_old_media(&state, &storage).await.unwrap();
    assert!(expired >= 1);
    let status: String = sqlx::query_scalar("SELECT status FROM media_assets WHERE id = $1")
        .bind(media_id)
        .fetch_one(&state.pg)
        .await
        .unwrap();
    assert_eq!(status, "EXPIRED");
    assert!(storage.deleted_keys.lock().unwrap().contains(&r2_media_key));
}
