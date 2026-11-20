//! Authenticated chat media uploads backed by Cloudflare R2.
use std::sync::Arc;

use axum::{
    Json,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode, header::CONTENT_TYPE},
};
use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{auth::extractor::AuthUser, config::AppConfig, error::AppError, state::AppState};

type HmacSha256 = Hmac<Sha256>;
pub const MAX_CHAT_UPLOAD_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAttachment {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub url: String,
}

#[derive(Debug, Serialize)]
pub struct MediaUploadResponse {
    pub attachment: ChatAttachment,
}

fn unavailable() -> AppError {
    AppError::ServiceUnavailable {
        retry_after_secs: 60,
        message: "Cloudflare R2 media storage is not configured".to_string(),
    }
}

fn sha256_hex(value: &[u8]) -> String {
    hex::encode(Sha256::digest(value))
}

fn hmac_bytes(key: &[u8], value: &str) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts keys of any length");
    mac.update(value.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

fn aws_encode(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

/// Creates a short-lived S3-compatible URL signed for Cloudflare R2.
pub fn presigned_r2_url(
    config: &AppConfig,
    method: &str,
    key: &str,
    expires_secs: u32,
) -> Result<String, AppError> {
    if config.r2_account_id.trim().is_empty()
        || config.r2_access_key_id.is_empty()
        || config.r2_secret_access_key.is_empty()
        || config.r2_bucket_name.trim().is_empty()
    {
        return Err(unavailable());
    }

    let host = format!("{}.r2.cloudflarestorage.com", config.r2_account_id.trim());
    let now = Utc::now();
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date_stamp = now.format("%Y%m%d").to_string();
    let credential_scope = format!("{date_stamp}/auto/s3/aws4_request");
    let credential = format!("{}/{credential_scope}", config.r2_access_key_id.expose());
    let canonical_uri = format!("/{}/{}", config.r2_bucket_name.trim(), key);
    let canonical_query = format!(
        "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={}&X-Amz-Date={}&X-Amz-Expires={}&X-Amz-SignedHeaders=host",
        aws_encode(&credential),
        amz_date,
        expires_secs
    );
    let canonical_request = format!(
        "{method}\n{canonical_uri}\n{canonical_query}\nhost:{host}\n\nhost\nUNSIGNED-PAYLOAD"
    );
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{credential_scope}\n{}",
        sha256_hex(canonical_request.as_bytes())
    );

    let secret = format!("AWS4{}", config.r2_secret_access_key.expose());
    let date_key = hmac_bytes(secret.as_bytes(), &date_stamp);
    let region_key = hmac_bytes(&date_key, "auto");
    let service_key = hmac_bytes(&region_key, "s3");
    let signing_key = hmac_bytes(&service_key, "aws4_request");
    let signature = hex::encode(hmac_bytes(&signing_key, &string_to_sign));

    Ok(format!(
        "https://{host}{canonical_uri}?{canonical_query}&X-Amz-Signature={signature}"
    ))
}

fn safe_file_name(raw: Option<&str>, fallback_extension: &str) -> String {
    let raw = raw.unwrap_or("attachment").trim();
    let base = raw
        .rsplit(|ch| ch == '/' || ch == '\\')
        .next()
        .unwrap_or("attachment");
    let cleaned = base
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .take(120)
        .collect::<String>();
    let cleaned = cleaned.trim_matches(|ch| matches!(ch, '.' | '_' | '-'));
    let stem = cleaned
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(cleaned);
    let stem = stem.trim_matches(|ch| matches!(ch, '.' | '_' | '-'));
    if stem.is_empty() {
        format!("attachment.{fallback_extension}")
    } else {
        format!("{stem}.{fallback_extension}")
    }
}

fn allowed_media_type(mime: &str) -> Option<(&'static str, &'static str)> {
    match mime {
        "image/jpeg" => Some(("image", "jpg")),
        "image/png" => Some(("image", "png")),
        "image/gif" => Some(("image", "gif")),
        "image/webp" => Some(("image", "webp")),
        "application/pdf" => Some(("file", "pdf")),
        "text/plain" => Some(("file", "txt")),
        "text/csv" => Some(("file", "csv")),
        "application/zip" => Some(("file", "zip")),
        "application/msword" => Some(("file", "doc")),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => {
            Some(("file", "docx"))
        }
        "application/vnd.ms-excel" => Some(("file", "xls")),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => {
            Some(("file", "xlsx"))
        }
        "application/vnd.ms-powerpoint" => Some(("file", "ppt")),
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => {
            Some(("file", "pptx"))
        }
        _ => None,
    }
}

pub fn attachment_from_record(
    config: &AppConfig,
    id: Uuid,
    name: String,
    mime_type: String,
    size_bytes: i64,
    r2_key: String,
) -> Result<ChatAttachment, AppError> {
    let url = presigned_r2_url(config, "GET", &r2_key, 86_400)?;
    Ok(ChatAttachment {
        id: id.to_string(),
        name,
        mime_type,
        size_bytes,
        url,
    })
}

pub async fn attachment_for(
    state: &AppState,
    media_id: Uuid,
) -> Result<Option<ChatAttachment>, AppError> {
    let row = sqlx::query_as::<_, (String, String, i64, String)>(
        "SELECT file_name, mime_type, COALESCE(size_bytes, 0), r2_key
         FROM media_assets
         WHERE id = $1 AND purpose = 'chat' AND status = 'READY'",
    )
    .bind(media_id)
    .fetch_optional(&state.pg)
    .await?;

    row.map(|(name, mime_type, size_bytes, r2_key)| {
        attachment_from_record(&state.config, media_id, name, mime_type, size_bytes, r2_key)
    })
    .transpose()
}

pub async fn upload(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<MediaUploadResponse>), AppError> {
    if body.is_empty() {
        return Err(AppError::BadRequest("uploaded file is empty".to_string()));
    }
    if body.len() > MAX_CHAT_UPLOAD_BYTES {
        return Err(AppError::PayloadTooLarge(
            "chat uploads are limited to 10 MB".to_string(),
        ));
    }

    let channel_id = headers
        .get("x-channel-id")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| {
            AppError::BadRequest("channel id is required for chat uploads".to_string())
        })?;
    crate::chat::repo::channel_access(
        &state,
        channel_id,
        auth.user_id,
        crate::communities::permissions::PERM_SEND_MESSAGES,
        true,
    )
    .await?;

    let mime_type = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let (kind, extension) = allowed_media_type(&mime_type)
        .ok_or_else(|| AppError::BadRequest("file type is not supported. Use JPG, PNG, GIF, WEBP, PDF, TXT, CSV, ZIP, DOC/DOCX, XLS/XLSX or PPT/PPTX".to_string()))?;
    let signature_ok = match mime_type.as_str() {
        "image/jpeg" => body.starts_with(&[0xFF, 0xD8, 0xFF]),
        "image/png" => body.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/gif" => body.starts_with(b"GIF87a") || body.starts_with(b"GIF89a"),
        "image/webp" => body.get(8..12) == Some(&b"WEBP"[..]) && body.starts_with(b"RIFF"),
        "application/pdf" => body.starts_with(b"%PDF-"),
        "application/zip"
        | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        | "application/vnd.openxmlformats-officedocument.presentationml.presentation" => {
            body.starts_with(b"PK\x03\x04")
        }
        "application/msword" | "application/vnd.ms-excel" | "application/vnd.ms-powerpoint" => {
            body.starts_with(&[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])
        }
        "text/plain" | "text/csv" => !body.contains(&0),
        _ => false,
    };
    if !signature_ok {
        return Err(AppError::BadRequest(
            "file contents do not match the selected file type".to_string(),
        ));
    }

    let raw_name = headers
        .get("x-file-name")
        .and_then(|value| value.to_str().ok());
    let file_name = safe_file_name(raw_name, extension);
    let media_id = Uuid::now_v7();
    let object_key = format!("chat/{}/{}.{}", auth.user_id, media_id, extension);
    let upload_url = presigned_r2_url(&state.config, "PUT", &object_key, 900)?;

    let response = reqwest::Client::new()
        .put(upload_url)
        .header(CONTENT_TYPE, mime_type.as_str())
        .body(body.clone())
        .send()
        .await
        .map_err(|error| AppError::Internal(error.into()))?;
    if !response.status().is_success() {
        tracing::error!(status = %response.status(), "Cloudflare R2 upload failed");
        return Err(AppError::ServiceUnavailable {
            retry_after_secs: 30,
            message: "File could not be saved to media storage".to_string(),
        });
    }

    let size_bytes = i64::try_from(body.len()).map_err(|error| AppError::Internal(error.into()))?;
    sqlx::query(
        "INSERT INTO media_assets
         (id, uploader_id, kind, purpose, status, r2_key, mime_type, size_bytes, ready_at, file_name)
         VALUES ($1, $2, $3, 'chat', 'READY', $4, $5, $6, NOW(), $7)",
    )
    .bind(media_id)
    .bind(auth.user_id)
    .bind(kind)
    .bind(&object_key)
    .bind(&mime_type)
    .bind(size_bytes)
    .bind(&file_name)
    .execute(&state.pg)
    .await?;

    let attachment = attachment_from_record(
        &state.config,
        media_id,
        file_name,
        mime_type,
        size_bytes,
        object_key,
    )?;

    Ok((
        StatusCode::CREATED,
        Json(MediaUploadResponse { attachment }),
    ))
}
