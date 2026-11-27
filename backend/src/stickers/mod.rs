use std::sync::Arc;

use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, StatusCode, header::CONTENT_TYPE},
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    auth::extractor::AuthUser,
    error::AppError,
    media::{
        HTTP_CLIENT, allowed_media_type, attachment_from_record, magic_signature_matches,
        presigned_r2_url,
    },
    state::AppState,
};

pub const MAX_STICKER_UPLOAD_BYTES: usize = 5 * 1024 * 1024;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/",
            get(list_stickers)
                .post(upload_sticker)
                .layer(DefaultBodyLimit::max(MAX_STICKER_UPLOAD_BYTES)),
        )
        .route("/{id}/save", post(save_sticker).delete(unsave_sticker))
}

#[derive(Debug, Deserialize)]
pub struct ListStickersQuery {
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct StickerItem {
    pub id: Uuid,
    pub kind: String,
    pub sha256_hash: String,
    pub label: String,
    pub media_url: String,
    pub mime_type: String,
    pub byte_size: i64,
    pub saved: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct UploadStickerResponse {
    pub sticker: StickerItem,
    pub deduplicated: bool,
}

fn normalize_kind(raw: Option<&str>) -> Result<&'static str, AppError> {
    match raw
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        None | Some("sticker") => Ok("sticker"),
        Some("gif") => Ok("gif"),
        Some(other) => Err(AppError::BadRequest(format!(
            "unsupported sticker kind '{other}'; expected 'sticker' or 'gif'"
        ))),
    }
}

async fn list_stickers(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Query(query): Query<ListStickersQuery>,
) -> Result<impl IntoResponse, AppError> {
    let kind_filter = query
        .kind
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| normalize_kind(Some(s)))
        .transpose()?;

    let mut items = if let Some(kind) = kind_filter {
        sqlx::query_as::<_, StickerItem>(
            "SELECT
                s.id,
                s.kind,
                s.sha256_hash,
                s.label,
                s.media_url,
                s.mime_type,
                s.byte_size,
                EXISTS(SELECT 1 FROM user_stickers us WHERE us.user_id = $1 AND us.sticker_id = s.id) AS saved,
                s.created_at
             FROM stickers s
             WHERE s.kind = $2
             ORDER BY saved DESC, s.created_at DESC
             LIMIT 100",
        )
        .bind(auth.user_id)
        .bind(kind)
        .fetch_all(&state.pg)
        .await?
    } else {
        sqlx::query_as::<_, StickerItem>(
            "SELECT
                s.id,
                s.kind,
                s.sha256_hash,
                s.label,
                s.media_url,
                s.mime_type,
                s.byte_size,
                EXISTS(SELECT 1 FROM user_stickers us WHERE us.user_id = $1 AND us.sticker_id = s.id) AS saved,
                s.created_at
             FROM stickers s
             ORDER BY saved DESC, s.created_at DESC
             LIMIT 100",
        )
        .bind(auth.user_id)
        .fetch_all(&state.pg)
        .await?
    };

    for item in &mut items {
        item.media_url =
            crate::media::normalize_public_media_url(std::mem::take(&mut item.media_url));
    }

    Ok(Json(items))
}

async fn upload_sticker(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    headers: HeaderMap,
    body: Bytes,
) -> Result<impl IntoResponse, AppError> {
    if body.is_empty() {
        return Err(AppError::BadRequest("sticker file is empty".to_string()));
    }
    if body.len() > MAX_STICKER_UPLOAD_BYTES {
        return Err(AppError::PayloadTooLarge(
            "stickers and GIFs are limited to 5 MB".to_string(),
        ));
    }

    let kind = normalize_kind(headers.get("x-sticker-kind").and_then(|v| v.to_str().ok()))?;

    let mime_type = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();

    let (media_kind, extension) = allowed_media_type(&mime_type)
        .filter(|(k, _)| *k == "image")
        .ok_or_else(|| {
            AppError::BadRequest(
                "unsupported image format; use PNG, WEBP, GIF, AVIF, or JPG".to_string(),
            )
        })?;
    if kind == "gif" && mime_type != "image/gif" && mime_type != "image/webp" {
        return Err(AppError::BadRequest(
            "GIF uploads must be image/gif or image/webp".to_string(),
        ));
    }
    if !magic_signature_matches(&mime_type, &body) {
        return Err(AppError::BadRequest(
            "file contents do not match the selected image type".to_string(),
        ));
    }

    let label = headers
        .get("x-sticker-label")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .unwrap_or("")
        .chars()
        .take(80)
        .collect::<String>();

    let sha256_hash = hex::encode(Sha256::digest(&body));

    // Deduplicate by (kind, sha256_hash): reuse existing sticker_id & R2 object if present.
    if let Some(existing) = sqlx::query_as::<_, StickerItem>(
        "SELECT
            id,
            kind,
            sha256_hash,
            label,
            media_url,
            mime_type,
            byte_size,
            TRUE AS saved,
            created_at
         FROM stickers
         WHERE kind = $1 AND sha256_hash = $2
         LIMIT 1",
    )
    .bind(kind)
    .bind(&sha256_hash)
    .fetch_optional(&state.pg)
    .await?
    {
        sqlx::query(
            "INSERT INTO user_stickers (user_id, sticker_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING",
        )
        .bind(auth.user_id)
        .bind(existing.id)
        .execute(&state.pg)
        .await?;

        return Ok((
            StatusCode::OK,
            Json(UploadStickerResponse {
                sticker: existing,
                deduplicated: true,
            }),
        ));
    }

    let sticker_id = Uuid::now_v7();
    let byte_size = i64::try_from(body.len()).map_err(|e| AppError::Internal(e.into()))?;
    let object_key = format!("stickers/{kind}/{sticker_id}.{extension}");
    let upload_url = presigned_r2_url(&state.config, "PUT", &object_key, 900)?;

    let response = HTTP_CLIENT
        .put(upload_url)
        .header(CONTENT_TYPE, mime_type.as_str())
        .header("cache-control", "public, max-age=31536000, immutable")
        .body(body)
        .send()
        .await
        .map_err(|e| AppError::Internal(e.into()))?;
    if !response.status().is_success() {
        tracing::error!(status = %response.status(), "Cloudflare R2 sticker upload failed");
        return Err(AppError::ServiceUnavailable {
            retry_after_secs: 30,
            message: "Sticker could not be saved to media storage".to_string(),
        });
    }

    let attachment = attachment_from_record(
        &state.config,
        sticker_id,
        format!("{sticker_id}.{extension}"),
        mime_type.clone(),
        byte_size,
        object_key,
    )?;
    let media_url = attachment.url;
    let now = Utc::now();

    let mut tx = state.pg.begin().await?;
    sqlx::query(
        "INSERT INTO stickers (id, kind, sha256_hash, label, media_url, mime_type, byte_size, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(sticker_id)
    .bind(kind)
    .bind(&sha256_hash)
    .bind(&label)
    .bind(&media_url)
    .bind(&mime_type)
    .bind(byte_size)
    .bind(auth.user_id)
    .bind(now)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO user_stickers (user_id, sticker_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING",
    )
    .bind(auth.user_id)
    .bind(sticker_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    let _ = media_kind;

    Ok((
        StatusCode::CREATED,
        Json(UploadStickerResponse {
            sticker: StickerItem {
                id: sticker_id,
                kind: kind.to_string(),
                sha256_hash,
                label,
                media_url,
                mime_type,
                byte_size,
                saved: true,
                created_at: now,
            },
            deduplicated: false,
        }),
    ))
}

async fn save_sticker(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(sticker_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM stickers WHERE id = $1)")
        .bind(sticker_id)
        .fetch_one(&state.pg)
        .await?;
    if !exists {
        return Err(AppError::NotFound("sticker not found".to_string()));
    }

    sqlx::query(
        "INSERT INTO user_stickers (user_id, sticker_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING",
    )
    .bind(auth.user_id)
    .bind(sticker_id)
    .execute(&state.pg)
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

async fn unsave_sticker(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(sticker_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    sqlx::query("DELETE FROM user_stickers WHERE user_id = $1 AND sticker_id = $2")
        .bind(auth.user_id)
        .bind(sticker_id)
        .execute(&state.pg)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}
