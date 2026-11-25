//! Tier B background worker: flushes hot Valkey counters (`wb:read:*`,
//! `wb:xp:comm:*`, `wb:xp:global`, `wb:story_views`, `wb:contrib_likes`,
//! `users:last_seen`) to PostgreSQL every 500ms (`INV-4`).

use std::{collections::HashMap, sync::Arc, time::Duration};

use chrono::{DateTime, Utc};
use fred::interfaces::SortedSetsInterface;
use tokio::sync::watch;
use tokio::time::interval;
use uuid::Uuid;

use crate::{
    error::AppError,
    gamification::level::calculate_level,
    shared::valkey_lua::{atomic_pop_set, atomic_swap_hash, scan_keys},
    state::AppState,
};

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct CounterFlushStats {
    pub read_cursors: usize,
    pub community_xp: usize,
    pub global_xp: usize,
    pub story_views: usize,
    pub contrib_likes: usize,
    pub last_seen: usize,
}

/// Runs the Tier B hot counter flusher loop until `shutdown` signals `true`,
/// performing one final flush before exiting.
pub async fn run_counter_flusher(state: Arc<AppState>, mut shutdown: watch::Receiver<bool>) {
    let flush_ms = state.config.counter_flush_interval_ms.max(50);
    let mut ticker = interval(Duration::from_millis(flush_ms));

    loop {
        tokio::select! {
            _ = ticker.tick() => {
                if let Err(err) = flush_counters_once(&state).await {
                    tracing::warn!(error = %err, "tier B counter flush failed");
                }
            }
            changed = shutdown.changed() => {
                if changed.is_err() || *shutdown.borrow() {
                    if let Err(err) = flush_counters_once(&state).await {
                        tracing::warn!(error = %err, "tier B final counter flush failed");
                    }
                    tracing::info!("tier B counter flusher stopped after final flush");
                    break;
                }
            }
        }
    }
}

/// Drains all Tier B hot counters atomically from Valkey and persists them to
/// PostgreSQL. Exposed publicly for deterministic integration testing.
pub async fn flush_counters_once(state: &AppState) -> Result<CounterFlushStats, AppError> {
    Ok(CounterFlushStats {
        read_cursors: flush_read_cursors(state).await?,
        community_xp: flush_community_xp(state).await?,
        global_xp: flush_global_xp(state).await?,
        story_views: flush_story_views(state).await?,
        contrib_likes: flush_contrib_likes(state).await?,
        last_seen: flush_last_seen(state).await?,
    })
}

async fn flush_read_cursors(state: &AppState) -> Result<usize, AppError> {
    let keys = scan_keys(&state.valkey, "wb:read:*").await?;
    if keys.is_empty() {
        return Ok(0);
    }

    let mut channel_ids = Vec::new();
    let mut user_ids = Vec::new();
    let mut seq_ids = Vec::new();

    for key in keys {
        let Some(ch_str) = key.strip_prefix("wb:read:") else {
            continue;
        };
        let Ok(channel_id) = Uuid::parse_str(ch_str) else {
            continue;
        };
        let entries = atomic_swap_hash(&state.valkey, &key).await?;
        for (uid_str, seq_str) in entries {
            if let (Ok(user_id), Ok(seq_id)) = (Uuid::parse_str(&uid_str), seq_str.parse::<i64>()) {
                channel_ids.push(channel_id);
                user_ids.push(user_id);
                seq_ids.push(seq_id.max(0));
            }
        }
    }

    let count = channel_ids.len();
    if count == 0 {
        return Ok(0);
    }

    sqlx::query(
        "UPDATE channel_members AS cm
         SET last_read_seq_id = GREATEST(cm.last_read_seq_id, v.seq_id)
         FROM UNNEST($1::uuid[], $2::uuid[], $3::bigint[]) AS v(channel_id, user_id, seq_id)
         WHERE cm.channel_id = v.channel_id AND cm.user_id = v.user_id",
    )
    .bind(&channel_ids)
    .bind(&user_ids)
    .bind(&seq_ids)
    .execute(&state.pg)
    .await?;

    Ok(count)
}

async fn flush_community_xp(state: &AppState) -> Result<usize, AppError> {
    let keys = scan_keys(&state.valkey, "wb:xp:comm:*").await?;
    if keys.is_empty() {
        return Ok(0);
    }

    let mut comm_ids = Vec::new();
    let mut user_ids = Vec::new();
    let mut deltas = Vec::new();

    for key in keys {
        let Some(comm_str) = key.strip_prefix("wb:xp:comm:") else {
            continue;
        };
        let Ok(community_id) = Uuid::parse_str(comm_str) else {
            continue;
        };
        let entries = atomic_swap_hash(&state.valkey, &key).await?;
        for (uid_str, delta_str) in entries {
            if let (Ok(user_id), Ok(delta)) = (Uuid::parse_str(&uid_str), delta_str.parse::<i64>())
                && delta != 0
            {
                comm_ids.push(community_id);
                user_ids.push(user_id);
                deltas.push(delta);
            }
        }
    }

    let count = comm_ids.len();
    if count == 0 {
        return Ok(0);
    }

    let mut tx = state.pg.begin().await?;
    let updated: Vec<(Uuid, Uuid, i64)> = sqlx::query_as(
        "UPDATE community_members AS cm
         SET xp = GREATEST(0, cm.xp + v.delta)
         FROM UNNEST($1::uuid[], $2::uuid[], $3::bigint[]) AS v(community_id, user_id, delta)
         WHERE cm.community_id = v.community_id AND cm.user_id = v.user_id
         RETURNING cm.community_id, cm.user_id, cm.xp",
    )
    .bind(&comm_ids)
    .bind(&user_ids)
    .bind(&deltas)
    .fetch_all(&mut *tx)
    .await?;

    if !updated.is_empty() {
        let mut l_comm = Vec::with_capacity(updated.len());
        let mut l_user = Vec::with_capacity(updated.len());
        let mut l_val = Vec::with_capacity(updated.len());
        for (cid, uid, xp) in updated {
            l_comm.push(cid);
            l_user.push(uid);
            l_val.push(calculate_level(xp));
        }
        sqlx::query(
            "UPDATE community_members AS cm
             SET level = v.level
             FROM UNNEST($1::uuid[], $2::uuid[], $3::int[]) AS v(community_id, user_id, level)
             WHERE cm.community_id = v.community_id AND cm.user_id = v.user_id AND cm.level <> v.level",
        )
        .bind(&l_comm)
        .bind(&l_user)
        .bind(&l_val)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(count)
}

async fn flush_global_xp(state: &AppState) -> Result<usize, AppError> {
    let entries = atomic_swap_hash(&state.valkey, "wb:xp:global").await?;
    if entries.is_empty() {
        return Ok(0);
    }

    let mut user_ids = Vec::new();
    let mut deltas = Vec::new();
    for (uid_str, delta_str) in entries {
        if let (Ok(user_id), Ok(delta)) = (Uuid::parse_str(&uid_str), delta_str.parse::<i64>())
            && delta != 0
        {
            user_ids.push(user_id);
            deltas.push(delta);
        }
    }

    let count = user_ids.len();
    if count == 0 {
        return Ok(0);
    }

    let mut tx = state.pg.begin().await?;
    let updated: Vec<(Uuid, i64)> = sqlx::query_as(
        "UPDATE users AS u
         SET global_xp = GREATEST(0, u.global_xp + v.delta)
         FROM UNNEST($1::uuid[], $2::bigint[]) AS v(user_id, delta)
         WHERE u.id = v.user_id
         RETURNING u.id, u.global_xp",
    )
    .bind(&user_ids)
    .bind(&deltas)
    .fetch_all(&mut *tx)
    .await?;

    if !updated.is_empty() {
        let mut l_user = Vec::with_capacity(updated.len());
        let mut l_val = Vec::with_capacity(updated.len());
        for (uid, xp) in updated {
            l_user.push(uid);
            l_val.push(calculate_level(xp));
        }
        sqlx::query(
            "UPDATE users AS u
             SET global_level = v.level
             FROM UNNEST($1::uuid[], $2::int[]) AS v(user_id, level)
             WHERE u.id = v.user_id AND u.global_level <> v.level",
        )
        .bind(&l_user)
        .bind(&l_val)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(count)
}

async fn flush_story_views(state: &AppState) -> Result<usize, AppError> {
    let members = atomic_pop_set(&state.valkey, "wb:story_views").await?;
    if members.is_empty() {
        return Ok(0);
    }

    let mut story_ids = Vec::new();
    let mut viewer_ids = Vec::new();
    let mut viewed_ats = Vec::new();

    for raw in members {
        let mut parts = raw.split(':');
        let (Some(s_str), Some(v_str), Some(ts_str)) = (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        if let (Ok(story_id), Ok(viewer_id), Ok(ts)) = (
            Uuid::parse_str(s_str),
            Uuid::parse_str(v_str),
            ts_str.parse::<i64>(),
        ) {
            let dt = DateTime::<Utc>::from_timestamp(ts, 0).unwrap_or_else(Utc::now);
            story_ids.push(story_id);
            viewer_ids.push(viewer_id);
            viewed_ats.push(dt);
        }
    }

    let count = story_ids.len();
    if count == 0 {
        return Ok(0);
    }

    sqlx::query(
        "INSERT INTO story_views (story_id, viewer_id, viewed_at)
         SELECT s.id, v.viewer_id, v.viewed_at
         FROM UNNEST($1::uuid[], $2::uuid[], $3::timestamptz[]) AS v(story_id, viewer_id, viewed_at)
         JOIN stories s ON s.id = v.story_id
         ON CONFLICT (story_id, viewer_id) DO NOTHING",
    )
    .bind(&story_ids)
    .bind(&viewer_ids)
    .bind(&viewed_ats)
    .execute(&state.pg)
    .await?;

    Ok(count)
}

async fn flush_contrib_likes(state: &AppState) -> Result<usize, AppError> {
    let entries = atomic_swap_hash(&state.valkey, "wb:contrib_likes").await?;
    if entries.is_empty() {
        return Ok(0);
    }

    let mut add_contrib = Vec::new();
    let mut add_user = Vec::new();
    let mut del_contrib = Vec::new();
    let mut del_user = Vec::new();

    for (key, val) in entries {
        let Some((c_str, u_str)) = key.split_once(':') else {
            continue;
        };
        let (Ok(contrib_id), Ok(user_id)) = (Uuid::parse_str(c_str), Uuid::parse_str(u_str)) else {
            continue;
        };
        match val.trim() {
            "1" => {
                add_contrib.push(contrib_id);
                add_user.push(user_id);
            }
            "0" => {
                del_contrib.push(contrib_id);
                del_user.push(user_id);
            }
            _ => {}
        }
    }

    let total = add_contrib.len() + del_contrib.len();
    if total == 0 {
        return Ok(0);
    }

    let mut tx = state.pg.begin().await?;
    if !add_contrib.is_empty() {
        sqlx::query(
            "INSERT INTO contribution_likes (user_id, contribution_id)
             SELECT v.user_id, c.id
             FROM UNNEST($1::uuid[], $2::uuid[]) AS v(user_id, contribution_id)
             JOIN contributions c ON c.id = v.contribution_id
             ON CONFLICT (user_id, contribution_id) DO NOTHING",
        )
        .bind(&add_user)
        .bind(&add_contrib)
        .execute(&mut *tx)
        .await?;
    }
    if !del_contrib.is_empty() {
        sqlx::query(
            "DELETE FROM contribution_likes AS cl
             USING UNNEST($1::uuid[], $2::uuid[]) AS v(user_id, contribution_id)
             WHERE cl.user_id = v.user_id AND cl.contribution_id = v.contribution_id",
        )
        .bind(&del_user)
        .bind(&del_contrib)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    Ok(total)
}

async fn flush_last_seen(state: &AppState) -> Result<usize, AppError> {
    // Keep `users:last_seen` intact for `fcm_dispatcher` (`INV-10`), while
    // syncing the latest timestamps into Postgres via `GREATEST`.
    let pairs: Vec<(String, f64)> = state
        .valkey
        .zrange("users:last_seen", 0, -1, None, false, None, true)
        .await?;
    if pairs.is_empty() {
        return Ok(0);
    }

    let mut map: HashMap<Uuid, i64> = HashMap::with_capacity(pairs.len());
    for (uid_str, score) in pairs {
        if let Ok(uid) = Uuid::parse_str(&uid_str) {
            let ts = score as i64;
            if ts > 0 {
                map.entry(uid)
                    .and_modify(|prev| *prev = (*prev).max(ts))
                    .or_insert(ts);
            }
        }
    }

    let count = map.len();
    if count == 0 {
        return Ok(0);
    }

    let mut user_ids = Vec::with_capacity(count);
    let mut timestamps = Vec::with_capacity(count);
    for (uid, ts) in map {
        if let Some(dt) = DateTime::<Utc>::from_timestamp(ts, 0) {
            user_ids.push(uid);
            timestamps.push(dt);
        }
    }

    if user_ids.is_empty() {
        return Ok(0);
    }

    sqlx::query(
        "UPDATE users AS u
         SET last_seen_at = GREATEST(u.last_seen_at, v.ts)
         FROM UNNEST($1::uuid[], $2::timestamptz[]) AS v(user_id, ts)
         WHERE u.id = v.user_id AND u.last_seen_at < v.ts",
    )
    .bind(&user_ids)
    .bind(&timestamps)
    .execute(&state.pg)
    .await?;

    Ok(user_ids.len())
}
