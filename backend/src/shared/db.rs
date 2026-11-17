//! PostgreSQL migration runner embedding `migrations/` at compile time.

use sqlx::{PgPool, migrate::MigrateError};

/// Runs pending SQLx migrations embedded from `backend/migrations/`.
/// Idempotent: already-applied migrations are skipped safely.
pub async fn run_migrations(pool: &PgPool) -> Result<(), MigrateError> {
    sqlx::migrate!("./migrations").run(pool).await
}
