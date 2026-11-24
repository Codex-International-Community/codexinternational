//! PostgreSQL repository queries for user registration, login, and profile lookup.

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::error::AppError;

/// Public user projection returned by `/auth/*` endpoints (never includes `password_hash`).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct UserProfile {
    pub id: Uuid,
    pub uid: String,
    pub uid_login_enabled: bool,
    pub has_password: bool,
    pub username: String,
    pub display_name: String,
    pub email: String,
    pub email_verified_at: Option<DateTime<Utc>>,
    pub bio: String,
    pub platform_role: String,
    pub platform_badge: Option<String>,
    pub is_verified: bool,
    pub can_bypass_compress: bool,
    pub global_xp: i64,
    pub global_level: i32,
    pub created_at: DateTime<Utc>,
}

/// Internal DB record used during credential verification and suspension checks.
#[derive(Debug, Clone, FromRow)]
pub struct UserAuthRecord {
    pub id: Uuid,
    pub uid: String,
    pub uid_login_enabled: bool,
    pub username: String,
    pub display_name: String,
    pub email: String,
    pub email_verified_at: Option<DateTime<Utc>>,
    pub password_hash: Option<String>,
    pub bio: String,
    pub platform_role: String,
    pub platform_badge: Option<String>,
    pub is_verified: bool,
    pub can_bypass_compress: bool,
    pub suspended_until: Option<DateTime<Utc>>,
    pub suspended_reason: Option<String>,
    pub banned_at: Option<DateTime<Utc>>,
    pub banned_reason: Option<String>,
    pub global_xp: i64,
    pub global_level: i32,
    pub created_at: DateTime<Utc>,
}

impl From<UserAuthRecord> for UserProfile {
    fn from(r: UserAuthRecord) -> Self {
        Self {
            id: r.id,
            uid: r.uid,
            uid_login_enabled: r.uid_login_enabled,
            has_password: r.password_hash.is_some(),
            username: r.username,
            display_name: r.display_name,
            email: r.email,
            email_verified_at: r.email_verified_at,
            bio: r.bio,
            platform_role: r.platform_role,
            platform_badge: r.platform_badge,
            is_verified: r.is_verified,
            can_bypass_compress: r.can_bypass_compress,
            global_xp: r.global_xp,
            global_level: r.global_level,
            created_at: r.created_at,
        }
    }
}

pub struct NewUserParams<'a> {
    pub user_id: Uuid,
    pub username: &'a str,
    pub display_name: &'a str,
    pub email: &'a str,
    pub password_hash: &'a str,
    pub device_id: Uuid,
    pub device_name: Option<&'a str>,
    pub platform: &'a str,
    pub refresh_token_hash: &'a str,
    pub refresh_expires_at: DateTime<Utc>,
}

/// Atomically creates a human user account and its initial `user_devices` session.
pub async fn create_user_with_device(
    pool: &PgPool,
    p: NewUserParams<'_>,
) -> Result<UserProfile, AppError> {
    let mut tx = pool.begin().await?;

    let profile = sqlx::query_as::<_, UserProfile>(
        "INSERT INTO users (id, username, display_name, email, password_hash)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, uid, uid_login_enabled, (password_hash IS NOT NULL) AS has_password,
                   username, display_name, email, email_verified_at, bio,
                   platform_role, platform_badge, is_verified, can_bypass_compress, global_xp, global_level, created_at",
    )
    .bind(p.user_id)
    .bind(p.username)
    .bind(p.display_name)
    .bind(p.email)
    .bind(p.password_hash)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO user_devices (id, user_id, device_name, platform, refresh_token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(p.device_id)
    .bind(p.user_id)
    .bind(p.device_name)
    .bind(p.platform)
    .bind(p.refresh_token_hash)
    .bind(p.refresh_expires_at)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(profile)
}

/// Looks up a user by email, username (case-insensitive), or opt-in UID for password login.
pub async fn find_user_by_identifier(
    pool: &PgPool,
    identifier: &str,
) -> Result<Option<UserAuthRecord>, AppError> {
    let rec = sqlx::query_as::<_, UserAuthRecord>(
        "SELECT id, uid, uid_login_enabled, username, display_name, email, email_verified_at,
                password_hash, bio, platform_role, platform_badge, is_verified, can_bypass_compress,
                suspended_until, suspended_reason, banned_at, banned_reason, global_xp, global_level, created_at
         FROM users
         WHERE LOWER(email) = LOWER($1)
            OR LOWER(username) = LOWER($1)
            OR (uid = $1 AND uid_login_enabled = TRUE)
         LIMIT 1",
    )
    .bind(identifier)
    .fetch_optional(pool)
    .await?;

    Ok(rec)
}

/// Records a new device session upon login and updates `last_seen_at`.
pub async fn create_device_session(
    pool: &PgPool,
    device_id: Uuid,
    user_id: Uuid,
    device_name: Option<&str>,
    platform: &str,
    refresh_token_hash: &str,
    expires_at: DateTime<Utc>,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;

    sqlx::query(
        "INSERT INTO user_devices (id, user_id, device_name, platform, refresh_token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(device_id)
    .bind(user_id)
    .bind(device_name)
    .bind(platform)
    .bind(refresh_token_hash)
    .bind(expires_at)
    .execute(&mut *tx)
    .await?;

    sqlx::query("UPDATE users SET last_seen_at = NOW(), updated_at = NOW() WHERE id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(())
}

/// Fetches a user record by primary key for `/auth/me` and suspension enforcement.
pub async fn find_user_by_id(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Option<UserAuthRecord>, AppError> {
    let rec = sqlx::query_as::<_, UserAuthRecord>(
        "SELECT id, uid, uid_login_enabled, username, display_name, email, email_verified_at,
                password_hash, bio, platform_role, platform_badge, is_verified, can_bypass_compress,
                suspended_until, suspended_reason, banned_at, banned_reason, global_xp, global_level, created_at
         FROM users
         WHERE id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(rec)
}
