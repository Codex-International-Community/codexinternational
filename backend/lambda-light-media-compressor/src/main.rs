mod compressor;
mod webhook;
mod zip_guard;

use std::sync::Arc;

use anyhow::{Context, Result};
use aws_config::BehaviorVersion;
use aws_sdk_s3::{
    Client as S3Client,
    config::{Credentials, Region},
    primitives::ByteStream,
};
use lambda_runtime::{Error as LambdaError, LambdaEvent, run, service_fn};
use serde::{Deserialize, Serialize};
use tracing_subscriber::EnvFilter;

use crate::{
    compressor::{CompressOptions, compress_to_webp},
    webhook::{MediaReadyCallback, send_callback},
    zip_guard::ZipBombGuard,
};

#[derive(Debug, Deserialize)]
struct MediaJobPayload {
    media_id: String,
    source_key: String,
    dest_key: String,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    max_width: Option<u32>,
    #[serde(default)]
    max_height: Option<u32>,
    #[serde(default)]
    client_checked: Option<bool>,
    #[serde(default)]
    callback_url: Option<String>,
}

#[derive(Debug, Serialize)]
struct MediaJobResult {
    media_id: String,
    status: &'static str,
    dest_key: Option<String>,
    size_bytes: usize,
    width: u32,
    height: u32,
    mime_type: String,
}

struct AppContext {
    s3: S3Client,
    bucket: String,
    http: reqwest::Client,
    webhook_url: Option<String>,
    webhook_secret: String,
}

fn build_r2_client(account_id: &str, access_key_id: &str, secret_access_key: &str) -> S3Client {
    let endpoint = format!("https://{account_id}.r2.cloudflarestorage.com");
    let creds = Credentials::new(access_key_id, secret_access_key, None, None, "r2-env");
    let conf = aws_sdk_s3::Config::builder()
        .behavior_version(BehaviorVersion::latest())
        .region(Region::new("auto"))
        .endpoint_url(endpoint)
        .credentials_provider(creds)
        .force_path_style(true)
        .build();
    S3Client::from_conf(conf)
}

async fn reject_and_cleanup(
    ctx: &AppContext,
    media_id: &str,
    source_key: &str,
    callback_url: Option<String>,
    reason: String,
    client_bypass: bool,
) -> MediaJobResult {
    tracing::warn!(media_id = %media_id, source_key = %source_key, reason = %reason, "rejecting media");

    if let Err(err) = ctx
        .s3
        .delete_object()
        .bucket(&ctx.bucket)
        .key(source_key)
        .send()
        .await
    {
        tracing::error!(media_id = %media_id, error = %err, "failed to delete rejected R2 object");
    }

    if let Some(url) = callback_url
        && !ctx.webhook_secret.is_empty()
    {
        let cb = MediaReadyCallback {
            media_id: media_id.to_string(),
            status: "FAILED".to_string(),
            r2_key: None,
            r2_thumb_key: None,
            error_reason: Some(reason),
            client_bypass,
            size_bytes: 0,
            width: 0,
            height: 0,
            mime_type: "application/octet-stream".to_string(),
        };
        if let Err(err) = send_callback(&ctx.http, &url, &ctx.webhook_secret, &cb).await {
            tracing::error!(media_id = %media_id, error = %err, "failed to send FAILED webhook");
        }
    }

    MediaJobResult {
        media_id: media_id.to_string(),
        status: "FAILED",
        dest_key: None,
        size_bytes: 0,
        width: 0,
        height: 0,
        mime_type: "application/octet-stream".to_string(),
    }
}

async fn function_handler(
    ctx: Arc<AppContext>,
    event: LambdaEvent<MediaJobPayload>,
) -> Result<MediaJobResult, LambdaError> {
    let payload = event.payload;
    let kind = payload.kind.as_deref().unwrap_or("image");
    let callback_url = payload.callback_url.or_else(|| ctx.webhook_url.clone());

    tracing::info!(
        media_id = %payload.media_id,
        kind = %kind,
        source_key = %payload.source_key,
        dest_key = %payload.dest_key,
        "starting lightweight media job"
    );

    let obj = ctx
        .s3
        .get_object()
        .bucket(&ctx.bucket)
        .key(&payload.source_key)
        .send()
        .await
        .context("failed to download source object from R2")?;

    let raw_bytes = obj
        .body
        .collect()
        .await
        .context("failed to read R2 object body")?
        .into_bytes();

    if kind == "file" {
        let client_bypass = payload.client_checked == Some(false);
        let lower_key = payload.source_key.to_ascii_lowercase();
        let is_office = lower_key.ends_with(".docx")
            || lower_key.ends_with(".xlsx")
            || lower_key.ends_with(".pptx");
        let is_zip_container = is_office || lower_key.ends_with(".zip");

        if is_zip_container {
            let bytes_clone = raw_bytes.clone();
            let guard_res = tokio::task::spawn_blocking(move || {
                ZipBombGuard::inspect_zip_bytes(&bytes_clone, is_office)
            })
            .await
            .context("zip guard task panicked")?;

            if let Err(err) = guard_res {
                return Ok(reject_and_cleanup(
                    &ctx,
                    &payload.media_id,
                    &payload.source_key,
                    callback_url,
                    format!("SECURITY_REJECTED: decompression bomb detected ({err})"),
                    client_bypass,
                )
                .await);
            }
        }

        if client_bypass {
            return Ok(reject_and_cleanup(
                &ctx,
                &payload.media_id,
                &payload.source_key,
                callback_url,
                "upload failed".to_string(),
                true,
            )
            .await);
        }

        let size_bytes = raw_bytes.len();
        if let Some(url) = callback_url
            && !ctx.webhook_secret.is_empty()
        {
            let cb = MediaReadyCallback {
                media_id: payload.media_id.clone(),
                status: "READY".to_string(),
                r2_key: Some(payload.source_key.clone()),
                r2_thumb_key: None,
                error_reason: None,
                client_bypass: false,
                size_bytes,
                width: 0,
                height: 0,
                mime_type: "application/octet-stream".to_string(),
            };
            send_callback(&ctx.http, &url, &ctx.webhook_secret, &cb).await?;
        }

        return Ok(MediaJobResult {
            media_id: payload.media_id,
            status: "READY",
            dest_key: Some(payload.source_key),
            size_bytes,
            width: 0,
            height: 0,
            mime_type: "application/octet-stream".to_string(),
        });
    }

    let opts = CompressOptions {
        max_width: payload.max_width.unwrap_or(1920),
        max_height: payload.max_height.unwrap_or(1920),
    };

    let compressed = match tokio::task::spawn_blocking(move || compress_to_webp(&raw_bytes, opts))
        .await
        .context("compression task panicked")?
    {
        Ok(res) => res,
        Err(err) => {
            return Ok(reject_and_cleanup(
                &ctx,
                &payload.media_id,
                &payload.source_key,
                callback_url,
                format!("SECURITY_REJECTED: decompression bomb detected ({err})"),
                false,
            )
            .await);
        }
    };

    let size_bytes = compressed.bytes.len();

    ctx.s3
        .put_object()
        .bucket(&ctx.bucket)
        .key(&payload.dest_key)
        .content_type(compressed.mime_type)
        .cache_control("public, max-age=31536000, immutable")
        .body(ByteStream::from(compressed.bytes))
        .send()
        .await
        .context("failed to upload compressed WebP image to R2")?;

    if let Some(url) = callback_url
        && !ctx.webhook_secret.is_empty()
    {
        let cb = MediaReadyCallback {
            media_id: payload.media_id.clone(),
            status: "READY".to_string(),
            r2_key: Some(payload.dest_key.clone()),
            r2_thumb_key: None,
            error_reason: None,
            client_bypass: false,
            size_bytes,
            width: compressed.width,
            height: compressed.height,
            mime_type: compressed.mime_type.to_string(),
        };
        send_callback(&ctx.http, &url, &ctx.webhook_secret, &cb).await?;
    }

    Ok(MediaJobResult {
        media_id: payload.media_id,
        status: "READY",
        dest_key: Some(payload.dest_key),
        size_bytes,
        width: compressed.width,
        height: compressed.height,
        mime_type: compressed.mime_type.to_string(),
    })
}

#[tokio::main]
async fn main() -> Result<(), LambdaError> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .json()
        .without_time()
        .init();

    let account_id = std::env::var("R2_ACCOUNT_ID").expect("R2_ACCOUNT_ID must be set");
    let access_key = std::env::var("R2_ACCESS_KEY_ID").expect("R2_ACCESS_KEY_ID must be set");
    let secret_key =
        std::env::var("R2_SECRET_ACCESS_KEY").expect("R2_SECRET_ACCESS_KEY must be set");
    let bucket = std::env::var("R2_BUCKET_NAME").unwrap_or_else(|_| "codexter-media".to_string());
    let webhook_url = std::env::var("LAMBDA_WEBHOOK_URL")
        .ok()
        .filter(|s| !s.trim().is_empty());
    let webhook_secret = std::env::var("LAMBDA_WEBHOOK_SECRET").unwrap_or_default();

    let ctx = Arc::new(AppContext {
        s3: build_r2_client(&account_id, &access_key, &secret_key),
        bucket,
        http: reqwest::Client::new(),
        webhook_url,
        webhook_secret,
    });

    run(service_fn(move |event| {
        let ctx = ctx.clone();
        async move { function_handler(ctx, event).await }
    }))
    .await
}
