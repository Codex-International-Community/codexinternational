//! Tier B Hot Counter Flusher & Valkey Lua tests (`INV-4`, Task 2.5).
//!
//! Live Postgres/Valkey tests are marked `#[ignore]` so `cargo test` passes
//! offline, and run in CI / local infra via `-- --include-ignored`.

use std::sync::Arc;

use backend::{
    config::AppConfig,
    gamification::{
        flusher::{flush_counters_once, run_counter_flusher},
        level::calculate_level,
    },
    shared::{
        db::run_migrations,
        valkey_lua::{ATOMIC_POP_SET_LUA, ATOMIC_SWAP_HASH_LUA, MARK_READ_MAX_LUA, mark_read_max},
    },
    state::AppState,
};
use fred::interfaces::HashesInterface;
use tokio::sync::watch;
use uuid::Uuid;

#[test]
fn lua_scripts_contain_expected_atomic_primitives() {
    assert!(MARK_READ_MAX_LUA.contains("HGET") && MARK_READ_MAX_LUA.contains("HSET"));
    assert!(ATOMIC_SWAP_HASH_LUA.contains("HGETALL") && ATOMIC_SWAP_HASH_LUA.contains("DEL"));
    assert!(ATOMIC_POP_SET_LUA.contains("SMEMBERS") && ATOMIC_POP_SET_LUA.contains("DEL"));
    assert_eq!(calculate_level(400), 3);
}

async fn setup_state() -> Arc<AppState> {
    let cfg = AppConfig::from_env().expect("env config");
    let state = AppState::connect(cfg).await.expect("connect dependencies");
    run_migrations(&state.pg).await.expect("run migrations");
    Arc::new(state)
}

#[tokio::test]
#[ignore = "requires live postgres and valkey"]
async fn test_inv4_mark_read_max_never_regresses_and_flushes() {
    let state = setup_state().await;
    let user_id = Uuid::now_v7();
    let channel_id = Uuid::now_v7();
    let pair_key = format!("{user_id}:{user_id}");

    sqlx::query("INSERT INTO users (id, username, display_name, email) VALUES ($1, $2, $3, $4)")
        .bind(user_id)
        .bind(format!("u_{}", &user_id.simple().to_string()[..8]))
        .bind("Reader")
        .bind(format!("reader_{}@example.com", user_id.simple()))
        .execute(&state.pg)
        .await
        .unwrap();

    sqlx::query("INSERT INTO channels (id, type, dm_pair_key) VALUES ($1, 'dm', $2)")
        .bind(channel_id)
        .bind(pair_key)
        .execute(&state.pg)
        .await
        .unwrap();

    sqlx::query(
        "INSERT INTO channel_members (channel_id, user_id, last_read_seq_id) VALUES ($1, $2, 10)",
    )
    .bind(channel_id)
    .bind(user_id)
    .execute(&state.pg)
    .await
    .unwrap();

    assert!(
        mark_read_max(&state.valkey, channel_id, user_id, 25)
            .await
            .unwrap()
    );
    // Older seq_id must be rejected by Lua (`INV-4`).
    assert!(
        !mark_read_max(&state.valkey, channel_id, user_id, 15)
            .await
            .unwrap()
    );

    flush_counters_once(&state).await.unwrap();

    let persisted: i64 = sqlx::query_scalar(
        "SELECT last_read_seq_id FROM channel_members WHERE channel_id = $1 AND user_id = $2",
    )
    .bind(channel_id)
    .bind(user_id)
    .fetch_one(&state.pg)
    .await
    .unwrap();
    assert_eq!(persisted, 25);

    // Even if Valkey receives a lower value after flush, Postgres `GREATEST` preserves 25.
    assert!(
        mark_read_max(&state.valkey, channel_id, user_id, 12)
            .await
            .unwrap()
    );
    flush_counters_once(&state).await.unwrap();
    let after_lower: i64 = sqlx::query_scalar(
        "SELECT last_read_seq_id FROM channel_members WHERE channel_id = $1 AND user_id = $2",
    )
    .bind(channel_id)
    .bind(user_id)
    .fetch_one(&state.pg)
    .await
    .unwrap();
    assert_eq!(after_lower, 25);
}

#[tokio::test]
#[ignore = "requires live postgres and valkey"]
async fn test_atomic_swap_xp_concurrent_increments_and_shutdown_flush() {
    let state = setup_state().await;
    let user_id = Uuid::now_v7();
    let comm_id = Uuid::now_v7();

    sqlx::query("INSERT INTO users (id, username, display_name, email) VALUES ($1, $2, $3, $4)")
        .bind(user_id)
        .bind(format!("xp_{}", &user_id.simple().to_string()[..8]))
        .bind("XP User")
        .bind(format!("xp_{}@example.com", user_id.simple()))
        .execute(&state.pg)
        .await
        .unwrap();

    sqlx::query(
        "INSERT INTO communities (id, name, slug, owner_id, invite_code) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(comm_id)
    .bind("XP Comm")
    .bind(format!("xp-{}", &comm_id.simple().to_string()[..8]))
    .bind(user_id)
    .bind(format!("inv-{}", &comm_id.simple().to_string()[..8]))
    .execute(&state.pg)
    .await
    .unwrap();

    sqlx::query("INSERT INTO community_members (community_id, user_id) VALUES ($1, $2)")
        .bind(comm_id)
        .bind(user_id)
        .execute(&state.pg)
        .await
        .unwrap();

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let flusher = tokio::spawn(run_counter_flusher(state.clone(), shutdown_rx));

    // Fire 50 concurrent XP increments of 10 XP each = 500 XP total (Level 3).
    let mut handles = Vec::with_capacity(50);
    for _ in 0..50 {
        let vk = state.valkey.clone();
        let uid = user_id.to_string();
        let cid = comm_id.to_string();
        handles.push(tokio::spawn(async move {
            let _: i64 = vk
                .hincrby(format!("wb:xp:comm:{cid}"), &uid, 10)
                .await
                .unwrap();
            let _: i64 = vk.hincrby("wb:xp:global", &uid, 10).await.unwrap();
        }));
    }
    for h in handles {
        h.await.unwrap();
    }

    // Trigger graceful shutdown and wait for the final flush.
    shutdown_tx.send(true).unwrap();
    flusher.await.unwrap();

    let (comm_xp, comm_lvl): (i64, i32) = sqlx::query_as(
        "SELECT xp, level FROM community_members WHERE community_id = $1 AND user_id = $2",
    )
    .bind(comm_id)
    .bind(user_id)
    .fetch_one(&state.pg)
    .await
    .unwrap();
    assert_eq!(comm_xp, 500);
    assert_eq!(comm_lvl, 3);

    let (glob_xp, glob_lvl): (i64, i32) =
        sqlx::query_as("SELECT global_xp, global_level FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&state.pg)
            .await
            .unwrap();
    assert_eq!(glob_xp, 500);
    assert_eq!(glob_lvl, 3);
}
