#![allow(dead_code)]

use std::io::{Cursor, Read};

use anyhow::{Result, bail};

const ZIP_MAX_TOTAL_BYTES: u64 = 250 * 1024 * 1024;
const ZIP_MAX_ENTRIES: usize = 1_000;
const ZIP_MAX_RATIO_GENERAL: f64 = 25.0;
const ZIP_MAX_RATIO_OFFICE: f64 = 100.0;
const ZIP_SMALL_RATIO_BYPASS_BYTES: u64 = 10 * 1024 * 1024;
const ZIP_MAX_NESTED_DEPTH: usize = 1;

/// Streaming decompression-bomb guard for `.zip` and OpenXML Office archives in Lambda.
pub struct ZipBombGuard;

impl ZipBombGuard {
    pub fn inspect_zip_bytes(data: &[u8], is_office: bool) -> Result<()> {
        Self::inspect_recursive(data, is_office, 0)
    }

    fn inspect_recursive(data: &[u8], is_office: bool, depth: usize) -> Result<()> {
        if depth > ZIP_MAX_NESTED_DEPTH {
            bail!("SECURITY_REJECTED: decompression bomb detected");
        }

        let mut archive = zip::ZipArchive::new(Cursor::new(data))
            .map_err(|_| anyhow::anyhow!("SECURITY_REJECTED: invalid or corrupted zip archive"))?;

        if archive.len() > ZIP_MAX_ENTRIES {
            bail!("SECURITY_REJECTED: decompression bomb detected");
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
            let mut entry = archive
                .by_index(idx)
                .map_err(|_| anyhow::anyhow!("SECURITY_REJECTED: decompression bomb detected"))?;

            if entry.is_dir() {
                continue;
            }

            let entry_name = entry
                .name()
                .map_err(|_| anyhow::anyhow!("SECURITY_REJECTED: invalid or corrupted zip archive"))?
                .to_ascii_lowercase();
            let is_nested_archive = entry_name.ends_with(".zip")
                || entry_name.ends_with(".gz")
                || entry_name.ends_with(".tar")
                || entry_name.ends_with(".7z")
                || entry_name.ends_with(".rar");

            let remaining_budget = ZIP_MAX_TOTAL_BYTES.saturating_sub(total_actual);
            let mut limited = (&mut entry).take(remaining_budget + 1);
            let mut entry_bytes = Vec::new();

            loop {
                let n = limited.read(&mut buf).map_err(|_| {
                    anyhow::anyhow!("SECURITY_REJECTED: decompression bomb detected")
                })?;
                if n == 0 {
                    break;
                }
                total_actual = total_actual.saturating_add(n as u64);
                if total_actual > ZIP_MAX_TOTAL_BYTES {
                    bail!("SECURITY_REJECTED: decompression bomb detected");
                }
                if is_nested_archive {
                    entry_bytes.extend_from_slice(&buf[..n]);
                }
            }

            if is_nested_archive {
                if depth + 1 > ZIP_MAX_NESTED_DEPTH {
                    bail!("SECURITY_REJECTED: decompression bomb detected");
                }
                if entry_name.ends_with(".zip") {
                    Self::inspect_recursive(&entry_bytes, false, depth + 1)?;
                } else {
                    bail!("SECURITY_REJECTED: decompression bomb detected");
                }
            }
        }

        if total_actual >= ZIP_SMALL_RATIO_BYPASS_BYTES {
            let ratio = (total_actual as f64) / (compressed_total as f64);
            if ratio > max_ratio {
                bail!("SECURITY_REJECTED: decompression bomb detected");
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::{ZipWriter, write::SimpleFileOptions};

    fn build_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = Cursor::new(Vec::new());
        {
            let mut writer = ZipWriter::new(&mut buf);
            for (name, data) in entries {
                writer
                    .start_file(*name, SimpleFileOptions::default())
                    .expect("start file");
                writer.write_all(data).expect("write data");
            }
            writer.finish().expect("finish zip");
        }
        buf.into_inner()
    }

    #[test]
    fn allows_valid_zip_and_rejects_deeply_nested_zip() {
        let valid = build_zip(&[("notes.txt", b"hello codexinternational")]);
        assert!(ZipBombGuard::inspect_zip_bytes(&valid, false).is_ok());

        let inner = build_zip(&[("payload.txt", b"nested")]);
        let outer = build_zip(&[("inner.zip", &inner)]);
        let nested = build_zip(&[("outer.zip", &outer)]);
        assert!(ZipBombGuard::inspect_zip_bytes(&nested, false).is_err());
    }
}
