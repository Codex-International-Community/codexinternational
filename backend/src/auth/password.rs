//! Bounded `Argon2id` password hasher and verifier (`Task 1.2`).
//!
//! Because Argon2id intentionally consumes substantial CPU (~20-50 ms) and RAM
//! (~19 MiB default), concurrent hashing is bounded by a `tokio::sync::Semaphore`
//! on `tokio::task::spawn_blocking`. Under login floods, excess requests wait up
//! to `acquire_timeout` and then fast-fail with `503 Service Unavailable` +
//! `Retry-After` so chat WebSockets never suffer CPU starvation or OOM.

use std::{sync::Arc, time::Duration};

use argon2::{
    Argon2,
    password_hash::{PasswordHasher as _, PasswordVerifier as _, phc::PasswordHash},
};
use tokio::sync::Semaphore;

use crate::error::AppError;

#[derive(Clone)]
pub struct PasswordHasher {
    semaphore: Arc<Semaphore>,
    acquire_timeout: Duration,
}

impl Default for PasswordHasher {
    fn default() -> Self {
        let slots = std::thread::available_parallelism().map_or(4, |n| n.get().clamp(4, 8));
        Self::new(slots, Duration::from_secs(2))
    }
}

impl PasswordHasher {
    /// Creates a bounded `PasswordHasher` with explicit concurrency slots and queue timeout.
    pub fn new(max_concurrent: usize, acquire_timeout: Duration) -> Self {
        Self {
            semaphore: Arc::new(Semaphore::new(max_concurrent.max(1))),
            acquire_timeout,
        }
    }

    /// Hashes a plaintext password into a PHC string (`$argon2id$...`) on a blocking thread.
    pub async fn hash_password(&self, password: String) -> Result<String, AppError> {
        let _permit = self.acquire_permit().await?;

        tokio::task::spawn_blocking(move || {
            Argon2::default()
                .hash_password(password.as_bytes())
                .map(|h| h.to_string())
                .map_err(|e| AppError::Internal(anyhow::anyhow!("argon2 hash failed: {e}")))
        })
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("hash task join failed: {e}")))?
    }

    /// Verifies a plaintext password against a stored PHC string on a blocking thread.
    pub async fn verify_password(
        &self,
        password: String,
        phc_hash: String,
    ) -> Result<bool, AppError> {
        let _permit = self.acquire_permit().await?;

        tokio::task::spawn_blocking(move || {
            let Ok(parsed) = PasswordHash::new(&phc_hash) else {
                return Ok(false);
            };
            Ok(Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok())
        })
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("verify task join failed: {e}")))?
    }

    async fn acquire_permit(&self) -> Result<tokio::sync::OwnedSemaphorePermit, AppError> {
        tokio::time::timeout(self.acquire_timeout, self.semaphore.clone().acquire_owned())
            .await
            .map_err(|_| AppError::ServiceUnavailable {
                retry_after_secs: self.acquire_timeout.as_secs().max(1),
                message: "authentication service busy, please retry".to_string(),
            })?
            .map_err(|e| AppError::Internal(anyhow::anyhow!("semaphore closed: {e}")))
    }
}
