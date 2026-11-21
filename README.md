# CODEXINTERNATIONAL (CODEXTER)

Super-App komunitas IT berbasis Rust Axum + PostgreSQL + Valkey 9.x + Cloudflare R2 + AWS Lambda dengan client web React TypeScript dan roadmap mobile Kotlin.

## Navigasi Dokumentasi

- [`INDEX.md`](INDEX.md) — Peta navigasi arsitektur & aturan prioritas dokumen.
- [`backend/PRD.md`](backend/PRD.md) — Spesifikasi arsitektur, state schema, DDL, invariants (`INV-1..16`), dan decision log.
- [`backend/TASKS.md`](backend/TASKS.md) — Roadmap implementasi TDD per fase.
- [`backend/README.md`](backend/README.md) — Catatan setup lokal, perintah cargo, dan pipeline media.

## Pipeline Media & Keamanan Upload

Semua media melewati satu jalur kompresi seragam (tanpa folder `original/` atau bypass) dengan dua profil `quality_tier`:

- **Video (`video/mp4`, `video/webm`, `video/quicktime`):**
  - `standard`: maks `1080p`, CRF `26–28`, `-maxrate 2.5M`, AAC `128 kbps`, ukuran maks `50 MB`, **durasi maks 3 menit (`180s`)**.
  - `pro`: maks `2160p` (4K), CRF `20–22`, `-maxrate 8M`, AAC `192–256 kbps`, ukuran maks `200 MB`, **durasi maks 5 menit (`300s`)**.
- **Gambar:** `standard` maks `1920px` (`5 MB`), `pro` maks `3840px` (`10 MB`).
- **Pertahanan Decompression Bomb:** Pre-flight `ffprobe` + hard limits FFmpeg (`Video Bomb`), `ImageReader` `Limits` (`Image Bomb`), dan streaming `ZipBombGuard` untuk `.zip`/Office (`.docx`, `.xlsx`, `.pptx`).
