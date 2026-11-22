use std::io::Cursor;

use anyhow::{Context, Result};
use image::{ImageFormat, ImageReader, Limits, imageops::FilterType};

const MAX_IMAGE_DIM: u32 = 8192;
const MAX_IMAGE_ALLOC_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone, Copy)]
pub struct CompressOptions {
    pub max_width: u32,
    pub max_height: u32,
}

impl Default for CompressOptions {
    fn default() -> Self {
        Self {
            max_width: 1920,
            max_height: 1920,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CompressedImage {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub mime_type: &'static str,
}

/// Decodes an image from memory with strict dimension/allocation limits (anti-image-bomb),
/// downscales it proportionally if it exceeds `max_width` / `max_height`, and encodes it as WebP.
pub fn compress_to_webp(input: &[u8], opts: CompressOptions) -> Result<CompressedImage> {
    let mut reader = ImageReader::new(Cursor::new(input))
        .with_guessed_format()
        .context("failed to guess input image format")?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_IMAGE_DIM);
    limits.max_image_height = Some(MAX_IMAGE_DIM);
    limits.max_alloc = Some(MAX_IMAGE_ALLOC_BYTES);
    reader.limits(limits);

    let img = reader.decode().context("failed to decode input image")?;

    let (orig_w, orig_h) = (img.width(), img.height());
    let processed = if orig_w > opts.max_width || orig_h > opts.max_height {
        img.resize(opts.max_width, opts.max_height, FilterType::Lanczos3)
    } else {
        img
    };

    let width = processed.width();
    let height = processed.height();

    let mut out = Cursor::new(Vec::new());
    processed
        .write_to(&mut out, ImageFormat::WebP)
        .context("failed to encode image as WebP")?;

    Ok(CompressedImage {
        bytes: out.into_inner(),
        width,
        height,
        mime_type: "image/webp",
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgba};

    fn make_png(width: u32, height: u32) -> Vec<u8> {
        let img: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_fn(width, height, |x, y| {
            Rgba([(x % 256) as u8, (y % 256) as u8, 128, 255])
        });
        let mut buf = Cursor::new(Vec::new());
        img.write_to(&mut buf, ImageFormat::Png).unwrap();
        buf.into_inner()
    }

    #[test]
    fn downscales_large_image_and_encodes_webp() {
        let png = make_png(2400, 1200);
        let res = compress_to_webp(&png, CompressOptions::default()).unwrap();

        assert_eq!(res.width, 1920);
        assert_eq!(res.height, 960);
        assert_eq!(res.mime_type, "image/webp");
        assert!(res.bytes.len() >= 12);
        assert_eq!(&res.bytes[0..4], b"RIFF");
        assert_eq!(&res.bytes[8..12], b"WEBP");
    }

    #[test]
    fn preserves_dimensions_for_small_image() {
        let png = make_png(120, 80);
        let res = compress_to_webp(&png, CompressOptions::default()).unwrap();

        assert_eq!(res.width, 120);
        assert_eq!(res.height, 80);
        assert_eq!(&res.bytes[0..4], b"RIFF");
        assert_eq!(&res.bytes[8..12], b"WEBP");
    }
}
