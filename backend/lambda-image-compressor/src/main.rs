mod compressor;
mod webhook;

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
};

#[derive(Debug, Deserialize)]
struct ImageJobPayload {
    media_id: String,
    source_key: String,
    dest_key: String,
    #[serde(default)]
    max_width: Option<u32>,
    #[serde(default)]
    max_height: Option<u32>,
    #[serde(default)]
    callback_url: Option<String>,
}

#[derive(Debug, Serialize)]
struct ImageJobResult {
    media_id: String,
    dest_key: String,
    size_bytes: usize,
    width: u32,
    height: u32,
    mime_type: &'static str,
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

async fn function_handler(
    ctx: Arc<AppContext>,
    event: LambdaEvent<ImageJobPayload>,
) -> Result<ImageJobResult, LambdaError> {
    let payload = event.payload;
    tracing::info!(
        media_id = %payload.media_id,
        source_key = %payload.source_key,
        dest_key = %payload.dest_key,
        "starting image compression job"
    );

    let obj = ctx
        .s3
        .get_object()
        .bucket(&ctx.bucket)
        .key(&payload.source_key)
        .send()
        .await
        .context("failed to download source image from R2")?;

    let raw_bytes = obj
        .body
        .collect()
        .await
        .context("failed to read R2 object body")?
        .into_bytes();

    let opts = CompressOptions {
        max_width: payload.max_width.unwrap_or(1920),
        max_height: payload.max_height.unwrap_or(1920),
    };

    let compressed = tokio::task::spawn_blocking(move || compress_to_webp(&raw_bytes, opts))
        .await
        .context("compression task panicked")??;

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

    let callback_url = payload.callback_url.or_else(|| ctx.webhook_url.clone());
    if let Some(url) = callback_url
        && !ctx.webhook_secret.is_empty()
    {
        let cb = MediaReadyCallback {
            media_id: payload.media_id.clone(),
            r2_key: payload.dest_key.clone(),
            size_bytes,
            width: compressed.width,
            height: compressed.height,
            mime_type: compressed.mime_type.to_string(),
        };
        send_callback(&ctx.http, &url, &ctx.webhook_secret, &cb).await?;
    }

    Ok(ImageJobResult {
        media_id: payload.media_id,
        dest_key: payload.dest_key,
        size_bytes,
        width: compressed.width,
        height: compressed.height,
        mime_type: compressed.mime_type,
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
