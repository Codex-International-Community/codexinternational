use anyhow::{Context, Result};
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaReadyCallback {
    pub media_id: String,
    pub status: String,
    pub r2_key: Option<String>,
    pub r2_thumb_key: Option<String>,
    pub error_reason: Option<String>,
    pub client_bypass: bool,
    pub size_bytes: usize,
    pub width: u32,
    pub height: u32,
    pub mime_type: String,
}

/// Computes `HMAC-SHA256` hex signature over `{timestamp}.{body}` for
/// `/internal/v1/media/ready` webhook verification (`INV-8`).
pub fn sign_hmac_sha256(secret: &str, timestamp: i64, body: &[u8]) -> Result<String> {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).context("invalid HMAC secret key")?;
    mac.update(timestamp.to_string().as_bytes());
    mac.update(b".");
    mac.update(body);
    Ok(hex::encode(mac.finalize().into_bytes()))
}

pub async fn send_callback(
    client: &reqwest::Client,
    url: &str,
    secret: &str,
    payload: &MediaReadyCallback,
) -> Result<()> {
    let body = serde_json::to_vec(payload)?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let sig = sign_hmac_sha256(secret, ts, &body)?;

    let resp = client
        .post(url)
        .header("content-type", "application/json")
        .header("x-timestamp", ts.to_string())
        .header("x-signature-256", format!("sha256={sig}"))
        .body(body)
        .send()
        .await
        .context("failed to send media ready webhook")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("webhook returned {status}: {text}");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hmac_signature_is_deterministic() {
        let sig1 = sign_hmac_sha256("my-secret", 1700000000, br#"{"ok":true}"#).unwrap();
        let sig2 = sign_hmac_sha256("my-secret", 1700000000, br#"{"ok":true}"#).unwrap();
        let sig3 = sign_hmac_sha256("other-secret", 1700000000, br#"{"ok":true}"#).unwrap();

        assert_eq!(sig1.len(), 64);
        assert_eq!(sig1, sig2);
        assert_ne!(sig1, sig3);
    }
}
