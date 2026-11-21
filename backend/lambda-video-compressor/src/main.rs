mod video;
mod webhook;

use std::{path::PathBuf, sync::Arc, time::Duration};

use anyhow::{Context, Result, bail};
use aws_config::BehaviorVersion;
use aws_sdk_s3::{
    Client as S3Client,
    config::{Credentials, Region},
    primitives::ByteStream,
};
use lambda_runtime::{Error as LambdaError, LambdaEvent, run, service_fn};
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tracing_subscriber::EnvFilter;

use crate::{
    video::{QualityTier, build_ffmpeg_args, validate_ffprobe_metadata},
    webhook::{MediaReadyCallback, send_callback},
};

const FFPROBE_TIMEOUT: Duration = Duration::from_secs(10);
const FFMPEG_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Debug, Deserialize)]
struct VideoJobPayload {
    media_id: String,
    source_key: String,
    dest_key: String,
    #[serde(default)]
    thumb_key: Option<String>,
    #[serde(default)]
    quality_tier: QualityTier,
    #[serde(default)]
    callback_url: Option<String>,
}

#[derive(Debug, Serialize)]
struct VideoJobResult {
    media_id: String,
    status: &'static str,
    dest_key: Option<String>,
    thumb_key: Option<String>,
    size_bytes: usize,
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

async fn cleanup_tmp(paths: &[PathBuf]) {
    for path in paths {
        let _ = tokio::fs::remove_file(path).await;
    }
}

async fn stream_r2_to_file(
    ctx: &AppContext,
    key: &str,
    dest_path: &PathBuf,
    max_bytes: u64,
) -> Result<()> {
    let mut obj = ctx
        .s3
        .get_object()
        .bucket(&ctx.bucket)
        .key(key)
        .send()
        .await
        .context("failed to get R2 video object")?;

    let mut file = tokio::fs::File::create(dest_path)
        .await
        .context("failed to create /tmp input file")?;
    let mut written: u64 = 0;

    while let Some(chunk) = obj.body.try_next().await? {
        written = written.saturating_add(chunk.len() as u64);
        if written > max_bytes {
            bail!("SECURITY_REJECTED: video exceeds tier size limit");
        }
        file.write_all(&chunk).await?;
    }
    file.flush().await?;
    Ok(())
}

async fn run_ffprobe(input_path: &str, tier: QualityTier) -> Result<()> {
    let fut = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type,width,height,avg_frame_rate",
            "-of",
            "json",
            input_path,
        ])
        .output();

    let output = tokio::time::timeout(FFPROBE_TIMEOUT, fut)
        .await
        .context("ffprobe timed out")??;
    if !output.status.success() {
        bail!(
            "ffprobe failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    validate_ffprobe_metadata(&json_str, tier)
}

async fn run_ffmpeg_with_timeout(args: &[String]) -> Result<()> {
    let mut child = Command::new("ffmpeg")
        .args(args)
        .kill_on_drop(true)
        .spawn()
        .context("failed to spawn ffmpeg")?;

    match tokio::time::timeout(FFMPEG_TIMEOUT, child.wait()).await {
        Ok(Ok(status)) if status.success() => Ok(()),
        Ok(Ok(status)) => bail!("ffmpeg exited with status {status}"),
        Ok(Err(err)) => bail!("ffmpeg wait failed: {err}"),
        Err(_) => {
            let _ = child.kill().await;
            bail!("SECURITY_REJECTED: decompression bomb detected (ffmpeg timeout)")
        }
    }
}

async fn reject_and_cleanup(
    ctx: &AppContext,
    media_id: &str,
    source_key: &str,
    tmp_paths: &[PathBuf],
    callback_url: Option<String>,
    reason: String,
) -> VideoJobResult {
    tracing::warn!(media_id = %media_id, source_key = %source_key, reason = %reason, "rejecting video");
    cleanup_tmp(tmp_paths).await;

    if let Err(err) = ctx
        .s3
        .delete_object()
        .bucket(&ctx.bucket)
        .key(source_key)
        .send()
        .await
    {
        tracing::error!(media_id = %media_id, error = %err, "failed to delete rejected R2 video");
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
            size_bytes: 0,
            mime_type: "video/mp4".to_string(),
        };
        if let Err(err) = send_callback(&ctx.http, &url, &ctx.webhook_secret, &cb).await {
            tracing::error!(media_id = %media_id, error = %err, "failed to send FAILED webhook");
        }
    }

    VideoJobResult {
        media_id: media_id.to_string(),
        status: "FAILED",
        dest_key: None,
        thumb_key: None,
        size_bytes: 0,
    }
}

async fn function_handler(
    ctx: Arc<AppContext>,
    event: LambdaEvent<VideoJobPayload>,
) -> Result<VideoJobResult, LambdaError> {
    let payload = event.payload;
    let callback_url = payload.callback_url.or_else(|| ctx.webhook_url.clone());

    let tmp_dir = std::env::temp_dir();
    let in_path = tmp_dir.join(format!("in-{}", payload.media_id));
    let out_path = tmp_dir.join(format!("out-{}.mp4", payload.media_id));
    let thumb_path = tmp_dir.join(format!("thumb-{}.webp", payload.media_id));
    let tmp_paths = [in_path.clone(), out_path.clone(), thumb_path.clone()];

    if let Err(err) = stream_r2_to_file(
        &ctx,
        &payload.source_key,
        &in_path,
        payload.quality_tier.max_input_bytes(),
    )
    .await
    {
        return Ok(reject_and_cleanup(
            &ctx,
            &payload.media_id,
            &payload.source_key,
            &tmp_paths,
            callback_url,
            err.to_string(),
        )
        .await);
    }

    let in_str = in_path.to_string_lossy().to_string();
    let out_str = out_path.to_string_lossy().to_string();

    if let Err(err) = run_ffprobe(&in_str, payload.quality_tier).await {
        return Ok(reject_and_cleanup(
            &ctx,
            &payload.media_id,
            &payload.source_key,
            &tmp_paths,
            callback_url,
            err.to_string(),
        )
        .await);
    }

    let args = build_ffmpeg_args(&in_str, &out_str, payload.quality_tier);
    if let Err(err) = run_ffmpeg_with_timeout(&args).await {
        return Ok(reject_and_cleanup(
            &ctx,
            &payload.media_id,
            &payload.source_key,
            &tmp_paths,
            callback_url,
            err.to_string(),
        )
        .await);
    }

    let out_bytes = tokio::fs::read(&out_path)
        .await
        .context("failed to read transcoded mp4")?;
    let size_bytes = out_bytes.len();

    ctx.s3
        .put_object()
        .bucket(&ctx.bucket)
        .key(&payload.dest_key)
        .content_type("video/mp4")
        .cache_control("public, max-age=31536000, immutable")
        .body(ByteStream::from(out_bytes))
        .send()
        .await
        .context("failed to upload compressed mp4 to R2")?;

    let mut uploaded_thumb: Option<String> = None;
    if let Some(ref thumb_key) = payload.thumb_key {
        let thumb_str = thumb_path.to_string_lossy().to_string();
        let thumb_args = vec![
            "-y".to_string(),
            "-i".to_string(),
            out_str,
            "-ss".to_string(),
            "00:00:01".to_string(),
            "-vframes".to_string(),
            "1".to_string(),
            "-vf".to_string(),
            "scale=640:-2".to_string(),
            thumb_str,
        ];
        if run_ffmpeg_with_timeout(&thumb_args).await.is_ok()
            && let Ok(thumb_bytes) = tokio::fs::read(&thumb_path).await
        {
            let _ = ctx
                .s3
                .put_object()
                .bucket(&ctx.bucket)
                .key(thumb_key)
                .content_type("image/webp")
                .cache_control("public, max-age=31536000, immutable")
                .body(ByteStream::from(thumb_bytes))
                .send()
                .await;
            uploaded_thumb = Some(thumb_key.clone());
        }
    }

    cleanup_tmp(&tmp_paths).await;

    if let Some(url) = callback_url
        && !ctx.webhook_secret.is_empty()
    {
        let cb = MediaReadyCallback {
            media_id: payload.media_id.clone(),
            status: "READY".to_string(),
            r2_key: Some(payload.dest_key.clone()),
            r2_thumb_key: uploaded_thumb.clone(),
            error_reason: None,
            size_bytes,
            mime_type: "video/mp4".to_string(),
        };
        send_callback(&ctx.http, &url, &ctx.webhook_secret, &cb).await?;
    }

    Ok(VideoJobResult {
        media_id: payload.media_id,
        status: "READY",
        dest_key: Some(payload.dest_key),
        thumb_key: uploaded_thumb,
        size_bytes,
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
