//! Authenticated chat media uploads backed by Cloudflare R2.
use std::{
    io::{Cursor, Read},
    sync::Arc,
};

use axum::{
    Json,
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header::CONTENT_TYPE},
};
use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use uuid::Uuid;

use crate::{auth::extractor::AuthUser, config::AppConfig, error::AppError, state::AppState};

type HmacSha256 = Hmac<Sha256>;
pub const MAX_CHAT_UPLOAD_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_VIDEO_DURATION_STANDARD_SECS: u32 = 180; // 3 minutes
pub const MAX_VIDEO_DURATION_PRO_SECS: u32 = 300; // 5 minutes
const ZIP_MAX_TOTAL_BYTES: u64 = 250 * 1024 * 1024;
const ZIP_MAX_ENTRIES: usize = 1_000;
const ZIP_MAX_RATIO_GENERAL: f64 = 25.0;
const ZIP_MAX_RATIO_OFFICE: f64 = 100.0;
const ZIP_SMALL_RATIO_BYPASS_BYTES: u64 = 10 * 1024 * 1024;
const ZIP_MAX_NESTED_DEPTH: usize = 1;
const WEBHOOK_MAX_AGE_SECS: i64 = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QualityTier {
    Standard,
    Pro,
}

impl QualityTier {
    pub fn parse(raw: Option<&str>) -> Result<Self, AppError> {
        match raw
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            None | Some("standard") => Ok(Self::Standard),
            Some("pro") => Ok(Self::Pro),
            Some(other) => Err(AppError::BadRequest(format!(
                "unsupported quality_tier '{other}'; expected 'standard' or 'pro'"
            ))),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::Pro => "pro",
        }
    }

    pub fn max_video_duration_secs(self) -> u32 {
        match self {
            Self::Standard => MAX_VIDEO_DURATION_STANDARD_SECS,
            Self::Pro => MAX_VIDEO_DURATION_PRO_SECS,
        }
    }

    pub fn max_video_bytes(self) -> i64 {
        match self {
            Self::Standard => 50 * 1024 * 1024,
            Self::Pro => 200 * 1024 * 1024,
        }
    }

    pub fn max_image_bytes(self) -> i64 {
        match self {
            Self::Standard => 5 * 1024 * 1024,
            Self::Pro => 10 * 1024 * 1024,
        }
    }

    pub fn max_bytes_for_kind(self, kind: &str) -> i64 {
        match kind {
            "image" => self.max_image_bytes(),
            "video" => self.max_video_bytes(),
            _ => 10 * 1024 * 1024,
        }
    }
}

/// Streaming decompression-bomb guard for `.zip` and OpenXML Office archives.
pub struct ZipBombGuard;

impl ZipBombGuard {
    pub fn inspect_zip_bytes(data: &[u8], is_office: bool) -> Result<(), AppError> {
        Self::inspect_recursive(data, is_office, 0)
    }

    fn inspect_recursive(data: &[u8], is_office: bool, depth: usize) -> Result<(), AppError> {
        if depth > ZIP_MAX_NESTED_DEPTH {
            return Err(AppError::BadRequest(
                "SECURITY_REJECTED: decompression bomb detected".to_string(),
            ));
        }

        let mut archive = zip::ZipArchive::new(Cursor::new(data)).map_err(|_| {
            AppError::BadRequest("SECURITY_REJECTED: invalid or corrupted zip archive".to_string())
        })?;

        if archive.len() > ZIP_MAX_ENTRIES {
            return Err(AppError::BadRequest(
                "SECURITY_REJECTED: decompression bomb detected".to_string(),
            ));
        }

        let mut total_actual: u64 = 0;
        let compressed_total = (data.len() as u64).max(1);
        let max_ratio = if is_office {
            ZIP_MAX_RATIO_OFFICE
        } else {
            ZIP_MAX_RATIO_GENERAL
        };
        let mut buf = [0u8; 8192];

        for idx in 0..archive.len() {
            let mut entry = archive.by_index(idx).map_err(|_| {
                AppError::BadRequest("SECURITY_REJECTED: decompression bomb detected".to_string())
            })?;

            if entry.is_dir() {
                continue;
            }

            let entry_name = entry.name().to_ascii_lowercase();
            let is_nested_archive = entry_name.ends_with(".zip")
                || entry_name.ends_with(".gz")
                || entry_name.ends_with(".tar")
                || entry_name.ends_with(".7z")
                || entry_name.ends_with(".rar");

            let remaining_budget = ZIP_MAX_TOTAL_BYTES.saturating_sub(total_actual);
            let mut limited = (&mut entry).take(remaining_budget + 1);
            let mut entry_bytes: Vec<u8> = if is_nested_archive {
                Vec::new()
            } else {
                Vec::new()
            };

            loop {
                let n = limited.read(&mut buf).map_err(|_| {
                    AppError::BadRequest(
                        "SECURITY_REJECTED: decompression bomb detected".to_string(),
                    )
                })?;
                if n == 0 {
                    break;
                }
                total_actual = total_actual.saturating_add(n as u64);
                if total_actual > ZIP_MAX_TOTAL_BYTES {
                    return Err(AppError::BadRequest(
                        "SECURITY_REJECTED: decompression bomb detected".to_string(),
                    ));
                }
                if is_nested_archive {
                    entry_bytes.extend_from_slice(&buf[..n]);
                }
            }

            if is_nested_archive {
                if depth + 1 > ZIP_MAX_NESTED_DEPTH {
                    return Err(AppError::BadRequest(
                        "SECURITY_REJECTED: decompression bomb detected".to_string(),
                    ));
                }
                if entry_name.ends_with(".zip") {
                    Self::inspect_recursive(&entry_bytes, false, depth + 1)?;
                } else {
                    return Err(AppError::BadRequest(
                        "SECURITY_REJECTED: decompression bomb detected".to_string(),
                    ));
                }
            }
        }

        if total_actual >= ZIP_SMALL_RATIO_BYPASS_BYTES {
            let ratio = (total_actual as f64) / (compressed_total as f64);
            if ratio > max_ratio {
                return Err(AppError::BadRequest(
                    "SECURITY_REJECTED: decompression bomb detected".to_string(),
                ));
            }
        }

        Ok(())
    }
}
static HTTP_CLIENT: std::sync::LazyLock<reqwest::Client> =
    std::sync::LazyLock::new(reqwest::Client::new);

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
    let base = raw.rsplit(['/', '\\']).next().unwrap_or("attachment");
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
        "image/avif" => Some(("image", "avif")),
        "image/jpeg" => Some(("image", "jpg")),
        "image/png" => Some(("image", "png")),
        "image/gif" => Some(("image", "gif")),
        "image/webp" => Some(("image", "webp")),
        "video/mp4" => Some(("video", "mp4")),
        "video/webm" => Some(("video", "webm")),
        "video/quicktime" => Some(("video", "mov")),
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

pub fn generate_r2_key(
    purpose: &str,
    user_id: Uuid,
    media_id: Uuid,
    kind: &str,
    extension: &str,
) -> String {
    let now = Utc::now();
    let yyyy = now.format("%Y");
    let mm = now.format("%m");
    match purpose {
        "avatar" => format!("compressed/avatars/{user_id}/{media_id}.{extension}"),
        "community_icon" => format!("compressed/icons/{user_id}/{media_id}.{extension}"),
        "chat" | "story" | "contribution" => {
            if kind == "video" {
                format!("raw/videos/{yyyy}/{mm}/{media_id}.{extension}")
            } else if kind == "image" {
                format!("compressed/images/{yyyy}/{mm}/{media_id}.{extension}")
            } else {
                format!("attachments/{user_id}/{yyyy}/{mm}/{media_id}.{extension}")
            }
        }
        _ => format!("attachments/{user_id}/{yyyy}/{mm}/{media_id}.{extension}"),
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
    let url = if !config.r2_public_base_url.trim().is_empty() {
        format!(
            "{}/{}",
            config.r2_public_base_url.trim_end_matches('/'),
            r2_key.trim_start_matches('/')
        )
    } else {
        presigned_r2_url(config, "GET", &r2_key, 3_600)?
    };
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
         WHERE id = $1 AND purpose = 'chat' AND status IN ('READY', 'PROCESSING')",
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
        .ok_or_else(|| AppError::BadRequest("file type is not supported. Use AVIF, JPG, PNG, GIF, WEBP, MP4, WEBM, MOV, PDF, TXT, CSV, ZIP, DOC/DOCX, XLS/XLSX or PPT/PPTX".to_string()))?;
    let signature_ok = match mime_type.as_str() {
        "image/avif" | "video/mp4" | "video/quicktime" => {
            body.len() >= 12 && &body[4..8] == b"ftyp"
        }
        "video/webm" => body.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]),
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

    if mime_type == "application/zip"
        || mime_type.starts_with("application/vnd.openxmlformats-officedocument.")
    {
        let is_office = mime_type != "application/zip";
        ZipBombGuard::inspect_zip_bytes(&body, is_office)?;
    }

    let size_bytes = i64::try_from(body.len()).map_err(|error| AppError::Internal(error.into()))?;
    let raw_name = headers
        .get("x-file-name")
        .and_then(|value| value.to_str().ok());
    let file_name = safe_file_name(raw_name, extension);
    let media_id = Uuid::now_v7();
    let object_key = generate_r2_key("chat", auth.user_id, media_id, kind, extension);
    let upload_url = presigned_r2_url(&state.config, "PUT", &object_key, 900)?;

    let response = HTTP_CLIENT
        .put(upload_url)
        .header(CONTENT_TYPE, mime_type.as_str())
        .body(body)
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresignMediaRequest {
    #[serde(default = "default_chat_purpose")]
    pub purpose: String,
    pub channel_id: Option<Uuid>,
    pub file_name: String,
    pub mime_type: String,
    pub size_bytes: i64,
    #[serde(default)]
    pub quality_tier: Option<String>,
    #[serde(default)]
    pub duration_secs: Option<u32>,
}

fn default_chat_purpose() -> String {
    "chat".to_string()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresignMediaResponse {
    pub media_id: Uuid,
    pub upload_url: String,
    pub method: &'static str,
    pub object_key: String,
    pub max_bytes: i64,
    pub quality_tier: String,
    pub max_video_duration_secs: Option<u32>,
}

pub fn validate_video_duration_for_tier(
    tier: QualityTier,
    duration_secs: Option<u32>,
) -> Result<(), AppError> {
    if let Some(secs) = duration_secs {
        let max_secs = tier.max_video_duration_secs();
        if secs == 0 || secs > max_secs {
            return Err(AppError::BadRequest(format!(
                "video duration exceeds {} tier limit of {} seconds ({} minutes)",
                tier.as_str(),
                max_secs,
                max_secs / 60
            )));
        }
    }
    Ok(())
}

pub async fn presign(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(req): Json<PresignMediaRequest>,
) -> Result<Json<PresignMediaResponse>, AppError> {
    if req.purpose == "chat" {
        let channel_id = req.channel_id.ok_or_else(|| {
            AppError::BadRequest("channel_id is required for chat uploads".to_string())
        })?;
        crate::chat::repo::channel_access(
            &state,
            channel_id,
            auth.user_id,
            crate::communities::permissions::PERM_SEND_MESSAGES,
            true,
        )
        .await?;
    }

    let mime_type = req
        .mime_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();

    let (kind, extension) = allowed_media_type(&mime_type).ok_or_else(|| {
        AppError::BadRequest(
            "file type is not supported. Use AVIF, JPG, PNG, GIF, WEBP, MP4, WEBM, MOV, PDF, TXT, CSV, ZIP, DOC/DOCX, XLS/XLSX or PPT/PPTX".to_string(),
        )
    })?;

    let requested_tier = QualityTier::parse(req.quality_tier.as_deref())?;
    if requested_tier == QualityTier::Pro {
        let has_pro = sqlx::query_scalar::<_, bool>(
            "SELECT (quality_tier = 'pro' OR can_bypass_compress) FROM users WHERE id = $1",
        )
        .bind(auth.user_id)
        .fetch_optional(&state.pg)
        .await?
        .unwrap_or(false);

        if !has_pro {
            return Err(AppError::Forbidden(
                "pro quality_tier requires paid tier entitlement".to_string(),
            ));
        }
    }

    if kind == "video" {
        validate_video_duration_for_tier(requested_tier, req.duration_secs)?;
    }

    let max_bytes = requested_tier.max_bytes_for_kind(kind);

    if req.size_bytes <= 0 || req.size_bytes > max_bytes {
        return Err(AppError::PayloadTooLarge(format!(
            "file exceeds maximum allowed size of {} MB for {} tier",
            max_bytes / (1024 * 1024),
            requested_tier.as_str()
        )));
    }

    let media_id = Uuid::now_v7();
    let file_name = safe_file_name(Some(&req.file_name), extension);
    let object_key = generate_r2_key(&req.purpose, auth.user_id, media_id, kind, extension);
    let upload_url = presigned_r2_url(&state.config, "PUT", &object_key, 900)?;

    let duration_i32 = req.duration_secs.map(|d| d as i32);

    sqlx::query(
        "INSERT INTO media_assets
         (id, uploader_id, kind, purpose, status, quality_tier, r2_key, mime_type, size_bytes, duration_secs, file_name, created_at)
         VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, $7, $8, $9, $10, NOW())",
    )
    .bind(media_id)
    .bind(auth.user_id)
    .bind(kind)
    .bind(&req.purpose)
    .bind(requested_tier.as_str())
    .bind(&object_key)
    .bind(&mime_type)
    .bind(req.size_bytes)
    .bind(duration_i32)
    .bind(&file_name)
    .execute(&state.pg)
    .await?;

    Ok(Json(PresignMediaResponse {
        media_id,
        upload_url,
        method: "PUT",
        object_key,
        max_bytes,
        quality_tier: requested_tier.as_str().to_string(),
        max_video_duration_secs: (kind == "video")
            .then(|| requested_tier.max_video_duration_secs()),
    }))
}

pub async fn complete(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(media_id): Path<Uuid>,
) -> Result<Json<MediaUploadResponse>, AppError> {
    let row = sqlx::query_as::<_, (String, String, String, String, Option<i64>, String, String)>(
        "SELECT status, r2_key, file_name, mime_type, size_bytes, kind, quality_tier
         FROM media_assets
         WHERE id = $1 AND uploader_id = $2",
    )
    .bind(media_id)
    .bind(auth.user_id)
    .fetch_optional(&state.pg)
    .await?
    .ok_or_else(|| AppError::NotFound("media asset not found".to_string()))?;

    let (status, r2_key, file_name, mime_type, size_bytes, kind, quality_tier_str) = row;
    let tier = QualityTier::parse(Some(&quality_tier_str)).unwrap_or(QualityTier::Standard);

    if status == "READY" || status == "PROCESSING" {
        let attachment = attachment_from_record(
            &state.config,
            media_id,
            file_name,
            mime_type,
            size_bytes.unwrap_or(0),
            r2_key,
        )?;
        return Ok(Json(MediaUploadResponse { attachment }));
    }

    // Verify presence in Cloudflare R2 via HEAD request
    let head_url = presigned_r2_url(&state.config, "HEAD", &r2_key, 60)?;
    let head_res = HTTP_CLIENT
        .head(head_url)
        .send()
        .await
        .map_err(|e| AppError::Internal(e.into()))?;

    if !head_res.status().is_success() {
        return Err(AppError::BadRequest(
            "uploaded file not found in storage yet. Complete upload before confirming."
                .to_string(),
        ));
    }

    let actual_size = head_res
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(size_bytes.unwrap_or(0));

    let max_bytes = tier.max_bytes_for_kind(&kind);

    if actual_size > max_bytes {
        return Err(AppError::PayloadTooLarge(
            "uploaded file exceeds size limit".to_string(),
        ));
    }

    let next_status = if kind == "video" && !state.config.aws_lambda_video_fn.trim().is_empty() {
        "PROCESSING"
    } else {
        "READY"
    };

    if next_status == "PROCESSING" {
        sqlx::query(
            "UPDATE media_assets
             SET status = 'PROCESSING', size_bytes = $2, r2_raw_key = r2_key
             WHERE id = $1",
        )
        .bind(media_id)
        .bind(actual_size)
        .execute(&state.pg)
        .await?;
    } else {
        sqlx::query(
            "UPDATE media_assets
             SET status = 'READY', size_bytes = $2, ready_at = NOW()
             WHERE id = $1",
        )
        .bind(media_id)
        .bind(actual_size)
        .execute(&state.pg)
        .await?;
    }

    let attachment = attachment_from_record(
        &state.config,
        media_id,
        file_name,
        mime_type,
        actual_size,
        r2_key,
    )?;

    Ok(Json(MediaUploadResponse { attachment }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InternalMediaReadyPayload {
    pub media_id: Uuid,
    pub status: String,
    pub r2_key: Option<String>,
    pub r2_thumb_key: Option<String>,
    pub error_reason: Option<String>,
}

/// Verifies `X-Timestamp` (anti-replay <= 5 minutes) and `X-Signature-256` (`sha256=<hex>`
/// over `"{timestamp}.{body}"`) in constant time (`INV-8`).
pub fn verify_webhook_signature(
    secret: &str,
    timestamp_header: Option<&str>,
    signature_header: Option<&str>,
    raw_body: &[u8],
    now_unix: i64,
) -> Result<(), AppError> {
    let ts_str = timestamp_header
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Unauthorized("missing X-Timestamp header".to_string()))?;
    let ts: i64 = ts_str
        .parse()
        .map_err(|_| AppError::Unauthorized("invalid X-Timestamp header".to_string()))?;
    if (now_unix - ts).abs() > WEBHOOK_MAX_AGE_SECS {
        return Err(AppError::Unauthorized(
            "webhook timestamp expired".to_string(),
        ));
    }

    let sig_str = signature_header
        .map(str::trim)
        .and_then(|s| s.strip_prefix("sha256="))
        .ok_or_else(|| AppError::Unauthorized("missing or invalid X-Signature-256".to_string()))?;
    let provided = hex::decode(sig_str)
        .map_err(|_| AppError::Unauthorized("malformed X-Signature-256 hex".to_string()))?;

    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts keys of any length");
    mac.update(ts_str.as_bytes());
    mac.update(b".");
    mac.update(raw_body);
    let expected = mac.finalize().into_bytes();

    if provided.len() != expected.len()
        || !bool::from(provided.as_slice().ct_eq(expected.as_slice()))
    {
        return Err(AppError::Unauthorized(
            "invalid webhook signature".to_string(),
        ));
    }

    Ok(())
}

pub async fn internal_media_ready(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, AppError> {
    let ts = headers.get("x-timestamp").and_then(|v| v.to_str().ok());
    let sig = headers.get("x-signature-256").and_then(|v| v.to_str().ok());
    verify_webhook_signature(
        state.config.lambda_webhook_secret.expose(),
        ts,
        sig,
        &body,
        Utc::now().timestamp(),
    )?;

    let payload: InternalMediaReadyPayload = serde_json::from_slice(&body)
        .map_err(|_| AppError::BadRequest("invalid webhook JSON payload".to_string()))?;

    match payload.status.as_str() {
        "READY" => {
            let r2_key = payload.r2_key.ok_or_else(|| {
                AppError::BadRequest("r2Key is required when status is READY".to_string())
            })?;
            sqlx::query(
                "UPDATE media_assets
                 SET status = 'READY', r2_key = $2, r2_thumb_key = $3, ready_at = NOW(), error_reason = NULL
                 WHERE id = $1",
            )
            .bind(payload.media_id)
            .bind(r2_key)
            .bind(payload.r2_thumb_key)
            .execute(&state.pg)
            .await?;
        }
        "FAILED" => {
            sqlx::query(
                "UPDATE media_assets
                 SET status = 'FAILED', error_reason = $2
                 WHERE id = $1",
            )
            .bind(payload.media_id)
            .bind(
                payload
                    .error_reason
                    .unwrap_or_else(|| "compression failed".to_string()),
            )
            .execute(&state.pg)
            .await?;
        }
        other => {
            return Err(AppError::BadRequest(format!(
                "unsupported media callback status '{other}'"
            )));
        }
    }

    Ok(StatusCode::NO_CONTENT)
}
