# TASKS.md — CodexInternational Backend: Low-Level Implementation Roadmap

**Versi:** 1.3 (2026-11-22) — Roadmap Implementasi TDD Rust (`axum 0.8.9`, `sqlx 0.9.0`, `fred 10.1.0` untuk Valkey 9.1, PostgreSQL, Cloudflare R2, AWS Lambda Rust FFmpeg, Smart FCM HTTP v1, Billing DOKU QRIS-First, Anti-Ban Evasion APK, Escrow & Hackathon).
**Dokumen Pendamping:** [`backend/PRD.md`](PRD.md) (arsitektur, state schema `P§1.2`, DDL `P§1.3` & `P§9.2`, invariants `INV-1..22`, decision log `DEC-1..24`, arsip `P§8`, monetisasi `P§9` — wajib dibaca sebelum menulis kode), [`INDEX.md`](../INDEX.md) (peta navigasi).

---

## Panduan Eksekusi Roadmap

1. **Siklus Kerja TDD Wajib (Red → Green → Refactor):**
   - **Langkah 1 (Red):** Tulis *failing test* terlebih dahulu mengacu pada acceptance criteria dan invariant task terkait.
   - **Langkah 2 (Green):** Tulis kode implementasi seminimal mungkin hingga test berjalan **PASS**.
   - **Langkah 3 (Refactor & Lint):** Bersihkan kode dan pastikan seluruh quality gate lolos:

     ```bash
     cargo fmt --check
     cargo clippy --workspace --all-targets --all-features -- -D warnings
     cargo test --workspace
     ```

2. **Kepatuhan Invariant Mutlak:**
   - `PRD.md P§5` (`INV-1` s.d. `INV-22`) adalah hukum tertinggi.
   - Setiap fungsi yang menegakkan invariant wajib memiliki test eksplisit (contoh: `test_inv3_seq_id_atomic_cold_start`, `test_inv10_fcm_skip_all_tag_offline_10m`, `test_inv18_jumbo_quota_reserved_at_presign`, `test_inv22_readonly_write_blocked_and_device_ban`).
3. **Phase Gate:** Tidak boleh melangkah ke Fase berikutnya sebelum seluruh checklist **Phase Gate** di akhir fase aktif terpenuhi.

---

## Struktur Proyek (`backend/`)

```text
codexinternational/
├── docker-compose.yml                   # Infra DB & Cache di root (Postgres 17 + Valkey 9.1 AOF)
├── docker/valkey/valkey.conf
└── backend/
    ├── Cargo.toml                       # Main crate (+ workspace member lambda-video-compressor)
    ├── migrations/
    │   ├── 0001_init.sql                # DDL Fase 1 (PRD P§1.3)
    │   ├── 0002_user_uid.sql .. 0007_media_quality_tier.sql # Governance, on_duty, server menu & media tier
    │   ├── 0008_archive.sql             # DDL Task 2.7: archive_manifests, tombstones, wiped_users
    │   ├── 0009_managed_bots.sql        # DDL Fase 6: Managed Bot Pterodactyl (DEC-17)
    │   ├── 0010_billing.sql             # DDL Fase 7: plans, subscriptions, payments, ledger_entries, banned_device_hashes, banned_identities (PRD P§9.2)
    │   └── 0011_escrow_hackathon.sql    # DDL Fase 8: Escrow jobs/AC/disputes & Hackathon events (PRD P§9.4)
    ├── src/
    │   ├── main.rs                      # Bootstrap Axum + Workers
    │   ├── config.rs                    # Task 0.2 & 7.2: Baca .env & guardrails hard-fail (INV-13)
    │   ├── state.rs                     # Task 0.3: AppState (PgPool, Valkey, R2, Lambda, WsRegistry)
    │   ├── error.rs                     # Task 1.1: AppError -> HTTP JSON response
    │   ├── shared/                      # Task 1.4, 2.2, 3.1: Rate limiter, Valkey Lua, R2, Lambda invoker
    │   ├── auth/                        # Task 1.2–1.4, 7.5: Register, login, /me, JWT, refresh, OTP, OAuth2, bots, device ban
    │   ├── communities/                 # Task 1.5, 2.1, 7.4: Communities, roles bitmask, channels, DMs, Super Server
    │   ├── chat/                        # Task 2.3, 2.4, 2.6, 2.7: WS gateway, gap-sync, Hot/Cold archive, msg_flusher (250ms)
    │   ├── media/                       # Task 3.1, 3.3, 7.3: R2 presign, /complete, kuota harian/Jumbo, HMAC Lambda webhook
    │   ├── stories/                     # Task 4.1, 4.2: WA Status 24h, visibility, story_cleaner (1h)
    │   ├── gamification/                # Task 1.5, 2.5, 4.3: Contributions, XP->Level, counter_flusher (500ms)
    │   ├── notifications/               # Task 4.4: Smart FCM HTTP v1 dispatcher (< 10 menit rule)
    │   ├── billing/                     # Task 7.1–7.4: DOKU client, HMAC webhook, entitlements JSONB, Terompet, ledger
    │   ├── escrow/                      # Task 8.1–8.2: Escrow state machine, weighted AC, explicit on_duty BI-FAST release
    │   └── hackathon/                   # Task 8.3: Live prize pool Valkey, GitHub Org repo provisioner, rubric z-score
    ├── tests/                           # Integration & invariant tests
    └── lambda-video-compressor/         # Task 3.2 & 7.3: Crate terpisah AWS Lambda Rust + static FFmpeg
```

---

## FASE 0 — INFRASTRUKTUR LOKAL & WORKSPACE SCAFFOLDING (Task 0.1 – 0.3)

**Fokus Utama:** Menyiapkan container Postgres & Valkey 9.1, Cargo Workspace Rust (`edition = "2024"`), konfigurasi hard-fail guardrails (`INV-13`), dan probe `/health/*`.

### Task 0.1 — Docker Compose Development Stack (Postgres & Valkey 9.1)

- **Goal:** Menyediakan lingkungan lokal yang mereplikasi durabilitas AOF Valkey 9.1 (`appendonly yes`, `appendfsync everysec`) dan PostgreSQL 17.
- **Files:** `docker-compose.yml`, `.env.example`, `docker/valkey/valkey.conf`.
- **Dependencies:** Docker Engine terpasang.
- **Steps:**
  1. Konfigurasi service `postgres` (`postgres:17-alpine`, volume terpasang sesuai `.gitignore` di `./postgres-data/`) dengan healthcheck `pg_isready`.
  2. Konfigurasi service `valkey` (image `valkey/valkey:9.1-alpine`, custom `docker/valkey/valkey.conf` dengan `appendonly yes`, `appendfsync everysec`, `io-threads 4`) dan healthcheck `valkey-cli ping`.
  3. Lengkapi `.env.example` mencakup `DATABASE_URL`, `VALKEY_URL`, `JWT_SECRET`, `R2_*`, `AWS_LAMBDA_VIDEO_FN`, `LAMBDA_WEBHOOK_SECRET`, `FCM_PROJECT_ID`, dan `FCM_SERVICE_ACCOUNT_PATH`.
- **DoD:**
  - [x] `docker compose up -d` menyalakan Postgres & Valkey dengan status `healthy` (tervalidasi `docker compose config -q`).
  - [x] Restart container Valkey mempertahankan key AOF test yang ditulis sebelumnya (`appendonly yes` aktif di `valkey.conf`).

### Task 0.2 — Setup `Cargo.toml` & `src/config.rs` (`.env` + Hard-Fail Guardrails `INV-13`)

- **Goal:** Menyiapkan `backend/Cargo.toml` (dengan `lambda-video-compressor` sebagai workspace member) dan modul `src/config.rs` untuk membaca `.env` (via `dotenvy`) / OS env dengan validasi startup yang wajib *hard-fail* (`INV-13`) di mode `production`.
- **Files:** `backend/Cargo.toml`, `backend/src/config.rs`, `backend/tests/config_test.rs`.
- **Interfaces & Types:**

  ```rust
  #[derive(Debug, Clone)]
  pub struct AppConfig {
      pub env: AppEnv, // Development | Production
      pub bind_addr: String,
      pub database_url: String,
      pub valkey_url: String,
      pub jwt_secret: String,
      pub lambda_webhook_secret: String,
      pub msg_flush_interval_ms: u64,     // default 250
      pub counter_flush_interval_ms: u64, // default 500
      pub worker_roles: WorkerRoles,      // API | FLUSHER | FCM | CLEANER | ALL
  }
  ```

- **Dependencies:** `Task 0.1`.
- **Steps:**
  1. **Red:** Tulis unit test `test_inv13_production_hard_fail_on_empty_secret()` yang memvalidasi `AppConfig::validate()` gagal saat `env == Production` dan `jwt_secret` atau `lambda_webhook_secret` kosong.
  2. **Green:** Definisikan dependencies (`axum 0.8.9` fitur `ws`, `tokio` fitur `full`, `sqlx 0.9.0` fitur `runtime-tokio`/`tls-rustls-ring-webpki`/`postgres`/`uuid`/`chrono`/`migrate`, `fred 10.1.0`, `uuid 1.29.2`, `argon2 0.6.0`, `jsonwebtoken 11.1.0`, `aws-sdk-s3 1.57+`, `aws-sdk-lambda 1.50+`, `fcm_v1 0.3+`, `dotenvy`, `tracing`) dan implementasikan `AppConfig` di `src/config.rs`.
  3. **Refactor:** Pastikan secret dibungkus tipe yang menyensor `Debug` output (tidak bocor ke log).
- **DoD:**
  - [x] `cargo check --workspace` lolos tanpa error.
  - [x] `test_inv13_*` lulus.

### Task 0.3 — `AppState`, Konektor Postgres/Valkey & Health Probe

- **Goal:** Menginisialisasi `PgPool` (`sqlx`), dual koneksi Valkey (`fred::clients::Pool` + dedicated `fred::clients::SubscriberClient` sesuai `P§7` #2), serta rute `/health/live` dan `/health/ready`.
- **Files:** `backend/src/state.rs`, `backend/src/main.rs`, `backend/src/health.rs`.
- **Dependencies:** `Task 0.2`.
- **Steps:**
  1. **Red:** Tulis integration test yang memastikan `/health/ready` mengembalikan `503` saat Valkey/Postgres down dan `200 OK` saat keduanya terhubung.
  2. **Green:** Implementasikan builder `AppState`, `tracing-subscriber` JSON logging, dan handler `/health/live` + `/health/ready` (timeout ping 2s).
- **DoD:**
  - [x] Server boot dan `/health/ready` mengembalikan `200 OK` (atau `503` saat dependensi mati, terverifikasi di `tests/health_test.rs`).

### Phase Gate 0

- [x] `docker compose config -q` valid; `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, dan `cargo test` seluruhnya hijau.

---

## FASE 1 — DATABASE SCHEMA & AUTH MULTI-DEVICE FIRST (Task 1.1 – 1.5)

**Fokus Utama:** Urutan *user-first* agar frontend/client langsung bisa register, login, verifikasi Brevo OTP/OAuth2, refresh token, dan akses `/auth/me` sebelum fitur komunitas & chat dibangun.

### Task 1.1 — Migration SQL `0001_init.sql` & `AppError` (`INV-5`, `INV-6`, `INV-7`)

- **Goal:** Menjalankan migration SQL Fase 1 secara otomatis terhadap PostgreSQL dan menyiapkan `AppError` (`src/error.rs` -> HTTP JSON response) sebagai fondasi seluruh handler API.
- **Files:** `backend/migrations/0001_init.sql`, `backend/src/shared/db.rs`, `backend/src/error.rs`, `backend/tests/migration_test.rs`.
- **Dependencies:** `Phase Gate 0`.
- **Steps:**
  1. **Red:** Tulis integration test yang menguji: (a) menghapus `users` me-set `messages.sender_id = NULL` (`INV-5`), (b) insert balasan sebelum induk dalam satu transaksi `DEFERRABLE INITIALLY DEFERRED` sukses commit (`INV-6`), (c) duplikasi `dm_pair_key` ditolak oleh constraint (`INV-7`).
  2. **Green:** Tempatkan DDL dari `PRD.md P§1.3` ke `migrations/0001_init.sql`, hubungkan `sqlx::migrate!()`, dan implementasikan `AppError` -> Axum `IntoResponse`.
- **DoD:**
  - [x] Migration `0001_init.sql` ter-embed di `sqlx::migrate!()`, `AppError` teruji (`error_test.rs`), dan test invariant (`INV-5`, `INV-6`, `INV-7`) siap dijalankan di Postgres hidup (`migration_test.rs`).

### Task 1.2 — Auth Register, Login (Bounded Argon2id), JWT & `/auth/me`

- **Goal:** Membuka jalur login/register pertama kali agar dev frontend langsung bisa masuk: registrasi & login email/username dengan hashing Argon2id (`tokio::sync::Semaphore` + `spawn_blocking` + acquire timeout `2s` → `503 Retry-After`), penerbitan JWT Access Token 15 menit, dan extractor dasar `AuthUser` untuk `GET /api/v1/auth/me`.
- **Files:** `backend/src/auth/handlers.rs`, `backend/src/auth/password.rs`, `backend/src/auth/extractor.rs`, `backend/src/auth/repo.rs`, `backend/tests/auth_test.rs`.
- **Dependencies:** `Task 1.1`.
- **Steps:**
  1. **Red:** Tulis test registrasi sukses, duplikat email/username (`409`), login sukses, login password salah (`401`), `GET /api/v1/auth/me` (`200` / `401`), dan test bounded semaphore mengembalikan `503` saat slot Argon2id penuh melewati timeout.
  2. **Green:** Implementasikan `PasswordHasher` ber-`Semaphore` (mis. `max(4, num_cpus)` slot) di `spawn_blocking`, `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, dan `GET /api/v1/auth/me`.
- **DoD:**
  - [x] Dev frontend sudah bisa register, login, dan memanggil `/auth/me` dengan JWT valid (`auth_test.rs`).

### Task 1.3 — Stateful Refresh Token, Device Registry, Brevo SMTP OTP & OAuth2 (`INV-16`)

- **Goal:** Melengkapi seluruh flow masuk & sesi user: refresh token rotation per-device (`user_devices`), deteksi token reuse, update `fcm_token`, login OAuth2 (GitHub/Google), serta pengiriman & verifikasi **Brevo SMTP OTP** (`lettre` ke `smtp-relay.brevo.com:587` sebagai custom domain, hash SHA-256 di Valkey `auth:otp:{purpose}:{email_sha256}` TTL 5 menit, maks 5× salah, cooldown exponential backoff `60s -> 120s -> 240s -> ...` dengan reset 24 jam).
- **Files:** `backend/src/auth/handlers.rs`, `backend/src/auth/devices.rs`, `backend/src/auth/oauth.rs`, `backend/src/auth/otp.rs`.
- **Dependencies:** `Task 1.2`.
- **Steps:**
  1. **Red:** Tulis test rotasi refresh token, test replay token lama memicu pencabutan seluruh sesi device (`revoked_at`), mock test exchange OAuth2 GitHub/Google, serta test OTP (`send` menerapkan exponential backoff + `Retry-After`, `verify` hangus setelah 5× salah dan mengeset `email_verified_at`, `INV-16`).
  2. **Green:** Implementasikan `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`, `PUT /api/v1/devices/fcm`, `POST /api/v1/auth/oauth/{provider}`, `POST /api/v1/auth/otp/send`, dan `POST /api/v1/auth/otp/verify`.
- **DoD:**
  - [x] Replay refresh token terdeteksi (`401`), `register_fcm` & `oauth` terpasang, dan `test_inv16_otp_exponential_backoff_and_max_attempts` terverifikasi (`auth_task13_test.rs`).

### Task 1.4 — Global Exponential Backoff Rate Limiter (24h Reset) & Bot `AuthPrincipal` (`INV-15`, `INV-16`)

- **Goal:** Memperluas extractor menjadi `AuthPrincipal` (`User` JWT + `Bot` `Authorization: Bot <token>` dengan `privilege_mode` ala `chmod`: `1=READ`, `2=WRITE`, `4=MOD`, `8=ADMIN`), menolak user berstatus `suspend:user:{uid}`, endpoint pengajuan/approval bot oleh `dev`, serta memasang **Global Exponential Backoff Rate Limiter** di seluruh route API (cooldown meningkat eksponensial tiap pelanggaran dan **otomatis reset ke default setelah 24 jam**, `rl:backoff:{scope}:{key}` TTL `86400s`, header `Retry-After`).
- **Files:** `backend/src/auth/extractor.rs`, `backend/src/auth/bots.rs`, `backend/src/shared/rate_limit.rs`.
- **Dependencies:** `Task 1.3`.
- **Steps:**
  1. **Red:** Tulis test token expired (`401`), test `Authorization: Bot <token>` ditolak bila bot masih `PENDING`/`REJECTED` (`403`, `INV-15`), test non-`dev` (termasuk `Superadmin` komunitas) dilarang meng-approve bot atau membuat/menaikkan bot ke bit `8` (`BOT_ADMIN`, `403`), test user ter-suspend ditolak (`403`, `INV-15`), dan test `test_inv16_global_rate_limit_exponential_backoff_24h_reset()`.
  2. **Green:** Implementasikan `AuthPrincipal` (`User` vs `Bot`), endpoint `POST /api/v1/bots`, `POST /api/v1/dev/bots/{id}/review` (khusus `dev`), `/api/v1/bots/{id}/tokens`, dan Valkey Lua global sliding-window + exponential backoff rate limiter layer di seluruh router API.
- **DoD:**
  - [x] Global rate limiter aktif di seluruh route `/api/v1/*`, `AuthPrincipal` (User JWT + Bot `chmod`) terpasang, dan `INV-15`/`INV-16` teruji (`auth_task14_test.rs`).

### Task 1.5 — Domain Helpers: Permission Bitmask & XP Level Formula

- **Goal:** Menyediakan tipe domain murni untuk permission bitmask komunitas dan kalkulasi level XP sebagai persiapan langsung memasuki Fase 2.
- **Files:** `backend/src/communities/permissions.rs`, `backend/src/gamification/level.rs`.
- **Interfaces & Types:**

  ```rust
  pub const PERM_VIEW_CHANNEL: i64 = 1 << 0;
  pub const PERM_SEND_MESSAGES: i64 = 1 << 1;
  pub const PERM_MANAGE_MESSAGES: i64 = 1 << 2;
  pub const PERM_MENTION_EVERYONE: i64 = 1 << 3;
  pub const PERM_MANAGE_CHANNELS: i64 = 1 << 4;
  pub const PERM_MANAGE_ROLES: i64 = 1 << 5;
  pub const PERM_MODERATE_CONTRIBUTIONS: i64 = 1 << 6;
  pub const PERM_ADMINISTRATOR: i64 = 1 << 7;
  pub const PERM_MODERATE_MEMBERS: i64 = 1 << 8;

  pub fn calculate_level(xp: i64) -> i32;
  ```

- **Dependencies:** `Task 1.4`.
- **Steps:**
  1. **Red:** Tulis unit test untuk `has_permission()` (termasuk bypass `PERM_ADMINISTRATOR`), validasi hierarki `position`, dan `calculate_level(xp)`.
  2. **Green:** Implementasikan bitmask helper dan level calculator.
- **DoD:**
  - [ ] Unit test domain 100% lulus.

### Phase Gate 1

- [ ] Seluruh migration, domain test, auth flow, dan rate limiter hijau via `cargo test --workspace`.

---

## FASE 2 — MULTI-COMMUNITY, CHANNELS, DM, HYBRID WRITE-BEHIND CHAT & ARCHIVE (Task 2.1 – 2.7)

**Fokus Utama:** Membangun model server/channel ala Discord + DM 1-on-1, mesin real-time chat Valkey Streams (`250ms`) + Hot Counter Write-Behind (`500ms`) + Gap-Sync, serta arsitektur arsip hot/cold R2 (`before_seq` & Tombstone Overlay).

### Task 2.1 — Community, Role Bitmask, Guardrail Moderation & DM (`INV-7`, `INV-15`)

- **Goal:** Menyediakan CRUD komunitas, invite code join (blokir bila ter-ban), instalasi bot `APPROVED` khusus oleh `Superadmin` komunitas (`POST /api/v1/communities/{id}/bots/{bot_id}`, tolak bila `PENDING`/`REJECTED`), manajemen role & hierarki posisi (`Superadmin` [pembuat komunitas] > `Admin` > `Moderator` > `@everyone`), moderasi (`timeout`, `ban`, `unban` oleh user `PERM_MODERATE_MEMBERS` atau Bot mode `4`+ dengan proteksi terhadap `Superadmin`, serta global `suspend` oleh `dev` atau Bot `ADMIN` mode `8`+), multi-channel (`text`, `announcement`), dan pembuatan DM 1-on-1 idempoten (`INV-7`).
- **Files:** `backend/src/communities/handlers.rs`, `backend/src/communities/channels.rs`, `backend/src/communities/moderation.rs`, `backend/src/communities/repo.rs`.
- **Dependencies:** `Phase Gate 1`.
- **Steps:**
  1. **Red:** Tulis integration test: pembuatan komunitas auto-membuat role `Superadmin` (pembuat komunitas) + `Admin` + `@everyone` + `#general`, `Admin` dilarang kick/ban/demote `Superadmin` (`403`, `INV-15`), user yang di-ban tidak bisa join ulang lewat `invite_code` (`403`, `INV-15`), user yang di-timeout ditolak saat `SEND_MESSAGE` (`403`), assignment role melampaui posisi sendiri ditolak `403`, dan dua request paralel `POST /dms/{target}` menghasilkan satu `channel_id` identik (`INV-7`).
  2. **Green:** Implementasikan seluruh endpoint community, role, moderation (`timeout`/`ban`/`unban`/`suspend` + cache Valkey TTL), channel, DM, notification preferences, dan cache `perm:comm:{cid}:{uid}` di Valkey.
- **DoD:**
  - [x] Seluruh permission check, moderasi komunitas (`timeout`/`ban`/`unban`), & `INV-7` DM uniqueness test lulus *(instalasi bot komunitas ditunda)*.

### Task 2.2 — Valkey Lua Scripts: Atomic `seq_id`, Cold-Start Seeding & Idempotency (`INV-2`, `INV-3`, `INV-4`)

- **Goal:** Menjamin penomoran pesan atomik dan idempoten tanpa celah di bawah konkurensi tinggi.
- **Files:** `backend/src/shared/valkey_lua.rs`, `backend/tests/valkey_lua_test.rs`.
- **Dependencies:** `Task 2.1`.
- **Steps:**
  1. **Red:** Tulis concurrent test 100 task ke channel yang sama (termasuk skenario `FLUSHDB` Valkey sebelum kirim pesan untuk mensimulasikan cold-start) dan verifikasi `seq_id` berurutan sempurna tanpa duplikat (`INV-3`), duplicate `client_msg_id` mengembalikan ACK yang sama (`INV-2`), serta `wb:read` tidak pernah mundur (`INV-4`).
  2. **Green:** Tulis Lua script `msg_enqueue.lua` (idempotency + `INCR` dengan fallback code `NEED_SEED`), single-flight lock `lock:seed:seq:{channel_id}`, serta `mark_read_max.lua`.
- **DoD:**
  - [ ] `test_inv2_*`, `test_inv3_*`, dan `test_inv4_*` lulus pada 100+ concurrent futures.

### Task 2.3 — WebSocket Gateway (`/ws`), Auth Frame & Pub/Sub Fan-Out (`INV-14`)

- **Goal:** Menyediakan WebSocket server terpisah dari timeout middleware (`INV-14`), autentikasi frame pertama `AUTH` (`access_token` atau `bot_token`), `WsRegistry`, fan-out lintas node lewat Valkey Pub/Sub (`fred::clients::SubscriberClient`), dan pemutusan sesi aktif saat `USER_KICKED` / `USER_SUSPENDED` (`INV-15`).
- **Files:** `backend/src/chat/ws.rs`, `backend/src/chat/protocol.rs`, `backend/src/chat/registry.rs`.
- **Dependencies:** `Task 2.2`.
- **Steps:**
  1. **Red:** Tulis test WS: koneksi tanpa `AUTH` dalam 5s diputus, koneksi tidak ter-drop setelah idle (heartbeat `PING`/`PONG`, tanpa `TimeoutLayer`, `INV-14`), `AUTH` via `bot_token` diterima dan pesan bot membawa `sender_type = "bot"` (`sender_bot_id` pada `messages`), serta sesi WS terputus otomatis saat user di-ban/suspend (`INV-15`).
  2. **Green:** Implementasikan `/ws` handler, `SEND_MESSAGE`, `TYPING_START`, `MARK_READ`, `FOCUS_CHANNEL` (mengatur `ws:active:{uid}:{cid}` untuk `INV-9`), serta pembaruan `presence:user:{uid}` & `users:last_seen`.
- **DoD:**
  - [ ] Fan-out WS real-time berjalan dengan dua subscriber terpisah.

### Task 2.4 — Tier A Worker: Message Flusher (`250ms`, `INV-1`, `INV-6`)

- **Goal:** Mem-flush pesan dari `stream:messages` (`XREADGROUP pg_flusher`) ke PostgreSQL secara micro-batch tiap **250ms** (atau max 1.000 pesan/batch) dengan recovery `XAUTOCLAIM`.
- **Files:** `backend/src/chat/flusher.rs`, `backend/tests/msg_flusher_test.rs`.
- **Dependencies:** `Task 2.3`.
- **Steps:**
  1. **Red:** Tulis integration test: (a) simulasi reply ke pesan dalam batch yang sama (`INV-6`), (b) matikan/restart worker setelah `XREADGROUP` sebelum `XACK` lalu pastikan `XAUTOCLAIM` menyelamatkan seluruh pesan tanpa duplikat (`INV-1`).
  2. **Green:** Implementasikan `XREADGROUP` + `UNNEST` batch `INSERT INTO messages ... ON CONFLICT (client_msg_id) DO NOTHING` + update `channels.last_seq_id = GREATEST(...)` dalam 1 transaksi Postgres, lalu `XACK` + `XDEL` + DLQ handling, serta final flush saat menerima sinyal graceful shutdown (`SIGTERM`/`CancellationToken`).
- **DoD:**
  - [ ] `test_inv1_*` dan `test_inv6_*` lulus 100%.

### Task 2.5 — Tier B Worker: Hot Counter Flusher (`500ms`, `INV-4`)

- **Goal:** Mem-flush hot counters (`last_read_seq_id`, `xp` komunitas & global, `story_views`, `contribution_likes`, `users.last_seen_at`) dari Valkey ke Postgres tiap **500ms**.
- **Files:** `backend/src/gamification/flusher.rs`, `backend/tests/counter_flusher_test.rs`.
- **Dependencies:** `Task 2.4`.
- **Steps:**
  1. **Red:** Tulis test atomic swap XP (tidak kehilangan increment yang masuk bersamaan di tengah flush) dan `GREATEST` pada `last_read_seq_id` (`INV-4`).
  2. **Green:** Implementasikan Lua atomic `HGETALL` + `DEL` / `RENAME` per domain counter, batch SQL update, kalkulasi ulang `level` dari `calculate_level(xp)`, serta final flush saat graceful shutdown (`SIGTERM`/`CancellationToken`).
- **DoD:**
  - [x] Seluruh counter tersinkron ke Postgres secara akurat tanpa race condition.

### Task 2.6 — Gap-Sync Protocol & Message Edit/Delete (`INV-12`)

- **Goal:** Menyediakan endpoint `GET /api/v1/channels/{id}/messages` dan WS `SUBSCRIBE_CHANNELS` gap-sync (`after_seq`) yang membaca Postgres **plus** tail `stream:messages` (`INV-12`), serta edit/soft-delete pesan.
- **Files:** `backend/src/chat/handlers.rs`, `backend/src/chat/repo.rs`.
- **Dependencies:** `Task 2.4`.
- **Steps:**
  1. **Red:** Tulis test kirim pesan lalu langsung panggil `after_seq` dalam `< 50ms` (sebelum batch 250ms masuk Postgres) dan pastikan pesan tetap muncul berurutan (`INV-12`).
  2. **Green:** Implementasikan query gabungan Postgres + tail stream reader, serta `PATCH`/`DELETE /api/v1/messages/{id}` dengan broadcast Pub/Sub.
- **DoD:**
  - [ ] `test_inv12_gap_sync_includes_unflushed_tail` lulus.

### Task 2.7 — Tiered Message Archive (`before_seq`), Tombstone Overlay & R2 Media Retention (`DEC-18`, `P§8`)

- **Goal:** Mengimplementasikan arsip hot/cold pesan berumur `>= 1 tahun` ke R2 Infrequent Access (`archive/{channel_id}/{min_seq}_{max_seq}.jsonl.zst`), pagination `before_seq` (Hot Path, Boundary Crossing, Cold Path) via stateless streaming `async-compression` (`zstd`, tanpa cache Valkey), **Tombstone Overlay** (`archive_tombstones` + `wiped_archive_users`, zero R2 rewrite), serta worker retensi media R2 `> 3 bulan` (menandai `media_assets.status = 'EXPIRED'`).
- **Files:** `backend/migrations/0008_archive.sql`, `backend/src/chat/archive.rs`, `backend/src/chat/cleaner.rs`, `backend/tests/archive_test.rs`.
- **Dependencies:** `Task 2.6`.
- **Steps:**
  1. **Red:** Tulis integration test: (a) Hot Path mengembalikan 50 baris tanpa menyentuh R2, (b) Boundary Crossing menggabungkan `< 50` baris DB + sisa dari stream `jsonl.zst` secara urut `before_seq`, (c) `USER_DELETED` & `wiped_archive_users` di-skip sedangkan `MOD_REMOVED` diganti placeholder tanpa mengubah file R2, (d) media berumur `> 3 bulan` dihapus dari R2 & diset `EXPIRED` sementara baris teks pesan tetap utuh.
  2. **Green:** Implementasikan tabel `archive_manifests`, `archive_tombstones`, `wiped_archive_users`, handler `before_seq` dengan `tokio::join!` filter-on-read `HashMap`/`HashSet`, serta worker cleaner ber-distributed lock. (Pengecualian retensi untuk `Super Server` dan DM berlangganan dihubungkan penuh pada `Task 7.4`.)
- **DoD:**
  - [x] `archive_test.rs` lulus 100% untuk Hot Path, Boundary Crossing, Cold Path, Tombstone Overlay, dan retensi media `> 3 bulan`.

### Phase Gate 2

- [ ] Chat multi-community, channel, DM, Outbox idempotency, gap-sync, Hot/Cold archive (`before_seq`), dan kedua worker write-behind (250ms/500ms) lolos seluruh unit & integration test.

---

## FASE 3 — PIPELINE MEDIA BASELINE: CLOUDFLARE R2 + AWS LAMBDA RUST (Task 3.1 – 3.3)

**Fokus Utama:** Mengamankan upload gambar & video langsung ke **Cloudflare R2** (tanpa AWS S3) serta transcoding video asynchronous melalui **AWS Lambda Rust + FFmpeg** (baseline Fase 1 `standard`/`pro`; di-upgrade ke ladder `Free`/`Super`/`sudo` + Slot Jumbo + cutoff `/raw` di `Task 7.3`).

### Task 3.1 — R2 Presigner Service, Quality Tier Baseline & Zip Bomb Guard (`INV-8`, Gotcha `P§7` #1)

- **Goal:** Mengimplementasikan `POST /api/v1/media/presign`, `POST /api/v1/media/{id}/complete` (`HeadObject` verification termasuk cek `content_length` sesuai `quality_tier` baseline), dan `ZipBombGuard` streaming pada upload file/arsip (`kind = 'file'`).
- **Files:** `backend/src/media.rs`, `backend/tests/media_test.rs`.
- **Dependencies:** `Phase Gate 2`.
- **Steps:**
  1. **Red:** Tulis test validasi limit ukuran & durasi per `quality_tier` baseline (`standard` vs `pro`), test MIME type (`image/*`, `video/mp4`, `video/webm`, `video/quicktime`, dokumen/arsip), test `ZipBombGuard` (tolak rasio tinggi, total bytes aktual `> 250 MB`, entry `> 1.000`, nested zip `> 1` level), verifikasi `Content-Type` & `Cache-Control` parity saat presigning R2 (`P§7` #1), dan penolakan `/complete` bila objek belum ada di R2 (`400`/`404`) atau ukuran aktual melebihi batas (`INV-8`).
  2. **Green:** Konfigurasi R2 presigner (`region("auto")` + endpoint override), `QualityTier`, `ZipBombGuard`, serta handler `presign`, `complete`, dan `upload`.
- **DoD:**
  - [x] Presigned PUT URL ter-generate valid untuk gambar, video (`raw/videos/`), maupun file di R2; validasi `quality_tier` + batas durasi video per tier serta `ZipBombGuard` lulus unit test.

### Task 3.2 — Crate Compressor Lambda Baseline (Rust + Image Limits + FFmpeg Video Bomb Guard)

- **Goal:** Membangun AWS Lambda worker berbasis `lambda_runtime` + `aws-sdk-s3` (pointed ke R2) + static `ffmpeg`, `+faststart` + thumbnail WebP, pertahanan **Image Bomb** (`ImageReader` + `Limits`) dan **Video Bomb** (`ffprobe` pre-flight timeout `10s`, hard flags `-map 0:v:0 -map 0:a:0?`, `-t`, `-fs`, `-max_muxing_queue_size 1024`, timeout + `kill()` + cleanup `/tmp`, stream R2 ke `/tmp`, `DeleteObject` + webhook `FAILED` jika bomb terdeteksi).
- **Files:** `backend/lambda-light-media-compressor/src/compressor.rs`, `backend/lambda-light-media-compressor/src/zip_guard.rs`, `backend/lambda-video-compressor/src/video.rs`, `backend/lambda-video-compressor/src/main.rs`.
- **Dependencies:** `Task 3.1`.
- **Steps:**
  1. **Red:** Tulis unit test untuk `ImageReader` `Limits`, parser metadata `ffprobe`, penolakan Video Bomb (resolusi ekstrem `> 4096` / `> 8_294_400` px, durasi melebihi batas tier, `nb_streams > 4`, FPS abnormal), dan generator argumen FFmpeg baseline.
  2. **Green:** Implementasikan `compressor.rs` (`Limits` anti image bomb) dan `video.rs` (`QualityTier`, `validate_ffprobe_metadata`, `build_ffmpeg_args`). Siapkan target build **ARM64 (Graviton2)** via `cargo-lambda`.
- **DoD:**
  - [x] `cargo test` di `lambda-light-media-compressor` & `lambda-video-compressor` bersih untuk image limits, `ffprobe` video bomb guard, dan profil FFmpeg baseline.

### Task 3.3 — Internal HMAC Media Callback & WS `MEDIA_READY` (`INV-8`)

- **Goal:** Menangani callback dari AWS Lambda secara aman (`HMAC-SHA256` constant-time verify + replay timestamp window `<= 5 menit`), memperbarui status `media_assets` (`READY` dengan `/compressed/` atau `FAILED` dengan `error_reason`), dan memancarkan `MEDIA_READY` lewat Valkey Pub/Sub.
- **Files:** `backend/src/media.rs`, `backend/src/lib.rs`, `backend/tests/media_test.rs`.
- **Dependencies:** `Task 3.2`.
- **Steps:**
  1. **Red:** Tulis test penolakan signature invalid (`401`), timestamp kadaluarsa > 5 menit (`401`), dan test verifikasi HMAC valid (`INV-8`).
  2. **Green:** Implementasikan handler `POST /internal/v1/media/ready` dengan constant-time signature check (`subtle`).
- **DoD:**
  - [x] `test_inv8_hmac_webhook_verification` lulus.

### Phase Gate 3

- [ ] End-to-end media pipeline (Client AVIF/WebP R2 image + Video `/raw` -> Lambda Rust -> `/compressed/` + `Cache-Control` immutable -> HMAC callback -> WS `MEDIA_READY`) terverifikasi.

---

## FASE 4 — STORIES (WA STATUS 24H), GAMIFICATION & SMART FCM (Task 4.1 – 4.4)

**Fokus Utama:** Melengkapi fitur Fase 1: WA Status Stories dengan visibilitas fleksibel & cleanup R2 per jam, Gamification (`contributions` + leaderboard), dan Smart FCM Push (`< 10 menit` rule).

### Task 4.1 — WA Status Stories API & Visibility Filter (`INV-11`)

- **Goal:** Mengimplementasikan pembuatan story 24 jam dengan visibilitas (`public`, `all_communities`, `selected_communities`, `contacts`), feed terfilter, `story_views` (via Valkey Tier B), daftar viewer khusus author, serta reply story ke DM.
- **Files:** `backend/src/stories/handlers.rs`, `backend/src/stories/repo.rs`.
- **Dependencies:** `Phase Gate 3`.
- **Steps:**
  1. **Red:** Tulis integration test: story `selected_communities` tidak bocor ke non-member, story expired (`expires_at <= NOW()`) tidak tampil (`INV-11`), dan `GET /stories/{id}/viewers` oleh non-author ditolak `403`.
  2. **Green:** Implementasikan endpoint CRUD/feed/view/viewers story dan validasi `reply_to_story_id` saat kirim DM.
- **DoD:**
  - [ ] Seluruh skenario visibilitas & proteksi viewer lulus.

### Task 4.2 — Hourly Story & Media Cleanup Worker (`INV-11`)

- **Goal:** Membersihkan story yang sudah melewati `expires_at` beserta objek media R2 terkait setiap jam agar tidak menumpuk di database maupun object storage.
- **Files:** `backend/src/stories/cleaner.rs`, `backend/tests/story_cleaner_test.rs`.
- **Dependencies:** `Task 4.1`.
- **Steps:**
  1. **Red:** Tulis test yang memastikan story expired memanggil `delete_object` R2 sebelum menghapus baris DB, sedangkan story aktif (`expires_at > NOW()`) tidak tersentuh (`INV-11`).
  2. **Green:** Implementasikan cron interval 1 jam dengan distributed Valkey lock agar hanya 1 node worker yang menjalankan sweep pada siklus yang sama.
- **DoD:**
  - [ ] Zero orphan media R2 untuk story expired pada test suite.

### Task 4.3 — Contributions, Moderation, Auto-XP & Leaderboard

- **Goal:** Mengimplementasikan submission `contributions` (`COMMIT`, `PR`, `POST`, `HELP`, `IDEA`), review oleh moderator (`MODERATE_CONTRIBUTIONS`), like kontribusi (Valkey Tier B), auto-XP chat ber-cooldown (`60s`), dan leaderboard komunitas.
- **Files:** `backend/src/gamification/handlers.rs`, `backend/src/gamification/repo.rs`.
- **Dependencies:** `Task 2.5`.
- **Steps:**
  1. **Red:** Tulis test: approval oleh member biasa ditolak `403`, approval oleh moderator menambah delta XP ke Valkey Tier B, auto-XP dibatasi maksimal 1x per 60 detik per user, dan `proof_url` yang mengarah ke IP privat/loopback (`127.0.0.1`, `169.254.169.254`) ditolak oleh validator anti-SSRF (`400`).
  2. **Green:** Implementasikan seluruh endpoint `contributions`, validator URL anti-SSRF (`P§7` #9), dan leaderboard query (`ORDER BY xp DESC`).
- **DoD:**
  - [ ] Approval kontribusi & auto-XP memperbarui leaderboard secara akurat melalui `counter_flusher`.

### Task 4.4 — Smart FCM HTTP v1 Dispatcher (`INV-9`, `INV-10`)

- **Goal:** Mengirim push notification melalui `fcm_v1` (OAuth2 Service Account) dengan suppression device aktif (`INV-9`) dan aturan **offline `< 10 menit`** untuk tag non-individual `@all`/`@everyone` (`INV-10`).
- **Files:** `backend/src/notifications/dispatcher.rs`, `backend/src/notifications/fcm.rs`, `backend/tests/fcm_dispatcher_test.rs`.
- **Dependencies:** `Task 2.3`, `Task 1.4`.
- **Steps:**
  1. **Red:** Tulis unit/integration test:
     - `test_inv9_suppress_fcm_when_ws_active_in_channel()`
     - `test_inv10_skip_non_individual_all_tag_when_offline_ge_10m()` (verifikasi user offline 5 menit **dikirim**, user offline 12 menit **dilewati**, sedangkan mention `@user` / DM tetap dikirim walau offline 12 menit).
     - Test pembersihan `fcm_token` saat FCM merespons `UNREGISTERED`.
  2. **Green:** Implementasikan consumer group `fcm_worker` pada `stream:messages`, evaluator filter, dan pengirim HTTP v1.
- **DoD:**
  - [ ] Seluruh test `INV-9` & `INV-10` lulus.

### Phase Gate 4

- [ ] Seluruh fitur Fase 1 (`Stories`, `Contributions`, `Smart FCM`) lolos test fungsional dan invariant tanpa regresi.

---

## FASE 5 — INTEGRATION SUITE, LOAD TEST RIBUAN MPS & HARDENING (Task 5.1 – 5.2)

**Fokus Utama:** Memvalidasi target non-fungsional (`>= 2.000 MPS`, `< 50ms p95` WS fan-out) serta kesiapan produksi.

### Task 5.1 — Full End-to-End Integration & Concurrency Suite

- **Goal:** Menjalankan suite integration test lintas modul terhadap container PostgreSQL dan Valkey 9.1 nyata.
- **Files:** `backend/tests/e2e_flow.rs`.
- **Dependencies:** `Phase Gate 4`.
- **Steps:**
  1. Uji alur lengkap: Register → Create Community → Join Invite → Connect WS → Send 500 pesan paralel + Reply + Mark Read → Reconnect Gap-Sync → Upload Media Mock → Post & View Story → Approve Contribution → Cek XP & Leaderboard.
- **DoD:**
  - [ ] `cargo test --workspace` seluruhnya hijau tanpa test yang di-skip.

### Task 5.2 — Load Test `>= 2.000 MPS` & Observability Check

- **Goal:** Membuktikan jalur chat + Valkey Hybrid Write-Behind sanggup bertahan di `>= 2.000 MPS` tanpa backlog `stream:messages` menumpuk atau error Postgres.
- **Files:** `backend/scripts/loadtest_mps.js` (k6 WebSocket/REST script).
- **Dependencies:** `Task 5.1`.
- **Steps:**
  1. Jalankan load test minimal `2.000 MPS` selama 60 detik lintas beberapa channel.
  2. Pantau `XLEN stream:messages`, `XPENDING stream:messages pg_flusher`, latensi transaksi batch 250ms Postgres, serta latensi WS p95/p99.
  3. Verifikasi jumlah baris di tabel `messages` Postgres sama persis dengan total `MESSAGE_ACK` sukses (0 pesan hilang).
  4. **Optimasi Infra VPS Produksi (Shell):**
     - Matikan `docker-proxy` userland agar akses loopback `127.0.0.1:5432` / `6379` langsung tanpa overhead proxy:

       ```bash
       echo '{"userland-proxy": false}' | sudo tee /etc/docker/daemon.json
       sudo systemctl restart docker
       sudo systemctl restart codexter-backend
       ```

     - Aktifkan `pg_stat_statements` di PostgreSQL untuk profiling query:

       ```bash
       docker exec -i codexter-postgres psql -U codexter -d codexinternational -c "ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements'" -c "ALTER SYSTEM SET pg_stat_statements.track = 'all'"
       docker restart codexter-postgres
       docker exec -i codexter-postgres psql -U codexter -d codexinternational -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements"
       ```

- **DoD:**
  - [ ] Sustained `>= 2.000 MPS` stabil, WS fan-out `p95 < 50ms`, backlog stream terkuras habis dalam `<= 1 detik` setelah beban berhenti, dan `count(messages) == count(ACK)`.

### Phase Gate 5 (Release Readiness Fase 1)

- [ ] `cargo fmt --check`, `cargo clippy --workspace --all-targets --all-features -- -D warnings`, `cargo test --workspace`, dan hasil load test `>= 2.000 MPS` tercatat lulus penuh.

---

## FASE 6 — ADD-ON & MONETISASI: MANAGED BOT HOSTING VIA PTERODACTYL (Task 6.1)

**Fokus Utama:** Provisioning otomatis container bot berbayar melalui **Pterodactyl Application API** pada VPS/node Wings yang terpisah dari VPS inti (`DEC-17`).

### Task 6.1 — Integrasi Pterodactyl Application API (`create` / `suspend` / `delete`)

- **Goal:** Menyediakan modul backend untuk membuat, men-suspend, dan menghapus server bot di panel Pterodactyl secara idempoten (`external_id = bot_id`) bagi bot yang sudah berstatus `APPROVED` (`INV-15`) dan memiliki langganan add-on aktif (terhubung dengan entitlements Fase 7).
- **Files:** `backend/migrations/0009_managed_bots.sql`, `backend/src/bots/pterodactyl.rs`, `backend/tests/pterodactyl_test.rs`.
- **Dependencies:** `Phase Gate 5` (dan entitlements dari `Task 7.1`–`7.2` sebelum diaktifkan ke publik).
- **Steps:**
  1. **Schema:** Buat tabel `managed_bot_deployments` (`bot_id` PK/FK, `pterodactyl_server_id` BIGINT UNIQUE, `pterodactyl_identifier` VARCHAR, `plan_tier`, `status` [`PROVISIONING` | `ACTIVE` | `SUSPENDED` | `DELETED`], `created_at`, `updated_at`) tanpa menyimpan plaintext `CODEXTER_BOT_TOKEN`.
  2. **Red:** Tulis integration test dengan mock HTTP server Pterodactyl: bot `PENDING`/`REJECTED` ditolak `403` (`INV-15`), `PTERODACTYL_APP_KEY` tidak pernah bocor di `Debug`/log, dan retry provisioning dengan `bot_id` sama bersifat idempoten.
  3. **Green:** Implementasikan `PterodactylClient` (`reqwest`, `Authorization: Bearer <PTERODACTYL_APP_KEY>`) untuk `POST /api/application/servers`, `POST /api/application/servers/{id}/suspend`, `unsuspend`, dan `DELETE /api/application/servers/{id}`, plus injeksi env `CODEXTER_BOT_TOKEN` & `CODEXTER_BOT_ID` langsung ke container saat pembuatan.
- **DoD:**
  - [ ] Node Wings berada di VPS terpisah dengan isolasi network (blokir loopback/IP privat/metadata `169.254.169.254`) serta limit CPU/RAM/Disk/PID aktif, dan seluruh test `pterodactyl_test` lulus.

---

## Platform Governance, On-Duty Mode & 30-Day Audit Logs

- [x] **Platform Badge & Hierarchy Weighting (`backend/src/auth/dev_governance.rs`, `backend/src/auth/uid.rs`):**
  - Kolom `users.platform_badge` (`Founder` 100 > `Vice Founder` 80 > `Senior Admin` 60 > `Admin` 40 > `Moderator` 20 > `dev` 10).
  - `assign_reserved_uid` memblokir `dev` dengan bobot lebih rendah/setara agar tidak bisa memodifikasi akun dengan bobot lebih tinggi.
- [x] **Dev On-Duty Server Intercept (`POST /api/v1/dev/on-duty/start`, `POST /api/v1/dev/on-duty/stop`):**
  - Mode On-Duty sementara (default 60 menit, max 240 menit) per `community_id`, atau `scope = 'global'` (`community_id IS NULL`) untuk aksi platform (escrow release, unban device, global suspend), dengan `reason` wajib.
- [x] **30-Day Audit Logs (`GET /api/v1/dev/audit-logs`, `GET /api/v1/communities/{id}/audit-logs`):**
  - Semua log otomatis expire setelah 30 hari (`expires_at = NOW() + INTERVAL '30 days'`, diperpanjang menjadi 90 hari untuk komunitas `Super Server` pada `Task 7.4`).
  - Member server bisa melihat log server mereka sendiri; sesama `dev` bisa melihat seluruh shared logs.
- [ ] **Admin Panel (On-Duty Only) & Broadcast Log:**
  - Buat Admin Panel di frontend yang hanya aktif/terbuka saat `dev` sedang dalam status **On Duty** (sekaligus menjadi tempat eksekusi *Release* Escrow `Task 8.2` dan Unban Perangkat `Task 7.5`).
  - Saat satu `dev` mengaktifkan **On Duty**, sistem memicu **log broadcast** real-time (beserta `reason`) ke semua akun ber-role `dev` dan ke server (`community_id`) yang sedang dikunjungi/di-intercept.

---

## FASE 7 — AI NATIVE (DEEPSEEK V4.1 FLASH MULTI-KEY POOL & 5 FITUR AI)

- [x] **Task 10.1 — Migrasi `0013_ai_native.sql`, Multi-Key Pool & Dev Panel AI Keys (`backend/src/ai/keys.rs`, `frontend/src/components/views/DevAiPanel.tsx`):**
  - Tabel `ai_api_keys` (masking `key_preview`, `weight`, `is_active`, `cooldown_until`, tracking `total_requests` & token).
  - Weighted round-robin load balancer + auto-cooldown 60s failover pada `429`/`5xx`, serta tab **AI Keys & Limits** di `DevPanelView.tsx`.
- [x] **Task 10.2 — Pricing & Quota Guard Add-On (`backend/src/ai/quotas.rs`):**
  - Acuan DeepSeek v4.1 Flash (`1M` context, `2500` concurrency, Cache Hit/Miss, Output, Search/Fetch, OCR, ASR) dengan kuota Valkey per tier (`free`, `super`, `sudo`, `dev`) dan endpoint `GET /api/v1/ai/limits`.
- [x] **Task 10.3 — 5 Fitur AI Native (`backend/src/ai/features.rs`, `frontend/src/components/chat/AiAssistantBar.tsx`):**
  - **Catch Me Up:** `POST /api/v1/ai/channels/{id}/catch-me-up` (cache Valkey `ai:summary:*` 10 menit, unread range Postgres + tail `stream:messages`).
  - **Smart Semantic Search:** `GET /api/v1/ai/search` + background indexer non-blocking `spawn_index_content` (`ai_message_embeddings`).
  - **Auto-Triage Moderasi:** `spawn_auto_triage` (`tokio::spawn` saat `create_content_report`) + `GET /api/v1/dev/ai/triage`.
  - **Slash Command AI:** `POST /api/v1/ai/channels/{id}/command` (`/ai`, `/ask`, `/summarize`, `/translate`, `/code`).
  - **Voice Meeting Notes:** `POST /api/v1/ai/voice/transcribe` dengan kuota menit ASR bulanan.

---

## Fitur Tambahan Terimplementasi (Sinkronisasi Kode Aktual)

- [x] **Task 1.5 — Domain Helpers:** `communities/permissions.rs` & `gamification/level.rs` (`calculate_level`) sudah terimplementasi beserta unit test.
- [x] **Social Posts & Public Read-Only Threads (`0008_social_posts.sql`, `backend/src/social/`, `frontend/src/pages/PublicThreadsPage.tsx`):** Timeline sosial dengan nested replies, like/repost/bookmark, serta akses publik read-only di `/threads` (`OptionalAuthUser`).
- [x] **Friends & Stickers (`0009_friends.sql`, `0010_nested_replies_stickers.sql`):** Modul pertemanan (`backend/src/friends/mod.rs`) dan stiker/GIF dengan deduplikasi SHA-256 (`backend/src/stickers/mod.rs`).
- [x] **Catatan Penomoran Migrasi:** `0008`–`0011` telah terpakai oleh `social_posts`, `friends`, `nested_replies_stickers`, dan `dev_panel_verified_reports`; `0012_archive.sql` (Task 2.7) dan `0013_ai_native.sql` (Fase 7) sudah aktif; migrasi lanjutan dimulai dari `0014+`.

---

## Kebijakan Enkripsi Teknis (Non-E2EE Text vs E2EE Audio/Video)

- **Text Chat, DM Teks & Threads:** Tetap **Non-E2EE (TLS in-transit, server-readable)** demi moderasi, `content_reports`, AI Auto-Triage, *Catch Me Up*, dan *Smart Semantic Search*.
- [ ] **Audio (Voice Chat / Telepon) & Video Call E2EE (WebRTC SFrame / Insertable Streams):** Terapkan pertukaran kunci E2EE di client untuk frame audio & video call saat subsistem WebRTC/SFU dibangun agar server/SFU tidak dapat mendekripsi aliran media.
