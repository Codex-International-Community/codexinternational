#![allow(dead_code)]

use anyhow::{Result, bail};
use serde::Deserialize;

pub const MAX_VIDEO_WIDTH: u32 = 4096;
pub const MAX_VIDEO_HEIGHT: u32 = 4096;
pub const MAX_VIDEO_PIXELS: u64 = 8_294_400; // 3840x2160
pub const MAX_STREAMS: usize = 4;
pub const MAX_FPS: f64 = 120.0;
pub const FFMPEG_MAX_OUTPUT_BYTES: u64 = 104_857_600; // 100 MB hard cap

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QualityTier {
    Standard,
    Pro,
}

impl QualityTier {
    pub fn max_duration_secs(self) -> f64 {
        match self {
            Self::Standard => 180.0, // 3 minutes
            Self::Pro => 300.0,      // 5 minutes
        }
    }

    pub fn max_height(self) -> u32 {
        match self {
            Self::Standard => 1080,
            Self::Pro => 2160,
        }
    }

    pub fn crf(self) -> u8 {
        match self {
            Self::Standard => 27,
            Self::Pro => 21,
        }
    }

    pub fn maxrate(self) -> &'static str {
        match self {
            Self::Standard => "2500k",
            Self::Pro => "8000k",
        }
    }

    pub fn bufsize(self) -> &'static str {
        match self {
            Self::Standard => "5000k",
            Self::Pro => "16000k",
        }
    }

    pub fn audio_bitrate(self) -> &'static str {
        match self {
            Self::Standard => "128k",
            Self::Pro => "192k",
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct FfprobeOutput {
    pub format: Option<FfprobeFormat>,
    #[serde(default)]
    pub streams: Vec<FfprobeStream>,
}

#[derive(Debug, Deserialize)]
pub struct FfprobeFormat {
    pub duration: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FfprobeStream {
    pub codec_type: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub avg_frame_rate: Option<String>,
}

fn parse_fps(raw: &str) -> Option<f64> {
    let trimmed = raw.trim();
    if let Some((num_s, den_s)) = trimmed.split_once('/') {
        let num: f64 = num_s.parse().ok()?;
        let den: f64 = den_s.parse().ok()?;
        if den == 0.0 {
            return None;
        }
        Some(num / den)
    } else {
        trimmed.parse().ok()
    }
}

/// Validates `ffprobe` JSON metadata before invoking `ffmpeg` to reject video decompression bombs.
pub fn validate_ffprobe_metadata(json_str: &str, tier: QualityTier) -> Result<()> {
    let probe: FfprobeOutput = serde_json::from_str(json_str)?;

    if probe.streams.is_empty() || probe.streams.len() > MAX_STREAMS {
        bail!("SECURITY_REJECTED: decompression bomb detected (invalid stream count)");
    }

    let duration: f64 = probe
        .format
        .as_ref()
        .and_then(|f| f.duration.as_deref())
        .and_then(|d| d.parse().ok())
        .unwrap_or(0.0);

    if duration <= 0.0 || duration > tier.max_duration_secs() {
        bail!(
            "SECURITY_REJECTED: video duration ({duration:.1}s) exceeds {} tier limit ({:.0}s)",
            match tier {
                QualityTier::Standard => "standard",
                QualityTier::Pro => "pro",
            },
            tier.max_duration_secs()
        );
    }

    let mut has_video = false;
    for stream in &probe.streams {
        if stream.codec_type.as_deref() == Some("video") {
            has_video = true;
            let w = stream.width.unwrap_or(0);
            let h = stream.height.unwrap_or(0);
            if w == 0 || h == 0 || w > MAX_VIDEO_WIDTH || h > MAX_VIDEO_HEIGHT {
                bail!("SECURITY_REJECTED: decompression bomb detected (extreme video dimensions)");
            }
            if u64::from(w) * u64::from(h) > MAX_VIDEO_PIXELS {
                bail!("SECURITY_REJECTED: decompression bomb detected (pixel count exceeds 4K)");
            }
            if let Some(fps) = stream.avg_frame_rate.as_deref().and_then(parse_fps)
                && fps > MAX_FPS
            {
                bail!("SECURITY_REJECTED: decompression bomb detected (abnormal frame rate)");
            }
        }
    }

    if !has_video {
        bail!("SECURITY_REJECTED: no video stream found");
    }

    Ok(())
}

/// Builds hardened `ffmpeg` CLI arguments for the requested `QualityTier`.
pub fn build_ffmpeg_args(input_path: &str, output_path: &str, tier: QualityTier) -> Vec<String> {
    let vf = format!(
        "scale=-2:'min(ih,{})':force_original_aspect_ratio=decrease:force_divisible_by=2",
        tier.max_height()
    );
    let max_t = format!("{:.0}", tier.max_duration_secs());
    let crf = tier.crf().to_string();
    let fs = FFMPEG_MAX_OUTPUT_BYTES.to_string();

    vec![
        "-y".to_string(),
        "-i".to_string(),
        input_path.to_string(),
        "-map".to_string(),
        "0:v:0".to_string(),
        "-map".to_string(),
        "0:a:0?".to_string(),
        "-t".to_string(),
        max_t,
        "-fs".to_string(),
        fs,
        "-max_muxing_queue_size".to_string(),
        "1024".to_string(),
        "-fps_mode".to_string(),
        "vfr".to_string(),
        "-vf".to_string(),
        vf,
        "-c:v".to_string(),
        "libx264".to_string(),
        "-preset".to_string(),
        "veryfast".to_string(),
        "-crf".to_string(),
        crf,
        "-maxrate".to_string(),
        tier.maxrate().to_string(),
        "-bufsize".to_string(),
        tier.bufsize().to_string(),
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        tier.audio_bitrate().to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        output_path.to_string(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_extreme_dimensions_video_bomb() {
        let json = r#"{
            "format": { "duration": "12.0" },
            "streams": [{ "codec_type": "video", "width": 65535, "height": 65535, "avg_frame_rate": "30/1" }]
        }"#;
        assert!(validate_ffprobe_metadata(json, QualityTier::Pro).is_err());
    }

    #[test]
    fn enforces_tier_duration_limits() {
        let json_4min = r#"{
            "format": { "duration": "240.0" },
            "streams": [{ "codec_type": "video", "width": 1920, "height": 1080, "avg_frame_rate": "30/1" }]
        }"#;
        assert!(validate_ffprobe_metadata(json_4min, QualityTier::Standard).is_err());
        assert!(validate_ffprobe_metadata(json_4min, QualityTier::Pro).is_ok());

        let json_6min = r#"{
            "format": { "duration": "360.0" },
            "streams": [{ "codec_type": "video", "width": 1920, "height": 1080, "avg_frame_rate": "30/1" }]
        }"#;
        assert!(validate_ffprobe_metadata(json_6min, QualityTier::Pro).is_err());
    }

    #[test]
    fn builds_hardened_ffmpeg_args_per_tier() {
        let std_args = build_ffmpeg_args("/tmp/in.mp4", "/tmp/out.mp4", QualityTier::Standard);
        assert!(std_args.contains(&"180".to_string()));
        assert!(std_args.contains(&"27".to_string()));
        assert!(std_args.contains(&"+faststart".to_string()));
        assert!(std_args.contains(&"104857600".to_string()));

        let pro_args = build_ffmpeg_args("/tmp/in.mp4", "/tmp/out.mp4", QualityTier::Pro);
        assert!(pro_args.contains(&"300".to_string()));
        assert!(pro_args.contains(&"21".to_string()));
        assert!(pro_args.contains(&"8000k".to_string()));
    }
}
