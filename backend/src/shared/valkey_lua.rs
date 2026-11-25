//! Valkey Lua scripts for atomic chat & Tier B counter operations (`INV-4`).

use std::collections::HashMap;

use fred::{clients::Pool, interfaces::LuaInterface};
use uuid::Uuid;

use crate::error::AppError;

/// Atomically updates `wb:read:{channel_id}` for `user_id` only if `seq_id`
/// is strictly greater than the currently buffered value (`INV-4`).
///
/// KEYS[1] = `wb:read:{channel_id}`
/// ARGV[1] = `user_id`
/// ARGV[2] = `seq_id`
pub const MARK_READ_MAX_LUA: &str = r#"
local cur = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '-1')
local nxt = tonumber(ARGV[2])
if nxt > cur then
    redis.call('HSET', KEYS[1], ARGV[1], tostring(nxt))
    return 1
end
return 0
"#;

/// Atomically reads all field/value pairs from a hash and deletes the key in
/// one Valkey Lua execution so concurrent `HINCRBY` / `HSET` calls are never lost.
///
/// KEYS[1] = hash key
/// Returns flat array `[field1, val1, field2, val2, ...]`.
pub const ATOMIC_SWAP_HASH_LUA: &str = r#"
local data = redis.call('HGETALL', KEYS[1])
if #data > 0 then
    redis.call('DEL', KEYS[1])
end
return data
"#;

/// Atomically reads all members from a set and deletes the key in one Lua call.
///
/// KEYS[1] = set key
pub const ATOMIC_POP_SET_LUA: &str = r#"
local members = redis.call('SMEMBERS', KEYS[1])
if #members > 0 then
    redis.call('DEL', KEYS[1])
end
return members
"#;

/// Single-step `SCAN` cursor wrapper for pattern-based key discovery.
///
/// ARGV[1] = match pattern
/// ARGV[2] = cursor string ("0" to start)
pub const SCAN_PAGE_LUA: &str = r#"
return redis.call('SCAN', ARGV[2], 'MATCH', ARGV[1], 'COUNT', 200)
"#;

/// Records `seq_id` in `wb:read:{channel_id}` only if it advances the cursor.
pub async fn mark_read_max(
    valkey: &Pool,
    channel_id: Uuid,
    user_id: Uuid,
    seq_id: i64,
) -> Result<bool, AppError> {
    let key = format!("wb:read:{channel_id}");
    let updated: i64 = valkey
        .eval(
            MARK_READ_MAX_LUA,
            vec![key],
            vec![user_id.to_string(), seq_id.max(0).to_string()],
        )
        .await?;
    Ok(updated == 1)
}

/// Atomically drains a Valkey hash (`HGETALL` + `DEL`) into a `HashMap`.
pub async fn atomic_swap_hash(
    valkey: &Pool,
    key: &str,
) -> Result<HashMap<String, String>, AppError> {
    let flat: Vec<String> = valkey
        .eval(
            ATOMIC_SWAP_HASH_LUA,
            vec![key.to_string()],
            Vec::<String>::new(),
        )
        .await?;
    let mut out = HashMap::with_capacity(flat.len() / 2);
    for [k, v] in flat.as_chunks::<2>().0 {
        out.insert(k.clone(), v.clone());
    }
    Ok(out)
}

/// Atomically drains a Valkey set (`SMEMBERS` + `DEL`).
pub async fn atomic_pop_set(valkey: &Pool, key: &str) -> Result<Vec<String>, AppError> {
    let members: Vec<String> = valkey
        .eval(
            ATOMIC_POP_SET_LUA,
            vec![key.to_string()],
            Vec::<String>::new(),
        )
        .await?;
    Ok(members)
}

/// Scans all keys matching `pattern` using `SCAN` without blocking Valkey.
pub async fn scan_keys(valkey: &Pool, pattern: &str) -> Result<Vec<String>, AppError> {
    let mut cursor = "0".to_string();
    let mut keys = Vec::new();
    loop {
        let (next_cursor, batch): (String, Vec<String>) = valkey
            .eval(
                SCAN_PAGE_LUA,
                Vec::<String>::new(),
                vec![pattern.to_string(), cursor],
            )
            .await?;
        keys.extend(batch);
        if next_cursor == "0" {
            break;
        }
        cursor = next_cursor;
    }
    Ok(keys)
}
