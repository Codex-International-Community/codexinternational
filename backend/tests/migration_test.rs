//! PostgreSQL migration & schema invariant tests (`INV-5`, `INV-6`, `INV-7`).
//! Marked `#[ignore]` so `cargo test` runs cleanly without a live DB locally;
//! CI (`ci-prod.yml`) and local DB runs execute them via `-- --include-ignored`.

use backend::{config::AppConfig, shared::db::run_migrations};
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

async fn setup_db() -> sqlx::PgPool {
    let cfg = AppConfig::from_env().expect("env config");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(cfg.database_url.expose())
        .await
        .expect("connect to postgres");
    run_migrations(&pool).await.expect("run migrations");
    // Re-run to verify idempotency.
    run_migrations(&pool).await.expect("idempotent migrations");
    pool
}

#[tokio::test]
#[ignore = "requires live postgres"]
async fn test_inv5_inv6_inv7_schema_constraints() {
    let pool = setup_db().await;

    let user_a = Uuid::now_v7();
    let user_b = Uuid::now_v7();
    let channel_id = Uuid::now_v7();
    let pair_key = if user_a < user_b {
        format!("{user_a}:{user_b}")
    } else {
        format!("{user_b}:{user_a}")
    };

    sqlx::query("INSERT INTO users (id, username, display_name, email) VALUES ($1, $2, $3, $4)")
        .bind(user_a)
        .bind(format!("ua_{}", &user_a.simple().to_string()[..8]))
        .bind("User A")
        .bind(format!("ua_{}@example.com", user_a.simple()))
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO users (id, username, display_name, email) VALUES ($1, $2, $3, $4)")
        .bind(user_b)
        .bind(format!("ub_{}", &user_b.simple().to_string()[..8]))
        .bind("User B")
        .bind(format!("ub_{}@example.com", user_b.simple()))
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO channels (id, type, dm_pair_key) VALUES ($1, 'dm', $2)")
        .bind(channel_id)
        .bind(&pair_key)
        .execute(&pool)
        .await
        .unwrap();

    // INV-7: duplicate dm_pair_key must fail unique constraint.
    let dup_dm = sqlx::query("INSERT INTO channels (id, type, dm_pair_key) VALUES ($1, 'dm', $2)")
        .bind(Uuid::now_v7())
        .bind(&pair_key)
        .execute(&pool)
        .await;
    assert!(dup_dm.is_err(), "duplicate dm_pair_key must be rejected");

    // INV-6: reply inserted before parent in the same transaction succeeds via DEFERRABLE FK.
    let parent_id = Uuid::now_v7();
    let reply_id = Uuid::now_v7();
    let mut tx = pool.begin().await.unwrap();

    sqlx::query(
        "INSERT INTO messages (id, channel_id, sender_id, seq_id, client_msg_id, content, reply_to_id)
         VALUES ($1, $2, $3, 2, $4, 'reply first', $5)",
    )
    .bind(reply_id)
    .bind(channel_id)
    .bind(user_a)
    .bind(Uuid::new_v4())
    .bind(parent_id)
    .execute(&mut *tx)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO messages (id, channel_id, sender_id, seq_id, client_msg_id, content)
         VALUES ($1, $2, $3, 1, $4, 'parent second')",
    )
    .bind(parent_id)
    .bind(channel_id)
    .bind(user_b)
    .bind(Uuid::new_v4())
    .execute(&mut *tx)
    .await
    .unwrap();

    tx.commit()
        .await
        .expect("DEFERRABLE FK must allow out-of-order batch insert");

    // INV-5: deleting user_a sets messages.sender_id to NULL without deleting message history.
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_a)
        .execute(&pool)
        .await
        .unwrap();

    let sender_after: Option<Uuid> =
        sqlx::query_scalar("SELECT sender_id FROM messages WHERE id = $1")
            .bind(reply_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(sender_after.is_none());

    // Cleanup test rows.
    sqlx::query("DELETE FROM channels WHERE id = $1")
        .bind(channel_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_b)
        .execute(&pool)
        .await
        .unwrap();
}
