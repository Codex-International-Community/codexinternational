# PRD.md — CodexInternational Backend: Architecture, Invariants & Decision Log

**Versi:** 1.2 (2026-11-22) — Backend Rust Axum (`axum 0.8.9`, `sqlx 0.9.0`, `rustc 1.99.1`), PostgreSQL, Valkey 9.1 Hybrid Write-Behind (`fred 10.1.0`), Cloudflare R2 + AWS Lambda Rust FFmpeg Video Compressor (tanpa AWS S3), Smart FCM HTTP v1, Billing DOKU QRIS-First, Anti-Ban Evasion APK, serta dukungan Client Hybrid Capacitor (React TS UI/UX + Native Kotlin).
**Dokumen Pendamping:** [`backend/TASKS.md`](TASKS.md) (roadmap implementasi task-by-task Rust TDD), [`INDEX.md`](../INDEX.md) (peta navigasi).
**Cakupan File Ini:** `P§0`–`P§9` (scope, glosarium, Valkey state schema, PostgreSQL DDL, kontrak API/WS, arsitektur write-behind & media, invariants `INV-1..22`, decision log `DEC-1..24`, gotchas implementasi, arsip hot/cold R2, serta monetisasi, billing DOKU, anti-ban evasion APK & ekosistem ekonomi).

**Konvensi prefix cross-reference:**

- `P§x.y` → section di `PRD.md` (file ini).
- `Task x.y` → referensi task di [`backend/TASKS.md`](TASKS.md).
- `INV-x`, `DEC-x` → invariant dan keputusan arsitektur (unik lintas dokumen).

---

## P§0. Cara Membaca Dokumen Ini (untuk Manusia & AI Agent)

- **Navigator lintas-dokumen:** [`INDEX.md`](../INDEX.md).
- **Struktur hierarkis:** Fase → Task → Step (`backend/TASKS.md`). Kerjakan berurutan dalam satu fase; fase berikutnya **tidak boleh** dimulai sebelum *Phase Gate* fase berjalan terverifikasi penuh.
- **Hierarki Kebenaran Teknis:** `INV-x` (`P§5`) adalah **Hukum Tertinggi**. Kode yang melanggar `INV-x` dihitung sebagai **CRITICAL BUG**. State schema (`P§1.2`) dan DDL (`P§1.3` & `P§9.2`) adalah *single source of truth* untuk seluruh key Valkey, struktur tabel PostgreSQL, event WebSocket, dan endpoint HTTP.
- **Batasan Scope (Peta Fase Produk & Backend):**
  - **Fase 1 (Aktif — Fokus Backend Inti):** Discord-style Multi-Community & Multi-Channel Chat + DM 1-on-1, WA Status Ephemeral Stories (24 jam, visibilitas pilihan pembuat), dan Fondasi Gamifikasi Komunitas IT (`xp`, `level`, auto-XP ringan, serta `contributions` manual submit + approval moderator).
  - **Fase 2 (Produk Mendatang):** Threads/X Feed (`posts`, nested replies, repost/quote).
  - **Fase 3 (Produk Mendatang):** Integrasi lanjutan (webhook GitHub otomatis untuk `COMMIT`/`PR`, bot komunitas, dll.).
  - **Fase 4+ (Wacana Portal Eksternal):** Portal terpisah untuk HRD, Client Job Escrow, dan halaman publik Portfolio Terverifikasi.
  - **Monetisasi & Ekosistem Backend (Fase 6–9+ di `TASKS.md`):** Managed Bot Hosting via Pterodactyl (`DEC-17`), Billing Core DOKU + Paywall Keseriusan + Anti-Ban Evasion APK (`P§9.1`–`P§9.3`), Escrow Job IT / Bounty Mikro & Hackathon (`P§9.4`), serta Creator Pool Threads (setelah Fase 2 Threads memiliki traffic organik).
  - **Di Luar Scope Implementasi Backend Sekarang:** Implementasi UI Frontend React TS dan modul Native Kotlin di Capacitor APK (backend menyediakan kontrak REST/WS, Presigned R2 upload, Outbox idempotency `client_msg_id`, delta gap-sync `seq_id`, endpoint direct-reply untuk background service Kotlin, serta verifikasi `X-Device-Fingerprint`).

---

## P§1. Glosarium, State Schema & Kontrak Protokol

### P§1.1 Glosarium

| Istilah | Definisi |
| :--- | :--- |
| **Community** | Entitas server/komunitas independen ala Discord yang memiliki daftar channel, role bitmask kustom, dan leaderboard XP internal. |
| **Channel** | Ruang percakapan di dalam `community` (`text`, `announcement`) atau saluran `dm` 1-on-1 (`community_id IS NULL`) yang seluruhnya memakai skema `seq_id` seragam. |
| **seq_id** | Counter pesan monotonik per-channel (`BIGINT`) yang di-increment secara atomik di Valkey (`ch:{channel_id}:seq`) untuk menjamin urutan ketat dan *gap-sync* saat client reconnect. |
| **client_msg_id** | UUIDv4 idempotency key yang di-generate oleh Outbox client (IndexedDB/SQLite di frontend/APK) agar retry jaringan tidak menggandakan pesan. |
| **Hybrid Write-Behind** | Arsitektur dua tier: **Tier A** (`messages` via Valkey Stream + Pub/Sub real-time + batch flush `250ms` ke Postgres) dan **Tier B** (hot counters `last_read_seq_id`, `xp`, `story_views`, `contribution_likes`, `presence`, `dwell`, `hackathon pool` di Valkey Hash/Set + flush `500ms`). |
| **Story (WA Status)** | Konten ephemeral 24 jam (`text`, `code`, `image`, `video`) dengan kontrol visibilitas oleh pembuat dan dukungan reply langsung ke DM author. |
| **R2 Raw Prefix** | Prefix sementara di Cloudflare R2 (`raw/videos/`, dibersihkan otomatis oleh R2 Lifecycle Policy setelah 24 jam) sebagai target presigned PUT video sekaligus URL playback instan di detik ke-0 khusus video `<= 50 MB` ber-codec H.264 sebelum versi `/compressed` siap. |
| **Fairy Godmother Bot (`Godmother Bot`)** | Nama resmi sistem/ekosistem bot CodexInternational (singkatan: **Godmother Bot**) dengan format prefix & suffix token `fgdm-{kataacak+angkaacak}cdxintrcom`. |
| **Codexter** | *Short name* / namespace infrastruktur resmi dari **CodexInternational** (dipakai pada `CODEXTER_BOT_TOKEN`, org GitHub, dan nama container). |
| **Paywall Keseriusan** | Biaya masuk sekali bayar selamanya (`Rp10.000` dengan trial `Super` 14 hari atau `Rp15.000` dengan trial `Super` 30 hari) untuk membuka akses tulis dari mode pra-bayar `READ_ONLY`. |
| **Slot Jumbo** | Kuota khusus tier `sudo` (5 slot per jendela *rolling* 30 hari) untuk mengunggah video di atas batas reguler 500 MB hingga hard cap **1 GB** (maks 300s 4K / 600s `<= 1440p`), direservasi atomik di `/media/presign`. |
| **Terompet** | Fitur pin/pengumuman sementara di dalam channel (1 slot aktif/channel, TTL 15–30 menit, cooldown 24 jam/user, dapat dilepas moderator). |

---

### P§1.2 Valkey State Schema (Single Source of Truth — Valkey 9.x)

Seluruh key di bawah dijalankan di **Valkey 9.1** (lisensi BSD-3-Clause) dengan AOF aktif (`appendonly yes`, `appendfsync everysec`) dan `io-threads` disesuaikan terhadap jumlah core server.

| Key / Pattern | Tipe | TTL | Writer | Reader | Semantik |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ch:{channel_id}:seq` | String (int64) | — | Lua `INCR` saat `SEND_MESSAGE` | Lua `INCR`, Gap-Sync check | Counter `seq_id` atomik per channel. Jika hilang (cold-start/eviction), di-seed ulang secara single-flight dari `channels.last_seq_id` di Postgres (`INV-3`). |
| `lock:seed:seq:{channel_id}` | String | 5 dtk | `seed_channel_seq` (`SET NX PX 5000`) | Worker yang sama | Single-flight distributed lock pencegah race condition saat seeding `ch:{channel_id}:seq` dari Postgres. |
| `msg:idem:{client_msg_id}` | String (JSON/UUID) | 24 Jam | `SEND_MESSAGE` (`SET NX EX 86400`) | `SEND_MESSAGE` | Idempotency guard untuk Outbox client (`INV-2`). Menyimpan `{id, seq_id, created_at}` agar retry mengembalikan ACK identik. |
| `stream:messages` | Stream | Trim pasca-`XACK` | API / WS Gateway (`XADD`) | `msg_flusher` (`XREADGROUP pg_flusher`) | Antrean durable pesan chat sebelum micro-batch `INSERT` tiap **250ms** (`INV-1`). |
| `stream:messages:dlq` | Stream | — | `msg_flusher` (setelah max retry) | SRE / Alerting | Dead-letter stream untuk pesan gagal persist permanen (tidak boleh hilang diam-diam). |
| `pubsub:ch:{channel_id}` | Pub/Sub | Ephemeral | API / WS Gateway (`PUBLISH`) | Seluruh node Axum (`SUBSCRIBE`) | Fan-out real-time `MESSAGE_CREATE`, `MESSAGE_UPDATE`, `MESSAGE_DELETE`, `TYPING_START`, `MEDIA_READY`. |
| `wb:read:{channel_id}` | Hash (`user_id -> seq_id`) | — | Lua `HSET` hanya jika `new > old` | `counter_flusher` (500ms) | Buffer *last-write-wins* untuk `channel_members.last_read_seq_id` (`INV-4`). |
| `wb:xp:comm:{community_id}` | Hash (`user_id -> delta`) | — | `HINCRBY` dari approval/auto-XP | `counter_flusher` (500ms) | Buffer akumulasi delta XP per komunitas sebelum atomic swap & `UPDATE community_members`. |
| `wb:xp:global` | Hash (`user_id -> delta`) | — | `HINCRBY` | `counter_flusher` (500ms) | Buffer akumulasi delta XP global sebelum update `users.global_xp`. |
| `wb:xp:cooldown:{user_id}` | String | 60 dtk | Auto-XP hook (`SET NX EX 60`) | Auto-XP hook | Rate limit pemberian auto-XP aktivitas chat agar tidak bisa di-spam. |
| `wb:story_views` | Set (`{story_id}:{viewer_id}:{ts}`) | — | `POST /stories/{id}/view` (`SADD`) | `counter_flusher` (500ms) | Buffer view unik story sebelum batch `INSERT INTO story_views ... ON CONFLICT DO NOTHING`. |
| `wb:contrib_likes` | Hash (`{contrib_id}:{user_id} -> 1\|0`) | — | `POST /contributions/{id}/like` | `counter_flusher` (500ms) | Buffer toggle like kontribusi sebelum batch upsert/delete di Postgres. |
| `presence:user:{user_id}` | String (unix ts) | 90 dtk | WS Heartbeat / API activity | `fcm_dispatcher`, WS presence | Penanda user sedang online aktif (di-refresh tiap 30s oleh WS client). |
| `users:last_seen` | Sorted Set | — | WS disconnect / API (`ZADD`) | `fcm_dispatcher`, `counter_flusher` | `member=user_id`, `score=unix_ts`. Dipakai untuk cek aturan offline `>= 10 menit` pada tag `@all` (`INV-10`). |
| `ws:active:{user_id}:{channel_id}` | Set / Counter | 90 dtk | WS `SUBSCRIBE_CHANNELS` / `FOCUS` | `fcm_dispatcher` | Menandakan user sedang membuka channel terkait di layar aktif (suppress FCM). |
| `perm:comm:{community_id}:{user_id}` | String (JSON role+mask) | 5 mnt | Permission loader | Auth/Channel middleware | Cache role `position` dan `permissions` bitmask; di-invalidate eksplisit saat role/member diubah. |
| `bot:token:{token_sha256}` | String (JSON bot_ctx) | 5 mnt | Bot auth loader | Auth extractor (`Authorization: Bot`) | Cache `bot_id` dan `privilege_mode` (`chmod`-style bitmask) untuk menghindari query DB per request dari VPS bot. |
| `timeout:comm:{community_id}:{user_id}` | String (unix ts) | Dynamic TTL | Moderation handler | `SEND_MESSAGE` / WS | Cache timeout member; selama aktif, pesan ditolak `403` tanpa query Postgres. |
| `suspend:user:{user_id}` | String (unix ts) | Dynamic TTL | Admin/Guardrail suspend | Auth / WS / Refresh | Cache platform-level suspension (`INV-15`); langsung memutus WS & menolak token. |
| `rl:{scope}:{key}` | String / ZSet | Window | Rate-limit Lua script | Rate-limit middleware | Sliding-window rate limiter untuk seluruh endpoint API, `/auth/*`, `/media/presign`, `SEND_MESSAGE`, dan `rl:bot:{bot_id}`. |
| `rl:backoff:{scope}:{key}` | Hash (`strikes`, `blocked_until`) | **24 Jam (`86400s`)** | Rate-limit Lua script | Rate-limit middleware, OTP send | Menyimpan jumlah pelanggaran (`strikes`) untuk **exponential backoff** (`cooldown = min(base * 2^(strikes-1), max)`); otomatis reset ke default jika tidak ada pelanggaran selama 24 jam (`INV-16`). |
| `auth:otp:{purpose}:{email_sha256}` | Hash (`otp_hash`, `attempts`) | **5 Menit (`300s`)** | `POST /auth/otp/send` | `POST /auth/otp/verify` | Menyimpan hash SHA-256 kode OTP 6-digit + counter percobaan salah (maks 5× sebelum hangus, `INV-16`). |
| `ent:user:{user_id}` | String (JSON entitlements + `access_state`) | 5 mnt | Entitlement loader | Auth / Media / Chat middleware | Cache status paywall (`READ_ONLY` \| `ACTIVE`) dan tier aktif (`free` \| `super` \| `sudo`); di-invalidate eksplisit saat webhook DOKU masuk (pola `perm:comm`, `INV-17`, `INV-22`). |
| `quota:vid:free:{user_id}:{yyyy-mm-dd}` | String (int) | 25 Jam | Lua `/media/presign` | Lua `/media/presign` | Kuota transcode video harian user `Free` (5–10 video/hari) untuk melindungi biaya AWS Lambda (`INV-18`). |
| `jumbo:{user_id}` | Sorted Set | Rolling 30h | Lua `/media/presign` & `/complete` | Lua `/media/presign` | Kuota 5× Slot Jumbo tier `sudo` (rolling 30 hari). Reservasi atomik di `/presign` (TTL 15 mnt), commit di `/complete`, auto-release jika gagal (`INV-18`). |
| `ban:dev:{device_hash}` | String (reason/ts) | Permanen / Manual | `dev` (`on_duty`) saat *permanent suspend* | `/auth/register`, `/auth/login`, `/ws` `AUTH` | Cache blokir perangkat anti-*ban evasion* khusus APK (hash SHA-256 `ANDROID_ID` + Widevine DRM, `INV-22`). |
| `lock:release:{job_id}` | String | 30 dtk | Escrow release handler (`SET NX PX`) | Handler yang sama | Distributed lock anti *double-payout* saat `dev` (`on_duty`) mengeksekusi pencairan escrow (`INV-19`). |
| `wb:hackathon:pool:{event_id}` | Hash | — | Webhook tiket/sponsor | Event / Landing API | Counter *prize pool* real-time transparan (Tier B, `DEC-22`). |
| `wb:dwell` | Hash | — | Heartbeat 10s Threads | `counter_flusher` (500ms) | Buffer durasi baca unik pembaca untuk Creator Pool pasca-Fase 2 Threads (`DEC-23`). |

---

### P§1.3 PostgreSQL Schema (`0001_init.sql` — Fase 1 Core)

> **Catatan Evolusi Skema:** Tabel di bawah adalah DDL baseline `0001_init.sql` Fase 1 (tidak dimodifikasi retroaktif agar riwayat migrasi tetap bersih). Penambahan tabel untuk arsip (`0008_archive.sql`: `archive_manifests`, `archive_tombstones`, `wiped_archive_users`) dicatat di `P§8`, sedangkan tabel Billing, Entitlements (`plans.entitlements JSONB` yang menggantikan enum statis `quality_tier`), dan Anti-Ban Evasion (`0010_billing.sql`) dicatat di `P§9.2`.

```sql
-- ============================================================
-- PHASE 1 SCHEMA: IT COMMUNITY SUPER-APP (DISCORD + WA STATUS)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. USERS, AUTH & DEVICES (Human Accounts Only)
CREATE TABLE users (
    id UUID PRIMARY KEY, -- UUIDv7 generated by Rust backend
    username VARCHAR(32) UNIQUE NOT NULL,
    display_name VARCHAR(64) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    email_verified_at TIMESTAMPTZ,
    password_hash TEXT, -- Nullable if user signs up exclusively via OAuth
    avatar_media_id UUID, -- FK added after media_assets
    bio TEXT NOT NULL DEFAULT '',
    platform_role VARCHAR(20) NOT NULL DEFAULT 'user', -- 'dev' (highest platform role), 'moderator', 'user'
    quality_tier VARCHAR(20) NOT NULL DEFAULT 'standard', -- Legacy Fase 1 ('standard' | 'pro'); disupersede plans.entitlements JSONB di Fase 7
    suspended_until TIMESTAMPTZ,
    suspended_reason TEXT,
    global_xp BIGINT NOT NULL DEFAULT 0,
    global_level INT NOT NULL DEFAULT 1,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE oauth_accounts (
    provider VARCHAR(20) NOT NULL, -- 'github', 'google'
    provider_user_id VARCHAR(128) NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX idx_oauth_user ON oauth_accounts(user_id);

CREATE TABLE user_devices (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name VARCHAR(100),
    platform VARCHAR(20) NOT NULL, -- 'android_apk', 'web'
    refresh_token_hash TEXT UNIQUE NOT NULL,
    fcm_token TEXT UNIQUE,
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);
CREATE INDEX idx_user_devices_user ON user_devices(user_id) WHERE revoked_at IS NULL;

-- 1B. BOTS & PRIVILEGE MODEL (Separated from users; chmod-style privilege_mode)
-- privilege_mode bits: 1=READ, 2=WRITE, 4=MOD (community guardrail), 8=ADMIN (global platform)
CREATE TABLE bots (
    id UUID PRIMARY KEY, -- UUIDv7
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    name VARCHAR(64) UNIQUE NOT NULL,
    display_name VARCHAR(64) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    privilege_mode SMALLINT NOT NULL DEFAULT 3, -- e.g., 3 (R+W), 7 (R+W+MOD), 15 (R+W+MOD+ADMIN)
    approval_status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'APPROVED', 'REJECTED' (approved by platform 'dev')
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_bot_privilege_range CHECK (privilege_mode BETWEEN 1 AND 15)
);

CREATE TABLE bot_tokens (
    id UUID PRIMARY KEY,
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label VARCHAR(100) NOT NULL,
    token_hash TEXT UNIQUE NOT NULL, -- SHA-256 of opaque bot token
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bot_tokens_bot ON bot_tokens(bot_id) WHERE revoked_at IS NULL;

-- 2. MEDIA ASSETS (Cloudflare R2 -> AWS Lambda Video Compressor)
CREATE TABLE media_assets (
    id UUID PRIMARY KEY, -- UUIDv7
    uploader_id UUID REFERENCES users(id) ON DELETE SET NULL,
    kind VARCHAR(20) NOT NULL, -- 'image', 'video', 'file'
    purpose VARCHAR(30) NOT NULL, -- 'avatar', 'community_icon', 'chat', 'story', 'contribution'
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'PROCESSING', 'READY', 'FAILED', 'EXPIRED'
    quality_tier VARCHAR(20) NOT NULL DEFAULT 'standard', -- 'free' | 'super' | 'sudo' (Fase 1 baseline: 'standard' | 'pro')
    r2_key TEXT,
    r2_thumb_key TEXT,
    r2_raw_key TEXT,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT,
    width INT,
    height INT,
    duration_secs INT,
    error_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ready_at TIMESTAMPTZ
);
CREATE INDEX idx_media_status ON media_assets(status) WHERE status IN ('PENDING', 'PROCESSING');

ALTER TABLE users
    ADD CONSTRAINT fk_users_avatar_media
    FOREIGN KEY (avatar_media_id) REFERENCES media_assets(id) ON DELETE SET NULL;

-- 3. COMMUNITIES (SERVERS), ROLES & CHANNELS (DISCORD MODEL + DM)
CREATE TABLE communities (
    id UUID PRIMARY KEY,
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    slug VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    icon_media_id UUID REFERENCES media_assets(id) ON DELETE SET NULL,
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    invite_code VARCHAR(32) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE community_roles (
    id UUID PRIMARY KEY,
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    color VARCHAR(7) NOT NULL DEFAULT '#99AAB5',
    position INT NOT NULL DEFAULT 0,
    permissions BIGINT NOT NULL DEFAULT 0,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (community_id, name)
);

CREATE TABLE community_members (
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID REFERENCES community_roles(id) ON DELETE SET NULL,
    nickname VARCHAR(64),
    xp BIGINT NOT NULL DEFAULT 0,
    level INT NOT NULL DEFAULT 1,
    timed_out_until TIMESTAMPTZ,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (community_id, user_id)
);
CREATE INDEX idx_community_members_user ON community_members(user_id);
CREATE INDEX idx_community_members_xp ON community_members(community_id, xp DESC);

CREATE TABLE community_bans (
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    banned_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    banned_by_bot_id UUID REFERENCES bots(id) ON DELETE SET NULL,
    reason TEXT NOT NULL DEFAULT '',
    expires_at TIMESTAMPTZ, -- NULL = permanent ban
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (community_id, user_id)
);

CREATE TABLE bot_communities (
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    installed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (bot_id, community_id)
);

CREATE TABLE channels (
    id UUID PRIMARY KEY,
    community_id UUID REFERENCES communities(id) ON DELETE CASCADE, -- NULL = DM channel
    type VARCHAR(20) NOT NULL, -- 'text', 'announcement', 'dm'
    name VARCHAR(100),
    topic TEXT NOT NULL DEFAULT '',
    position INT NOT NULL DEFAULT 0,
    is_private BOOLEAN NOT NULL DEFAULT FALSE,
    dm_pair_key VARCHAR(80) UNIQUE, -- Sorted 'minUuid:maxUuid' for 1-on-1 DM uniqueness
    last_seq_id BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_channels_community ON channels(community_id, position) WHERE community_id IS NOT NULL;

CREATE TABLE channel_members (
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_seq_id BIGINT NOT NULL DEFAULT 0,
    notification_mode VARCHAR(20) NOT NULL DEFAULT 'mentions', -- 'all', 'mentions', 'none'
    muted_until TIMESTAMPTZ,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX idx_channel_members_user ON channel_members(user_id);

-- 4. STORIES / WA STATUS (EPHEMERAL 24H)
CREATE TABLE stories (
    id UUID PRIMARY KEY,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_id UUID REFERENCES media_assets(id) ON DELETE SET NULL,
    media_type VARCHAR(20) NOT NULL DEFAULT 'text', -- 'text', 'image', 'video', 'code'
    caption TEXT,
    bg_color VARCHAR(7),
    visibility VARCHAR(30) NOT NULL DEFAULT 'all_communities', -- 'public', 'all_communities', 'selected_communities', 'contacts'
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_stories_active ON stories(author_id, expires_at DESC);
CREATE INDEX idx_stories_cleanup ON stories(expires_at);

CREATE TABLE story_target_communities (
    story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    PRIMARY KEY (story_id, community_id)
);

CREATE TABLE story_views (
    story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    viewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (story_id, viewer_id)
);

-- 5. REAL-TIME MESSAGES (VALKEY STREAMS -> POSTGRES 250ms BATCH)
CREATE TABLE messages (
    id UUID PRIMARY KEY, -- UUIDv7 generated in Rust before Valkey stream
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Nullable for ON DELETE SET NULL & bot messages
    sender_bot_id UUID REFERENCES bots(id) ON DELETE SET NULL,
    seq_id BIGINT NOT NULL,
    client_msg_id UUID UNIQUE NOT NULL,
    content TEXT,
    media_id UUID REFERENCES media_assets(id) ON DELETE SET NULL,
    reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    reply_to_story_id UUID REFERENCES stories(id) ON DELETE SET NULL,
    mention_everyone BOOLEAN NOT NULL DEFAULT FALSE,
    mentioned_user_ids UUID[] NOT NULL DEFAULT '{}',
    edited_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (channel_id, seq_id),
    CONSTRAINT chk_msg_single_sender CHECK (NOT (sender_id IS NOT NULL AND sender_bot_id IS NOT NULL))
);
CREATE INDEX idx_messages_channel_seq ON messages(channel_id, seq_id DESC);
CREATE INDEX idx_messages_mentions ON messages USING GIN (mentioned_user_ids);

-- 6. GAMIFICATION & CONTRIBUTIONS
CREATE TABLE contributions (
    id UUID PRIMARY KEY,
    community_id UUID REFERENCES communities(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL, -- 'COMMIT', 'PR', 'POST', 'HELP', 'IDEA'
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    points INT NOT NULL DEFAULT 10,
    proof_url TEXT,
    media_id UUID REFERENCES media_assets(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'APPROVED', 'REJECTED'
    verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_contributions_community_status ON contributions(community_id, status, created_at DESC);

CREATE TABLE contribution_likes (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contribution_id UUID NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, contribution_id)
);
```

---

### P§1.4 REST Endpoints & WebSocket Protocol Contract

#### HTTP REST Endpoints (Fase 1 Core — untuk Endpoint Billing/Escrow Fase 7+, lihat `P§9.2` & `P§9.4`)

| Endpoint | Akses | Metode | Fungsi & Perilaku |
| :--- | :--- | :--- | :--- |
| `/health/live`, `/health/ready` | Publik / Probe | GET | Liveness & deep readiness probe (ping Postgres + Valkey, timeout 2s). |
| `/api/v1/auth/register` | Publik (rate-limited) | POST | Registrasi email/username + Argon2id hash, normalisasi email anti-alias, cek `ban:dev:{hash}` dari `X-Device-Fingerprint` (wajib untuk `android_apk`, opsional untuk `web`, `INV-22`), buat device session awal (status pra-bayar `READ_ONLY` saat paywall aktif). |
| `/api/v1/auth/login` | Publik (rate-limited) | POST | Login email/username -> cek `ban:dev:{hash}` (`INV-22`) -> return JWT Access Token (15m) + Refresh Token per-device. |
| `/api/v1/auth/me` | Auth | GET | Ambil profil ringkas user yang sedang login beserta `access_state` & entitlement aktif. |
| `/api/v1/auth/otp/send` | Publik (backoff-limited) | POST | Kirim OTP 6-digit via **Brevo SMTP** (`lettre`, `noreply@domain`) untuk verifikasi email / login / reset; menerapkan **exponential backoff** (`60s -> 120s -> 240s -> ...`, reset 24 jam). |
| `/api/v1/auth/otp/verify` | Publik (rate-limited) | POST | Verifikasi OTP (maks 5× salah sebelum hangus), set `email_verified_at`, atau terbitkan token sesi. |
| `/api/v1/auth/oauth/{provider}` | Publik (rate-limited) | POST | Exchange code GitHub/Google -> cek blokir `provider_user_id` & `ban:dev:{hash}` -> link/create user di `oauth_accounts`. |
| `/api/v1/auth/refresh` | Publik (token) | POST | Rotasi Refresh Token stateful (`user_devices`), deteksi reuse -> revoke jika replay. |
| `/api/v1/auth/logout` | Auth | POST | Revoke device session aktif & bersihkan `fcm_token`. |
| `/api/v1/bots` | Auth (`ACTIVE`) | POST / GET | Ajukan entitas bot terpisah (`bots`, `approval_status = 'PENDING'`, `privilege_mode` maksimal `7` untuk non-`dev`, bit `8` khusus `dev`) atau daftar bot milik user. |
| `/api/v1/dev/bots/{id}/review` | `dev` Only | POST | Setujui (`APPROVED`) atau tolak (`REJECTED`) bot agar aman dipasang oleh `Superadmin` komunitas (`INV-15`). |
| `/api/v1/bots/{id}/tokens` | Auth (Owner) | POST / DELETE | Terbitkan atau revoke `bot_tokens` untuk bot di VPS terpisah (`Authorization: Bot <token>`, hanya aktif setelah `APPROVED`). |
| `/api/v1/communities/{id}/bots/{bot_id}` | `Superadmin` Komunitas | POST / DELETE | Pasang (wajib `approval_status = 'APPROVED'`) atau lepas bot (`bot_communities`) pada komunitas miliknya. |
| `/api/v1/admin/users/{uid}/suspend` | `dev` / Bot `ADMIN` (bit `8`) | POST / DELETE | Suspend atau cabut suspend global user (`users.suspended_until`) + putus sesi aktif (`INV-15`); pada *permanent suspend*, salin hash perangkat ke `banned_device_hashes` dan identitas email/OAuth ke `banned_identities` (`INV-22`). |
| `/api/v1/devices/fcm` | Auth | PUT | Daftarkan/perbarui `fcm_token` dan `platform` (`android_apk` / `web`). |
| `/api/v1/communities` | Auth | POST / GET | Buat komunitas (wajib `ACTIVE`; auto-seed role `Superadmin` [pembuat komunitas], `Admin`, dan `@everyone` + `#general`) atau daftar komunitas user. |
| `/api/v1/communities/join/{invite_code}` | Auth | POST | Bergabung ke komunitas via `invite_code`, otomatis assign role `is_default = TRUE` (tolak `403` jika ter-ban di `community_bans`). |
| `/api/v1/communities/{id}/roles` | Auth + `MANAGE_ROLES` | GET/POST/PATCH/DELETE | Kelola role bitmask & posisi hierarki. |
| `/api/v1/communities/{id}/members/{uid}/role` | Auth + `MANAGE_ROLES` | PATCH | Assign role ke member (validasi posisi di bawah role pengubah). |
| `/api/v1/communities/{id}/members/{uid}/timeout` | Auth + `MODERATE_MEMBERS` | POST / DELETE | Timeout member sementara (`timed_out_until` + cache Valkey TTL). |
| `/api/v1/communities/{id}/members/{uid}/ban` | Auth + `MODERATE_MEMBERS` | POST | Ban user dari komunitas (`community_bans`), hapus membership & putus WS aktif. |
| `/api/v1/communities/{id}/bans/{uid}` | Auth + `MODERATE_MEMBERS` | DELETE | Cabut ban user dari komunitas. |
| `/api/v1/communities/{id}/channels` | Auth + `MANAGE_CHANNELS` | GET/POST/PATCH/DELETE | Kelola channel komunitas (`text`, `announcement`, `is_private`). |
| `/api/v1/dms/{target_user_id}` | Auth (`ACTIVE`) | POST | Buat/ambil DM 1-on-1 secara idempoten via `dm_pair_key`. |
| `/api/v1/channels/{id}/read` | Auth + Member | PATCH | Update `last_read_seq_id` via Valkey Tier B Lua `MAX`. |
| `/api/v1/channels/{id}/notifications` | Auth + Member | PATCH | Set `notification_mode` (`all`/`mentions`/`none`) & `muted_until`. |
| `/api/v1/channels/{id}/messages` | Auth + `VIEW_CHANNEL` | GET / POST | Pull history (`before_seq` via Hot/Cold R2, `P§8.2`) & gap-sync (`after_seq`), atau kirim pesan fallback REST (`POST` wajib `ACTIVE`, `INV-22`). |
| `/api/v1/messages/{id}` | Auth + Owner/Mod | PATCH / DELETE | Edit konten atau soft-delete pesan (`deleted_at = NOW()` atau insert `archive_tombstones` untuk pesan `>= 1 tahun`), broadcast via Pub/Sub. |
| `/api/v1/media/presign` | Auth (`ACTIVE`, rate-limited) | POST | Return Presigned PUT URL ke **Cloudflare R2** sesuai entitlement aktif (`P§2.2`, `DEC-19`): `compressed/images/` (5 MB `Free` / 10 MB `Super` & `sudo`), `raw/videos/` (25 MB & 180s `Free` + kuota harian; 200 MB & 300s `Super`; 500 MB & 300s `sudo`; atau Slot Jumbo `sudo` maks 1 GB & 300s 4K / 600s `<=1440p` yang direservasi atomik di Valkey, `INV-18`), dan `attachments/` (maks 10 MB). Tolak `402`/`403`/`429` jika tier/kuota tidak memenuhi. |
| `/api/v1/media/{id}/complete` | Auth (`ACTIVE`) | POST | Verifikasi objek & ukuran aktual di R2 via `HeadObject` sesuai batas tier (`INV-8`); commit reservasi Slot Jumbo (`INV-18`); image/file -> langsung `READY` (skip Lambda); video -> `PROCESSING` (`playback_url` `/raw` **hanya jika `<= 50 MB` dan codec H.264**, selain itu tunggu `MEDIA_READY`) & invoke AWS Lambda async membawa profil tier. |
| `/internal/v1/media/ready` | **INTERNAL HMAC** | POST | Webhook dari AWS Lambda video compressor (`X-Signature-256` + timestamp `<= 5 mnt`) -> `READY`/`FAILED` + WS notify. |
| `/api/v1/stories` | Auth (`ACTIVE`) | POST | Buat WA Status 24h dengan `visibility` (`public`, `all_communities`, `selected_communities`, `contacts`). |
| `/api/v1/stories/feed` | Auth | GET | Ambil story aktif (`expires_at > NOW()`) sesuai aturan visibilitas pembuat. |
| `/api/v1/stories/{id}/view` | Auth | POST | Catat view unik ke Valkey Tier B (`wb:story_views`). |
| `/api/v1/stories/{id}/viewers` | Auth (Author only) | GET | Daftar viewer story milik user sendiri (`403` jika bukan author). |
| `/api/v1/contributions` | Auth (`ACTIVE`) | POST | Submit kontribusi IT (`COMMIT`, `PR`, `POST`, `HELP`, `IDEA`). |
| `/api/v1/communities/{id}/contributions` | Auth + Member | GET | List kontribusi komunitas (filter status `PENDING`/`APPROVED`/`REJECTED`). |
| `/api/v1/contributions/{id}/review` | Auth + `MODERATE_CONTRIBUTIONS` | POST | Approve/Reject kontribusi; saat `APPROVED`, tambahkan `points` ke Valkey XP Tier B. |
| `/api/v1/contributions/{id}/like` | Auth (`ACTIVE`) + Member | POST | Toggle like kontribusi via Valkey Tier B. |
| `/api/v1/communities/{id}/leaderboard` | Auth + Member | GET | Peringkat member komunitas berdasarkan `xp` & `level`. |

#### WebSocket Protocol (`/ws`)

- **Autentikasi:** Koneksi dibuka ke `/ws` (tanpa middleware timeout, lihat `INV-14`). Client wajib mengirim frame pertama `AUTH { "access_token": "...", "device_id": "...", "device_fingerprint": "<sha256_apk_optional>" }` (atau `AUTH { "bot_token": "..." }` untuk bot di VPS terpisah) dalam 5 detik pertama. Koneksi APK dengan `device_fingerprint` di `ban:dev:{hash}` langsung diputus (`INV-22`). User `READ_ONLY` dapat menerima `MESSAGE_CREATE`, tetapi `SEND_MESSAGE` ditolak `402` (`INV-22`).
- **Client → Server:**
  - `SUBSCRIBE_CHANNELS { channels: [{ channel_id, last_seen_seq_id }] }`
  - `SEND_MESSAGE { channel_id, client_msg_id, content?, media_id?, reply_to_id?, reply_to_story_id? }`
  - `TYPING_START { channel_id }`, `MARK_READ { channel_id, seq_id }`, `FOCUS_CHANNEL { channel_id? }`, `PING`
- **Server → Client:**
  - `READY { user_id, access_state, server_time }`
  - `GAP_SYNC_BATCH { channel_id, messages, resync_required }`
  - `MESSAGE_ACK { client_msg_id, id, channel_id, seq_id, created_at }`
  - `MESSAGE_CREATE { message }` (menyertakan `sender_type: 'user' | 'bot'` untuk mencegah infinite loop antar-bot), `MESSAGE_UPDATE`, `MESSAGE_DELETE`, `USER_KICKED` / `USER_SUSPENDED`
  - `MEDIA_READY { media_id, status, r2_url, thumb_url }`
  - `TYPING_START`, `PRESENCE_UPDATE`, `PONG`

---

## P§2. Arsitektur Sub-Sistem Inti

### P§2.1 Jalur Hybrid Write-Behind (Valkey Streams + Postgres)

```mermaid
sequenceDiagram
    participant C as Client Outbox
    participant A as Axum WS/API
    participant V as Valkey 9.1 (AOF)
    participant F as Flusher (250ms/500ms)
    participant P as PostgreSQL

    C->>A: SEND_MESSAGE(client_msg_id)
    A->>V: Lua: Check Idem + INCR ch:{id}:seq
    A->>V: XADD stream:messages + PUBLISH pubsub:ch:{id}
    A-->>C: MESSAGE_ACK(id, seq_id)
    V-->>A: Pub/Sub Fan-out ke WS Subscribers
    loop Setiap 250ms (max 1000 rows)
        F->>V: XREADGROUP pg_flusher
        F->>P: BEGIN; UNNEST INSERT messages + UPDATE last_seq_id; COMMIT
        F->>V: XACK + XDEL
    end
```

1. **Gap-Sync Hybrid (Postgres + Valkey Stream Tail):** Saat client meminta `after_seq`, server membaca dari Postgres terlebih dahulu; jika ada pesan baru di `stream:messages` yang sudah di-ACK ke client tetapi belum melewati window 250ms ke Postgres, query juga menggabungkan tail dari buffer in-memory/stream agar tidak ada pesan hilang sesaat setelah reconnect (`INV-12`).
2. **XP & Level Formula:** Konversi `xp -> level` bersifat deterministik di `domain::gamification` (mis. kurva progresif kuadratik `level = floor(sqrt(xp / 100)) + 1`), dihitung ulang otomatis saat `counter_flusher` menerapkan delta XP ke Postgres.

### P§2.2 Pipeline Media (Cloudflare R2 + AWS Lambda Rust Compressor — `DEC-19`)

Seluruh object storage menggunakan **Cloudflare R2** (tanpa AWS S3; AWS hanya dipakai untuk **AWS Lambda**). Karena key objek memakai UUID unik yang bersifat immutable, seluruh objek final R2 diunggah dengan header `Cache-Control: public, max-age=31536000, immutable` agar ter-cache penuh di edge CDN Cloudflare terdekat (< 15–20 ms).

- **Gambar (Client-Compressed, R2 Terima Jadi):**
  - Client mengompresi gambar sebelum upload (untuk foto profil 400×400 / 512×512 px: coba encode **AVIF** `image/avif`, fallback otomatis ke **WebP** `image/webp` pada device/browser lama; gambar ber-alpha mendukung `image/png` / WebP alpha).
  - Client mengunci orientasi EXIF asli dan menghapus metadata sensitif (GPS kamera) saat re-encoding.
  - Client upload via Presigned PUT langsung ke R2 (`compressed/images/...`) dengan `Cache-Control: public, max-age=31536000, immutable` -> `POST /media/{id}/complete` memverifikasi objek via `HeadObject` lalu menandai `READY`.
  - Batas gambar per tier: **`Free`** (downscale sisi terpanjang `1600–1920px`, AVIF/WebP quality `72–75`, maks **5 MB**); **`Super` & `sudo`** (hingga `3840px` / 4K, AVIF/WebP quality `85–90`, maks **10 MB**).
- **Video (Zero Passthrough + Cutoff Optimistic `/raw` Playback):**
  - **Detik ke-0:** Client (atau Native Kotlin `WorkManager`) mengunggah video via Presigned PUT ke R2 (`raw/videos/{media_id}.mp4`) lalu memanggil `POST /media/{id}/complete`. Axum memverifikasi `HeadObject` dan meng-invoke **AWS Lambda (`lambda_runtime` + static FFmpeg)** secara async (`InvocationType::Event` via `aws-sdk-lambda`).
  - **Cutoff Optimistic Playback `/raw`:** Playback langsung dari `/raw` pada detik ke-0 **hanya aktif untuk video `<= 50 MB` ber-codec browser-safe (H.264/AAC)**. Untuk video `> 50 MB` atau codec non-browser-safe (seperti HEVC/iPhone), response `/complete` tidak mengembalikan `playback_url` `/raw`; UI langsung menampilkan state `PROCESSING` hingga webhook `MEDIA_READY` tiba (mencegah browser/HP *freeze* memutar file mentah raksasa tanpa `+faststart`).
  - **Background Transcode & Cleanup:** Lambda mengunduh dari R2 `/raw`, transcode ke MP4 H.264/AAC `+faststart` sesuai ladder tier + ekstrak thumbnail WebP, mengunggah ke R2 (`compressed/videos/...` dan `compressed/thumbs/...`) dengan `Cache-Control: public, max-age=31536000, immutable`, lalu mengirim callback `POST /internal/v1/media/ready` ber-HMAC-SHA256. Lambda tidak langsung menghapus `/raw` (dibersihkan otomatis oleh **R2 Lifecycle Policy setelah 24 jam**).
- **Ladder Kompresi Video "Manipulasi Mata" (Zero Passthrough, Maxrate Monotonik — `DEC-19`, `INV-21`):**
  Seluruh tier tetap melewati jalur kompresi (tanpa passthrough bypass dan tanpa folder `original/`). Maxrate meningkat monotonik per resolusi agar resolusi lebih tinggi selalu terlihat lebih tajam secara visual:

  | Tier | Batas Input | Durasi Maks | 720p | 1080p | 1440p (2K) | 2160p (4K) | Kuota Tambahan |
  | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
  | **Free** | 25 MB | 180s | CRF 28 @ 1.6M | CRF 30 @ 2.2M | ❌ Tolak | ❌ Tolak | Maks 5–10 video/hari (`quota:vid:free:*`) |
  | **Super** | 200 MB | 300s | CRF 24 @ 2.5M | CRF 24 @ 3.5M | CRF 26 @ 5.5M | ❌ Tolak | — |
  | **Sudo** | 500 MB | 300s | CRF 22 @ 3.5M | CRF 22 @ 5.0M | CRF 23 @ 8.0M | CRF 22 @ 12.0M | +5 Slot Jumbo / rolling 30 hari |

- **Fisika Slot Jumbo (`sudo`), Guard Kompresi & Profil Compute Lambda:**
  - **Hard Cap Jumbo:** Maks **1 GB** per file, durasi maks **300s (4K)** atau **600s (`<= 1440p`)** — tidak ada eksekusi 4K 600s tunggal di Lambda. Cap total akumulasi storage media per user adalah **20 GB** (`users.storage_used_bytes`) untuk mencegah penyalahgunaan storage jangka panjang.
  - **Reservasi Atomik (`INV-18`):** Slot Jumbo dan kuota harian `Free` dicek & direservasi via Valkey Lua di `/media/presign` (bukan `/complete`), sehingga kuota **tidak bisa habis *mid-upload***. Reservasi Jumbo memiliki TTL 15 menit (otomatis dilepas bila upload gagal/batal) dan di-commit saat `/complete` sukses.
  - **Guard Persepsi & Codec (`INV-21`):** *Never-upscale* (output `<=` resolusi input), penegakan cap resolusi server-side via `ffprobe` di Lambda (menolak klaim palsu client saat presign -> `FAILED`), dan aturan *skip-if-larger* (remux `+faststart` jika output `>= 98%` input) **hanya berlaku jika codec input sudah H.264/AAC** (input HEVC/MOV wajib tetap ditranscode ke H.264).
  - **Profil Compute Lambda (ARM64 Graviton2):**
    - *Foto/Ringan:* Timeout internal `60s`.
    - *Video Reguler (`Free`/`Super`):* Memory `2048–3008 MB`, `/tmp` `2048–3072 MB`, `-preset veryfast`, timeout internal `180s` (Lambda `240s`).
    - *Video 4K & Slot Jumbo (`sudo`):* Memory `8192–10240 MB` (~4–5 vCPU ARM), `/tmp` `6144–10240 MB`, timeout internal `480s` (Lambda `600s`), flag `-fs <tier_max_output_bytes>` diset dinamis per profil (bukan hardcode `100 MB`).
- **Pertahanan Decompression Bomb (Video, Image & Zip/Office):**
  - **Video Bomb (`compressor.rs`):** Pre-flight `ffprobe` (dibungkus `tokio::time::timeout(10s)`) menolak jika `width > 4096 || height > 4096 || width * height > 8_294_400`, resolusi melebihi cap tier aktif, `duration > tier_max_duration`, `nb_streams > 4`, atau FPS abnormal (`> 120 fps`). Eksekusi `ffmpeg` memakai hard flags `-map 0:v:0 -map 0:a:0?`, `-t <tier_max_duration>`, `-fs <tier_max_output_bytes>`, `-max_muxing_queue_size 1024`, `-fps_mode vfr`, dibungkus `tokio::time::timeout(...)` dengan `kill()` + cleanup `/tmp`. Unduhan dari R2 di-stream ke `/tmp` (bukan buffer penuh di RAM).
  - **Image Bomb (`lambda-light-media-compressor`):** Decode memakai `ImageReader` + `Limits` (`max_image_width: 8192`, `max_image_height: 8192`, `max_alloc: 256 MB`) sebelum alokasi piksel penuh.
  - **Zip Bomb (`kind = 'file'`, `ZipBombGuard`):** Inspeksi streaming di memori dengan `std::io::Read::take(MAX_TOTAL_BYTES + 1)` tanpa ekstrak ke disk: rasio kompresi maks `25×` (arsip umum) / `100×` (Office `.docx`/`.xlsx`/`.pptx`, atau bypass rasio bila total aktual `< 10 MB`), total dekompresi aktual maks `250 MB` (anti-overlap), maks `1.000` entry, dan kedalaman arsip bersarang maks `1` level — bersifat absolut terlepas dari tier langganan.
  - **Aksi Penolakan:** Hapus sisa file `/tmp`, panggil `DeleteObject` R2 untuk menghapus objek berbahaya, kirim callback `POST /internal/v1/media/ready` dengan `status: "FAILED"` & `error_reason: "SECURITY_REJECTED: decompression bomb detected"`, lalu return `Ok(...)` agar Lambda tidak me-retry file bomb.

### P§2.3 Smart FCM HTTP v1 & Aturan Offline 10 Menit

1. Worker membaca event pesan baru dari consumer group terpisah di `stream:messages` (`XREADGROUP fcm_worker`).
2. Untuk tiap target penerima:
   - Lewati jika penerima punya `ws:active:{user_id}:{channel_id}` aktif (`INV-9`).
   - Lewati jika `channel_members.notification_mode = 'none'` atau `muted_until > NOW()`.
   - **Individual Trigger (DM 1-on-1, Direct Reply, `@user` Mention):** Kirim ke seluruh `fcm_token` aktif user di `user_devices`.
   - **Non-Individual Trigger (`@everyone`, `@here`, `@all`, atau channel mode `'all'`):** Cek `ZSCORE users:last_seen {user_id}` di Valkey. Jika `(now - last_seen) >= 600 detik (10 menit)`, **jangan masukkan ke antrean notif FCM** (`INV-10`).
3. Pengiriman ke FCM memakai **FCM HTTP v1 API** (`fcm_v1` + OAuth 2.0 Service Account JSON). Token yang merespons `UNREGISTERED` otomatis dihapus dari `user_devices`.

### P§2.4 Batas Integrasi Multi-Platform Client (Web Desktop & Mobile Native Roadmap)

Backend Rust Axum dirancang **100% client-agnostic** melalui kontrak REST, WebSocket, Presigned R2, dan FCM HTTP v1. Strategi client terbagi menjadi dua target utama:

- **Desktop (dan fallback Mobile Browser) — Web App (`React TS`):**
  - *Image Compression (CPU/RAM Desktop + WASM):* Memanfaatkan CPU multi-core desktop melalui **Web Worker** (`OffscreenCanvas` native, atau **WebAssembly `@jsquash/avif`** agar encoding AVIF konsisten di semua browser termasuk Safari, dengan fallback `image/webp`). Mendukung input clipboard paste (`Ctrl+V` screenshot) maupun drag-and-drop, serta otomatis mengunci orientasi EXIF & membuang metadata GPS.
  - *Outbox & Cache:* Memanfaatkan kuota storage desktop yang besar melalui `IndexedDB` / OPFS (*Origin Private File System*) + `navigator.storage.persist()`, serta Web Push via Service Worker / PWA (`platform = 'web'`).
  - *Upload Video:* Koneksi desktop cenderung stabil tanpa *OS background kill*; upload tetap langsung ke R2 `/raw` saat tab aktif (jika memakai mobile browser, tampilkan pengingat agar tab tidak ditutup selama upload).
- **Mobile (HP) — Tujuan Akhir Full Native (Transisi Awal via Capacitor Hybrid: React TS UI + Native Kotlin):**
  - Pada tahap transisi APK Android, UI/UX tetap **React TS** (tanpa Ionic UI) sementara modul krusial dijalankan di **Native Kotlin** sebelum bermigrasi ke UI native penuh di masa depan—tanpa mengubah satu pun kontrak API backend.
  - **SQLite Native Outbox (`@capacitor-community/sqlite` / Room/SQLite):** Penyimpanan lokal tahan eviction OS, mengirim `client_msg_id` (UUIDv4) untuk idempotency dan menarik delta via `after_seq` (`seq_id`).
  - **Native Image Compressor, Privacy & Background Upload (`WorkManager` Kotlin):** Avatar & foto dikompresi di client (coba **AVIF** ~50–150 ms untuk 400–512 px, fallback **WebP** di HP lawas), mengunci rotasi EXIF, membuang GPS kamera, serta menangani gambar transparan (kanvas `#FFFFFF` untuk JPEG atau pertahankan `.png`). Upload video ke Presigned PUT R2 + `POST /api/v1/media/{id}/complete` berjalan di `WorkManager` meski aplikasi di-minimize/ditutup.
  - **FCM Direct Reply (`FirebaseMessagingService` Kotlin):** Memanggil `POST /api/v1/channels/{id}/messages` (dengan `client_msg_id` baru dan Bearer token dari Native Secure Storage) langsung dari panel notifikasi Android tanpa membangunkan UI.
  - **Non-Invasive Anti-Ban Evasion Fingerprint (`DEC-24`):** Modul Native Kotlin menggabungkan `Settings.Secure.ANDROID_ID` + Widevine `MediaDrm` Unique ID dan mengirimkannya hanya sebagai hash SHA-256 (`X-Device-Fingerprint`) tanpa izin ekstra dan tanpa memindai proses/memori OS (detail di `P§9.3`).

### P§2.5 Hierarki Role Platform & Komunitas (`dev > Superadmin > Admin > Member`)

Sistem memisahkan wewenang tingkat **Platform** (`users.platform_role` + bobot `users.platform_badge`: `Founder` 100 > `Vice Founder` 80 > `Senior Admin` 60 > `Admin` 40 > `Moderator` 20 > `dev` 10) dan tingkat **Komunitas** (`communities.owner_id` + `community_roles.position`):

| Role | Cakupan | Wewenang & Batasan |
| :--- | :--- | :--- |
| **`dev`** (`platform_role`) | **Global Platform** | Pembuat & pengelola tertinggi Super App. Satu-satunya yang boleh membuat/mengatur **Bot `ADMIN` (bit `8`)**, melakukan `suspend` user lintas platform, eksekusi *release* escrow / unban *device hash* saat mode **`on_duty`** (`scope = 'global'`), dan intervensi darurat (seluruh aksi tercatat di 30-day audit logs). |
| **`Superadmin`** (`communities.owner_id` + `position = 1000`) | **Pemilik Komunitas** | Pembuat komunitas/grup. Memegang kendali mutlak di komunitasnya; **tidak dapat** di-kick, di-ban, di-timeout, atau diturunkan role-nya oleh `Admin` maupun Bot `MOD`. |
| **`Admin`** (`community_roles`, `position = 500`) | **Pengurus Komunitas** | Diangkat oleh `Superadmin` komunitas. Dapat mengelola channel, role di bawah posisinya, moderasi member biasa, serta memasang Bot Komunitas (`1..7`), tetapi terblokir terhadap `Superadmin`. |
| **`Member`** (`is_default = TRUE`, `position = 0`) | **Anggota Komunitas** | Anggota standar yang membaca/mengirim pesan (setelah melewati paywall keseriusan), membuat Story, dan mengirim `contributions`. |

### P§2.6 Struktur Bucket Cloudflare R2 & Backup Database (`wal-g`)

Secara teknis object storage bersifat *flat key-value*, tetapi penggunaan `/` (*Key Prefix*) tampil sebagai folder di Dashboard R2/CLI sekaligus memungkinkan **Lifecycle Policy** dipasang per prefix. Untuk isolasi keamanan, gunakan **2 bucket terpisah**:

```text
codex-media/                                    # Bucket 1: Publik via R2_PUBLIC_BASE_URL + CORS
├── raw/
│   └── videos/{yyyy}/{mm}/{media_id}.{ext}     # R2 Standard | Lifecycle Policy: Auto-delete 24 jam
├── compressed/
│   ├── avatars/{user_id}/{media_id}.avif       # R2 Standard | Fallback .webp; Cache-Control: immutable
│   ├── icons/{community_id}/{media_id}.avif    # R2 Standard | Icon komunitas
│   ├── images/{yyyy}/{mm}/{media_id}.avif      # R2 Standard | Gambar chat/story/contrib (fallback .webp/.png)
│   ├── videos/{yyyy}/{mm}/{media_id}.mp4       # R2 Standard | Output Lambda FFmpeg (Free/Super/Sudo/Jumbo)
│   └── thumbs/{yyyy}/{mm}/{media_id}.webp      # R2 Standard | Thumbnail video dari Lambda
├── attachments/{user_id}/{yyyy}/{mm}/{media_id}.{ext} # R2 Standard | File dokumen & arsip terverifikasi ZipBombGuard
└── archive/
    └── {channel_id}/{min_seq}_{max_seq}.jsonl.zst     # R2 Infrequent Access ($0,01/GB) | Arsip teks pesan >= 1 tahun (P§8.1)

codex-backups/                                  # Bucket 2: 100% PRIVAT (tanpa Custom Domain & tanpa CORS)
└── postgres/
    ├── wal_005/                                # Delta WAL segments via wal-g (archive_timeout = 300s -> RPO <= 5m)
    └── basebackups_005/                        # Weekly full basebackup (Lifecycle retensi 30 hari)
```

- **Strategi Backup (RPO ≤ 5 menit, RTO < 30 menit):** PostgreSQL VPS mengaktifkan `archive_mode = on` dengan `archive_timeout = 300` (5 menit) memakai **`wal-g`** untuk mendorong delta WAL ke `codex-backups/postgres/` dan full `backup-push` 1× seminggu—sangat hemat karena memanfaatkan kuota Class A ops R2 yang besar dan menghindari beban `pg_dump`/`pg_restore` ulang seluruh tabel.

---

## P§3. Tech Stack & Cargo Workspace

| Crate / Komponen | Versi Target | Peran |
| :--- | :--- | :--- |
| `rustc` / `edition` | `1.99.1` / `"2024"` | Compiler & edition resmi workspace (`backend/Cargo.toml`). |
| `axum` + `tokio` | `0.8.9` (`ws`) + `1.x` (`full`) | HTTP REST router, `WebSocketUpgrade` (`features = ["ws"]`), background tokio tasks. |
| `sqlx` | `0.9.0` | Compile-time checked SQL (`runtime-tokio`, `tls-rustls-ring-webpki`, `postgres`, `uuid`, `chrono`, `migrate`). |
| `fred` | `10.1.0` | Pure-Rust async Valkey/RESP3 client (MIT/Apache-2.0, `Pool` + `SubscriberClient` auto-resubscribe, zero `protoc`/`cmake` build deps). |
| `uuid` | `1.29.2` (`v7`, `v4`, `serde`) | UUIDv7 time-ordered untuk seluruh primary key server. |
| `argon2` + `jsonwebtoken` | `0.6.0` + `11.1.0` | Argon2id password hashing + JWT Access Token signing/verification. |
| `subtle` + `hmac` + `sha2` | Latest stable | Constant-time signature verification untuk webhook AWS Lambda (`INV-8`) dan webhook DOKU (`INV-17`). |
| `aws-sdk-s3` + `aws-config` | `1.57+` + `1.5+` | Presigning & object ops ke **Cloudflare R2** (S3-compatible endpoint). |
| `aws-sdk-lambda` | `1.50+` | Async invocation (`InvocationType::Event`) dari Axum ke `lambda-video-compressor`. |
| `lambda_runtime` | `0.13+` | Runtime Rust untuk crate `lambda-video-compressor`. |
| `async-compression` | Latest (`zstd`, `tokio`) | Stateless streaming decompression untuk pembacaan arsip `jsonl.zst` dari R2 (`P§8.1`). |
| `fcm_v1` | `0.3+` | Push notification HTTP v1 via Google OAuth2 Service Account. |
| `lettre` | `0.11+` (`tokio1-rustls-tls`) | Pengiriman email OTP via **Brevo SMTP Relay** (`smtp-relay.brevo.com:587`, `STARTTLS`, custom domain + Cloudflare Email Routing inbound ke Gmail). |
| `tracing` + `tracing-subscriber` | Latest stable | Structured JSON logs untuk API, flusher, dan observability. |
| `dotenvy` | `0.15+` | Memuat `.env` pada environment lokal sebelum `config.rs` memvalidasi env vars. |

---

## P§4. Struktur Direktori Backend (Feature-Based `src/` + Lambda)

```text
codexinternational/
├── docker-compose.yml                   # Infra DB & Cache di root (PostgreSQL + Valkey 9.1 AOF)
├── docker/valkey/valkey.conf            # Konfigurasi Valkey 9.1 (AOF + io-threads)
└── backend/
    ├── Cargo.toml                       # Main binary crate (+ workspace member lambda-video-compressor)
    ├── migrations/
    │   ├── 0001_init.sql                # DDL Fase 1 (P§1.3)
    │   ├── 0002_user_uid.sql .. 0007_media_quality_tier.sql # Governance, on_duty, server menu & media tier
    │   ├── 0008_archive.sql             # DDL Arsip Hot/Cold & Tombstones (P§8)
    │   ├── 0009_managed_bots.sql        # DDL Fase 6 Managed Bot Pterodactyl (DEC-17)
    │   ├── 0010_billing.sql             # DDL Fase 7 Billing DOKU, Entitlements & Device Ban (P§9.2)
    │   └── 0011_escrow_hackathon.sql    # DDL Fase 8 Escrow & Hackathon (P§9.4)
    ├── src/
    │   ├── main.rs                      # Bootstrap Axum + Workers (bisa toggle via env role)
    │   ├── config.rs                    # Membaca .env/OS env & hard-fail guardrails (INV-13)
    │   ├── state.rs                     # AppState (PgPool, Valkey, R2, Lambda, WsRegistry)
    │   ├── error.rs                     # AppError -> HTTP JSON response
    │   ├── shared/                      # Valkey Lua scripts, R2 presigner, Lambda invoker, rate limiter
    │   ├── auth/                        # Register, login, Argon2id, JWT, refresh, OAuth2, devices, dev_governance, device_ban
    │   ├── communities/                 # Communities, roles bitmask, channels, DMs
    │   ├── chat/                        # WS gateway, Lua seq_id, gap-sync, Hot/Cold archive, msg_flusher (250ms)
    │   ├── media/                       # R2 presign, /complete, kuota harian/Jumbo, HMAC Lambda webhook
    │   ├── stories/                     # WA Status 24h, visibility, views, story_cleaner (1h)
    │   ├── gamification/                # Contributions, approval, XP->Level, leaderboard, counter_flusher (500ms)
    │   ├── notifications/               # Smart FCM HTTP v1 dispatcher (< 10 menit rule)
    │   ├── billing/                     # (Fase 7+) DOKU client, webhook HMAC, entitlements JSONB, Terompet, ledger
    │   ├── escrow/                      # (Fase 8+) Job IT/Bounty state machine, explicit on_duty release
    │   └── hackathon/                   # (Fase 8+) Live prize pool Valkey, GitHub Org repo provisioner, z-score
    └── lambda-video-compressor/         # Crate terpisah khusus AWS Lambda Rust + static FFmpeg
        ├── Cargo.toml
        └── src/
```

---

## P§5. Invariants (Hukum Tertinggi — Pelanggaran = Critical Bug)

| ID | Invariant | Mekanisme Penegakan & Verifikasi |
| :--- | :--- | :--- |
| **INV-1** | Pesan chat yang sudah diberi `MESSAGE_ACK` ke client **tidak boleh hilang** meski `msg_flusher` crash/restart. | Pesan wajib masuk `stream:messages` (Valkey AOF) sebelum ACK dikirim; `XACK` hanya dieksekusi **setelah** transaksi Postgres `COMMIT`. |
| **INV-2** | Pengiriman ulang pesan dengan `client_msg_id` yang sama tidak pernah membuat duplikasi pesan atau `seq_id` ganda. | Atomic Lua idempotency check `msg:idem:{client_msg_id}` di Valkey + `UNIQUE (client_msg_id)` & `ON CONFLICT DO NOTHING` di Postgres. |
| **INV-3** | `seq_id` per channel bersifat strictly monotonic tanpa celah atau duplikasi saat konkurensi tinggi maupun cold-start Valkey. | Lua `INCR ch:{channel_id}:seq` + single-flight `lock:seed:seq:{channel_id}` yang membaca `MAX` / `channels.last_seq_id` dari Postgres sebelum retry. |
| **INV-4** | `last_read_seq_id` tidak boleh pernah mundur (*monotonically non-decreasing*). | Lua `MAX` pada `wb:read:{channel_id}` dan `GREATEST(last_read_seq_id, EXCLUDED.last_read_seq_id)` saat flush ke Postgres. |
| **INV-5** | Menghapus user (`ON DELETE SET NULL`) tidak boleh menggagalkan query atau menghapus riwayat pesan komunitas. | `messages.sender_id` nullable; seluruh query chat menangani `sender_id = NULL` sebagai `[Deleted User]`. |
| **INV-6** | Reply pesan berumur `< 250ms` (yang induknya masih dalam window batch flush) tidak boleh gagal Foreign Key constraint. | `messages.id` memakai `UUIDv7` pra-generated di server + batch diurutkan berdasar `(channel_id, seq_id)` + FK `reply_to_id` bersifat `DEFERRABLE INITIALLY DEFERRED`. |
| **INV-7** | DM 1-on-1 antara pasangan user `(A, B)` wajib selalu memetakan ke tepat 1 `channel_id`. | `channels.dm_pair_key = min(A,B):max(A,B)` bertipe `UNIQUE` dengan insert idempoten. |
| **INV-8** | Seluruh Presigned PUT URL wajib mengunci `Content-Type`, batas ukuran, dan durasi video sesuai entitlement tier aktif (`Free` 25 MB/180s, `Super` 200 MB/300s, `sudo` 500 MB/300s + Slot Jumbo maks 1 GB & 300s 4K / 600s `<=1440p`; gambar 5 MB/10 MB), seluruh file/arsip/media wajib lolos pertahanan *decompression bomb*, serta webhook Lambda wajib terautentikasi HMAC-SHA256 + anti-replay timestamp. | Validasi limit tier & durasi di `/media/presign`, verifikasi `content_length` via R2 `HeadObject` di `/media/{id}/complete`, `ZipBombGuard` + `ffprobe`/FFmpeg hard limits, dan verifikasi `Signature` + window timestamp (`<= 5 menit`) pada `/internal/v1/media/ready`. |
| **INV-9** | User yang sedang aktif membuka channel di WebSocket tidak boleh menerima duplikasi notifikasi push FCM dari channel tersebut. | Cek `ws:active:{user_id}:{channel_id}` di Valkey sebelum enqueue ke `fcm_dispatcher`. |
| **INV-10** | Tag non-individual (`@everyone`, `@here`, `@all`, mode channel `all`) **dilarang** masuk antrean notifikasi FCM bagi user yang offline `>= 10 menit`. | Evaluasi `(now - ZSCORE users:last_seen user_id) < 600` di `fcm_dispatcher`. |
| **INV-11** | Story yang sudah melewati `expires_at` (`> 24 jam`) tidak boleh tampil di feed maupun menyisakan file yatim di R2. | Query feed memfilter `expires_at > NOW()`; `story_cleaner` per jam menghapus object R2 sebelum hapus row DB. |
| **INV-12** | Gap-sync `after_seq` wajib mengembalikan rangkaian `seq_id` lengkap termasuk pesan yang belum ter-flush dalam window 250ms. | Endpoint/WS gap-sync menggabungkan hasil Postgres dengan tail `stream:messages` yang belum ter-commit untuk channel terkait. |
| **INV-13** | Startup mode `production` wajib *hard-fail* (`exit(1)`) bila secret kritis (`JWT_SECRET`, `LAMBDA_WEBHOOK_SECRET`, `DOKU_SECRET_KEY`, kredensial DB/Valkey/R2) kosong atau invalid. | Validasi ketat di `src/config.rs` sebelum binding TCP listener. |
| **INV-14** | Rute WebSocket `/ws` **dilarang** dibungkus HTTP request timeout middleware, dan token auth dilarang lewat URL query string. | Pemisahan router `/ws` dari `TimeoutLayer` Tower; autentikasi via frame pertama `AUTH`. |
| **INV-15** | User yang ter-ban (`community_bans`), ter-timeout (`timed_out_until`), atau ter-suspend (`users.suspended_until`) **dilarang** mengirim pesan, join ulang lewat invite, atau mempertahankan sesi WS aktif; `Admin` komunitas **dilarang** menimpa/ban `Superadmin` (pembuat komunitas); Bot wajib berstatus `APPROVED` oleh platform `dev` sebelum dapat dipakai/dipasang di komunitas; dan Bot dengan `privilege_mode` lebih rendah **dilarang** menimpa hak/aksi Bot `ADMIN` (bit `8`). | Cek `suspend:user:{uid}` & `timeout:comm:{cid}:{uid}` di Auth/WS/Send; cek `communities.owner_id` + `position` saat moderasi/role; cek `bots.approval_status == 'APPROVED'`; validasi `privilege_mode` (`1..15`) dan hanya `platform_role = 'dev'` yang boleh memberi bit `8` serta meng-approve bot. |
| **INV-16** | Seluruh endpoint API dan pengiriman OTP wajib menerapkan rate limit dengan **exponential backoff** yang reset ke default setelah **24 jam (`86400s`)**, dan kode OTP dilarang disimpan plaintext di Valkey (maks 5 percobaan verifikasi). | Lua script `rl:backoff:{scope}:{key}` (TTL `86400s`, header `Retry-After` pada `429`), serta `auth:otp:{purpose}:{email_sha256}` menyimpan SHA-256 OTP + `attempts <= 5`. |
| **INV-17** | Entitlement user/server dan status paywall hanya boleh berubah dari webhook DOKU terverifikasi (HMAC constant-time + idempotency `provider_ref`) atau aksi audit `dev`. | Verifikasi signature `subtle` + replay window `<= 300s` + `UNIQUE(provider_ref)` pada `payments` + invalidasi eksplisit `ent:user:{uid}`. |
| **INV-18** | Kuota transcode harian (`Free`) dan 5× Slot Jumbo rolling 30 hari (`sudo`) bersifat atomik, non-negatif, dan tidak pernah habis *mid-upload*. | Lua script atomik di `/media/presign` (reservasi TTL 15 mnt pada `jumbo:{uid}`), commit saat `/complete`, auto-release jika upload gagal/expired. |
| **INV-19** | Mirror ledger escrow wajib *double-entry balanced* (`SUM(CASE WHEN direction='DEBIT' THEN amount_idr ELSE -amount_idr END) = 0` per `tx_id`); payout hanya dieksekusi setelah `CONFIRMED` + klik eksplisit `dev` dalam status `on_duty` (`scope = 'global'`, bukan buyer/seller) atau hasil arbitrase teraudit. | Transaksi SQL append-only (`amount_idr > 0` + `direction`) + `lock:release:{job_id}` + validasi conflict-of-interest + pencatatan 30-day audit log. |
| **INV-20** | Creator pool: total payout bulanan dilarang melebihi `pool_bulan` (`SUM(payout) <= pool_bulan`, pro-rata cap jika *oversubscribed*) dan *zero self-vote*. | Kalkulasi settlement bulanan teraudit + filter author, *mutual-vote ring*, dan klaster device/IP. |
| **INV-21** | Kompresi media wajib `never-upscale`, maxrate monotonik per resolusi, *skip-if-larger* khusus codec H.264/AAC (HEVC wajib transcode), dan validasi resolusi server-side via `ffprobe`. | Unit test generator argumen FFmpeg & `ffprobe` guard pada `lambda-video-compressor`. |
| **INV-22** | User dengan status pra-bayar `READ_ONLY` dilarang melakukan aksi tulis (`402 Payment Required`); perangkat/identitas di `banned_device_hashes` atau `banned_identities` dilarang registrasi/login/OAuth/WS (`403`) kecuali dicabut manual oleh `dev` `on_duty` (`scope = 'global'`). | Middleware cek `ent:user:{uid}` & `ban:dev:{hash}` di REST/WS `AUTH` + pencatatan 30-day audit log untuk aksi unban perangkat. |

---

## P§6. Decision Log (`DEC-1`..`DEC-24`)

| ID | Keputusan | Alasan & Konteks |
| :--- | :--- | :--- |
| **DEC-1** | Fokus Fase 1 pada **Discord Multi-Community + WA Status + Gamification IT**; Threads/X masuk Fase 2. | Hasil alignment kebutuhan komunitas IT agar arsitektur inti solid lebih dulu sebelum fitur social feed publik. |
| **DEC-2** | Model chat **Multi-Community → Multi-Channel (`text`, `announcement`) + DM 1-on-1** + role per-komunitas. | Menyatukan channel komunitas dan DM dalam satu tabel `channels` membuat mekanisme `seq_id`, gap-sync, dan `last_read_seq_id` seragam. |
| **DEC-3** | Visibilitas Story (WA Status 24h) ditentukan oleh **pilihan pembuat saat memposting** (`public`, `all_communities`, `selected_communities`, `contacts`) + reply ke DM. | Memenuhi fleksibilitas privasi ala WA Status dalam ekosistem multi-komunitas. |
| **DEC-4** | Gamifikasi Fase 1 memakai **auto-XP ringan + `contributions` submit manual & approval moderator**; webhook GitHub masuk Fase 3. | Memberi identitas komunitas IT sejak awal tanpa memblokir rilis Fase 1 pada integrasi eksternal GitHub App. |
| **DEC-5** | Mengadopsi **Valkey 9.1 (BSD-3-Clause)** via **`fred` (`10.1.0`, MIT/Apache-2.0)**; menolak Redis proprietary & DragonflyDB (BSL). | Menjaga 100% open-source licensing yang aman secara komersial, zero native build deps (`protoc`/`cmake`) di Windows/Linux, serta mendukung `Pool`, `SubscriberClient`, Lua, dan Streams Valkey 9. |
| **DEC-6** | Memakai **Hybrid Write-Behind** (`messages` via Valkey Streams 250ms, hot counters via Valkey Hash/Set 500ms) ketimbang pure memory-only write-behind. | Menghindari kehilangan pesan saat crash window 500ms dan mencegah *split-brain* antara WebSocket real-time dengan Postgres. |
| **DEC-7** | Seluruh PK server memakai **`UUIDv7`** yang di-generate di Rust, bukan `BIGSERIAL`. | Memungkinkan `reply_to_id` referensi pesan baru sebelum batch INSERT 250ms ke Postgres dieksekusi. |
| **DEC-8** | Seluruh object storage memakai **Cloudflare R2** (tanpa AWS S3); **Gambar** dikompresi di client lalu Presigned PUT ke R2, **Video** Presigned PUT ke R2 (`raw/videos/`) → Axum verifikasi & invoke async **AWS Lambda (Rust + FFmpeg)** → hasil & thumbnail disimpan balik ke R2. | Mengeliminasi biaya egress/storage AWS S3 dan menyederhanakan arsitektur cloud hanya ke R2 + AWS Lambda. |
| **DEC-9** | Auth memakai **Argon2id + OAuth2 (GitHub/Google opsional) + Short-lived JWT Access Token + Stateful Refresh Token per-device**. | Memudahkan sesi jangka panjang dan multi-device management di Capacitor Android APK (termasuk akses dari Native Kotlin background service) tanpa bergantung pada cross-origin WebView cookie. |
| **DEC-10** | Menggunakan **FCM HTTP v1 API** (`fcm_v1` + OAuth2 Service Account) dengan filter **offline `< 10 menit`** untuk tag `@all`/`@everyone`. | Legacy FCM server key sudah dimatikan Google; aturan 10 menit mencegah banjir notif ke member yang memang sedang lama offline. |
| **DEC-11** | Backend disusun dengan struktur **Feature-Based `src/`** (1 crate utama + 1 crate terpisah `lambda-video-compressor/`) yang siap multi-instance via Valkey Pub/Sub & Consumer Group. | Mengurangi boilerplate multi-crate saat belajar/ngoding manual sambil tetap menjaga isolasi fitur dan jalur scale-out horizontal. |
| **DEC-12** | Fokus penuh pada **backend & server** terlebih dahulu; client React TS + Native Kotlin menyusul setelah kontrak API/WS & engine stabil. | Memastikan fondasi throughput ribuan MPS, schema, dan keamanan terverifikasi penuh lebih awal. |
| **DEC-13** | Target client **Desktop menggunakan Web App (`React TS`)** (tetap bisa diakses mobile browser), sedangkan **Mobile (HP) menuju Full Native** dengan jalur transisi **Capacitor Hybrid** (React TS UI + Native Kotlin untuk SQLite Outbox, Image Compressor, `WorkManager` Background Upload, dan FCM Direct Reply). | Memberi pengalaman Web terbaik di desktop dan reliabilitas OS-level di HP tanpa perlu mengubah kontrak backend Rust saat mobile bermigrasi ke full native. |
| **DEC-14** | **Hierarki 2-Layer (`dev` di platform; `Superadmin` pembuat komunitas vs `Admin` biasa di komunitas) & Bot Terpisah:** Bot dipisahkan ke tabel `bots` dengan `chmod`-style `privilege_mode` (`1=READ, 2=WRITE, 4=MOD, 8=ADMIN`); `Superadmin` komunitas bisa membawa/memasang bot setelah disetujui (`APPROVED`) oleh `dev`. | Memisahkan otoritas pembuat platform (`dev`) dari pemilik komunitas (`Superadmin`) dan admin delegasi (`Admin`), mencegah bot berbahaya masuk komunitas tanpa review `dev`, serta menjaga blast radius VPS bot = 0. |
| **DEC-15** | Hierarki wewenang dipisah menjadi **`dev`** (global platform creator, tertinggi di sistem) di atas **`Superadmin`** (pembuat/pemilik komunitas & channel, kebal terhadap aksi `Admin`), di atas **`Admin`** (pengurus komunitas), dan **`Member`**. | Mencerminkan pola pembuat grup vs admin biasa ala WA/Discord sekaligus menjaga batas jelas antara pemilik platform (`dev`) dan pemilik komunitas (`Superadmin`). |
| **DEC-16** | Menambahkan **Brevo SMTP OTP (`lettre`, send-as custom domain; inbound via Cloudflare Email Routing → Gmail)** dan **Global Exponential Backoff Rate Limiter** (auto-reset **24 jam**) pada seluruh API & pengiriman OTP. | Memungkinkan pengiriman email resmi berdomain sendiri (SPF/DKIM) tanpa biaya mailbox berbayar, mencegah abuse kuota SMTP Brevo, serta melindungi seluruh endpoint API tanpa mengunci user selamanya berkat jendela reset 24 jam. |
| **DEC-17** | **Managed Bot Hosting (Add-On Berbayar) via Pterodactyl Application API di VPS Terpisah:** User gratis tetap menjalankan bot di VPS sendiri (*BYO VPS*); user yang berlangganan add-on *Managed Bot* di-provision container otomatis via Pterodactyl Application API di **node/VPS Wings yang terpisah total** dari VPS inti. | Memberi jalur monetisasi utilitas nyata untuk menutup biaya infra bagi user yang tidak ingin mengurus VPS sendiri, sambil menjaga isolasi kegagalan & keamanan VPS inti (Postgres/Valkey/Axum). |
| **DEC-18** | **Tiered Hot/Cold Message Archive (`>= 1 tahun` ke R2 `jsonl.zst`) + Tombstone Overlay + Pagination `before_seq`:** Arsip dibaca stateless streaming tanpa cache Valkey; mutasi moderasi/hapus tidak pernah menulis ulang file R2. | Menjaga ukuran Postgres dan backup harian tetap ramping sementara 99% aktivitas harian tetap dilayani dari hot storage tanpa kompleksitas cache invalidation. |
| **DEC-19** | **Kompresi Video Universal Tanpa Passthrough (Maxrate Monotonik):** Ladder `Free` (25 MB/180s + kuota harian), `Super` (200 MB/300s 2K), `sudo` (500 MB/300s 4K + 5× Jumbo maks 1 GB: 4K 300s / `<=1440p` 600s, cap storage 20 GB/user); cutoff `/raw` di `<= 50 MB` H.264; R2 Standard untuk media aktif/retensi berbayar & R2 Infrequent Access khusus arsip teks `>= 1 tahun`. | Menjamin persepsi kualitas HD bertingkat tanpa melanggar batas fisik/timeout Lambda, melindungi margin dari beban user gratis, serta menghindari biaya retrieval R2 IA pada media aktif. |
| **DEC-20** | **Billing DOKU QRIS-First & SKU Universal Terkonsolidasi:** 2 tier user universal (`Super` Rp15k/bln atau Rp150k/thn; `sudo` Rp25k/bln atau Rp250k/thn — tahunan bayar 10× dapat 12 bln) + `Super Server` (Rp50k/bln atau Rp120k/3bln, patungan *Boost Meter*) + `Managed Bot` + paket `Terompet` (mis. 5× = Rp15k); disimpan via `plans.entitlements JSONB`. Tolak pemisahan langganan Chat vs Threads, diskon pelajar, gift sub, dan harga korporat. | Mencegah fragmentasi SKU & kebingungan user, mengoptimalkan struktur fee DOKU (transaksi `> Rp100k` kena MDR 0,7% tanpa fee flat Rp1.110), serta patuh larangan surcharge QRIS BI. |
| **DEC-21** | **Escrow Job IT & Bounty Mikro (Pola A + Explicit `on_duty` Gate):** Buyer bayar QRIS/VA ke platform → seller kerja → buyer `CONFIRMED` (atau auto-confirm 3×24j) → pencairan BI-FAST dieksekusi melalui klik eksplisit `dev` `on_duty` (`scope = 'global'`, SLA 24 jam → eskalasi `Founder`/`Vice Founder`). Fee platform 6% (min Rp5.000) mode INC/EXC dengan MDR diserap fee platform; payout fee dinamis ditanggung seller; AC checklist berbobot (*partial release*); Closed Beta dibatasi cap nominal. | Menjawab keterbatasan Direct API QRIS DOKU yang belum mendukung hold/split native, mencegah auto-drain berisiko saat dev sekadar online, serta membatasi eksposur risiko regulasi PJP awal. |
| **DEC-22** | **Hackathon & Pemisahan Portal Eksternal (Fase 4+):** Tiket Rp15k–25k, *prize pool* `seed + 70% × tiket + sponsor` live di Valkey, repo template dibuat otomatis oleh org GitHub Codexter, viva final 5 menit, PPh 21 dipotong penyelenggara. Portal HRD/Client/Portfolio Terverifikasi dipisah ke wacana Fase 4+. | Mencegah joki secara native lewat histori commit/PR, mematuhi kewajiban potong pajak hadiah, dan menjaga fokus eksekusi backend inti di Fase 1–3. |
| **DEC-23** | **Creator Threads (Backlog Pasca-Fase 2 Threads Hidup):** Pool plafon 25% NET subs + sponsor; poin murni berbasis sinyal dampak (`Save`, `Share`, `Upvote_trusted`, `Dwell`, `-Report`) tanpa bayaran flat per-post; anti-spam berbasis tangga XP/Level (bukan paywall post satuan); settlement delay 14 hari; min payout Rp100k rollover. | Mencegah subsidi kas platform, mencegah fragmentasi konten akibat `Rp/post`, dan menjaga *cold start* organik Threads. |
| **DEC-24** | **Paywall Keseriusan + Anti-Ban Evasion APK (Zero-Trust & Data Minimization):** User baru masuk mode `READ_ONLY` hingga membayar sekali bayar selamanya (`Rp10.000` + trial `Super` 14 hari, atau `Rp15.000` + trial `Super` 30 hari). Khusus APK menggunakan hash SHA-256 non-invasif (`ANDROID_ID` + Widevine `MediaDrm`) yang hanya disimpan permanen saat *permanent suspend* (unban manual khusus `dev` `on_duty` untuk kasus HP bekas). | Menyaring *spammer* dan mematikan *ban evasion* lewat kombinasi friksi ekonomi + perangkat tanpa memindai proses/memori OS yang tidak cocok bagi komunitas IT. |

---

## P§7. Implementation Notes & Gotchas

1. **R2 Signed Header Parity (`Content-Type` & `Cache-Control` pada `aws-sdk-s3`):** Saat membuat Presigned PUT URL untuk Cloudflare R2 (`.endpoint_url("https://<ACCOUNT_ID>.r2.cloudflarestorage.com")`, `.region("auto")`), nilai `.content_type(...)` dan `.cache_control(...)` (bila ikut di-sign, misalnya `public, max-age=31536000, immutable`) pada SDK builder **wajib sama persis** dengan header HTTP yang dikirim client saat melakukan `PUT`, atau R2 akan menolak upload dengan `403 SignatureDoesNotMatch`.
2. **`fred` Pool & Dedicated `SubscriberClient`:** Pisahkan `fred::clients::Pool` untuk perintah reguler (`INCR`, `XADD`, `XREADGROUP`, `Lua`) dengan dedicated `fred::clients::SubscriberClient` untuk `SUBSCRIBE` Pub/Sub guna menghindari head-of-line contention di bawah beban ribuan MPS. `SubscriberClient` otomatis melacak channel yang di-subscribe dan melakukan auto-resubscribe saat reconnect.
3. **Bug Schema Awal yang Sudah Diperbaiki:** Draft `sender_id UUID NOT NULL ... ON DELETE SET NULL` tidak valid di PostgreSQL (error saat user dihapus); di `0001_init.sql` kolom `sender_id` sudah nullable (`INV-5`).
4. **Kapasitas `XREADGROUP` & `XPENDING` Recovery:** Worker `msg_flusher` wajib memanggil `XAUTOCLAIM` saat startup maupun secara periodik untuk mengambil alih pesan *pending* yang tertinggal apabila ada worker node mati di tengah transaksi sebelum `XACK`.
5. **Rust Edition 2024 & `sqlx 0.9.0`:** Pastikan seluruh environment CI dan lokal menjalankan `rustc >= 1.94.0` (terverifikasi lokal `1.99.1`) agar kompatibel dengan `edition = "2024"` dan `sqlx 0.9.0`.
6. **Bounded `Argon2id` Execution (`Semaphore` + `spawn_blocking`):** Karena `Argon2id` bersifat CPU/memory-heavy (~19–64 MB & ~20–50 ms per eksekusi), jalankan hash/verify di `tokio::task::spawn_blocking` yang dijaga oleh `tokio::sync::Semaphore` (mis. 4–8 slot paralel pada VPS 4 vCPU) dengan acquire timeout pendek (~2 detik -> `503 Retry-After`) agar lonjakan login tidak memicu OOM atau mengganggu thread WebSocket chat.
7. **Cloudflare R2 Bucket CORS & Lifecycle Policy:** Bucket R2 wajib mengizinkan CORS method `PUT`, `GET`, `HEAD` beserta header `Content-Type` dan `Cache-Control` untuk origin Desktop Web maupun Capacitor (`https://localhost` / `capacitor://localhost`), serta memasang Lifecycle Rule auto-delete 24 jam pada prefix `raw/videos/`. Arahkan `R2_PUBLIC_BASE_URL` ke Custom Domain Cloudflare agar `Cache-Control: immutable` bekerja penuh di edge PoP.
8. **Graceful Shutdown (`SIGTERM` / `Ctrl+C`):** `msg_flusher` (250ms) dan `counter_flusher` (500ms) wajib mendengarkan `CancellationToken` / sinyal `SIGTERM` untuk menyelesaikan batch yang sedang berjalan dan mengeksekusi **final flush** ke Postgres sebelum proses berhenti.
9. **Proteksi SSRF pada URL Eksternal:** Validasi `proof_url` di `contributions` (serta fitur link preview OpenGraph bila ditambahkan di Fase 2+) wajib memblokir skema non-`http(s)` dan resolusi DNS ke IP privat/loopback/link-local (`127.0.0.0/8`, `10.0.0.0/8`, `169.254.169.254`, `::1`).
10. **AWS Lambda ARM64 (`cargo-lambda`) & Strategi Partitioning `messages`:** Kompilasi `lambda-video-compressor` ke target **ARM64 (Graviton2)** via `cargo-lambda` dengan static `ffmpeg` `aarch64`. Gunakan 2 konfigurasi/fungsi profil compute: reguler (Memory `2048–3008 MB`, `/tmp` `2048–3072 MB`, timeout `240s`) untuk `Free`/`Super`, dan profil 4K/Jumbo (Memory `8192–10240 MB`, `/tmp` `6144–10240 MB`, timeout `600s`) untuk `sudo` hingga 1 GB. Pada `messages`, Fase 1 memakai 1 tabel dengan index `(channel_id, seq_id DESC)`; bila jumlah baris mulai menembus belasan juta, migrasikan ke PostgreSQL `PARTITION BY RANGE (created_at)` (catatan: PK/UNIQUE wajib menyertakan `created_at` dan FK `reply_to_id` dilepas jadi soft reference lintas partisi).
11. **Evolusi Entitlement (`plans.entitlements JSONB`) & Keamanan Bio SVG:** Jangan *hardcode* batas limit tier di banyak tempat; Fase 7 memindahkan seluruh konfigurasi entitlement dari kolom legacy `users.quality_tier` ke `plans.entitlements JSONB` yang di-cache di `ent:user:{uid}`. Untuk seluruh fitur kosmetik/banner berbayar (`Super`/`sudo`/`Super Server`: Animated GIF/WebP banner, border animasi, dan **Bio SVG**), **dilarang keras** merender raw `<svg>` langsung ke DOM (risiko Stored XSS); simpan SVG di R2 dan tampilkan lewat `<img src="...">` atau gunakan preset badge.
12. **One-Time Reveal Credential untuk Bot Token (`bot_tokens`):** Plaintext token **Fairy Godmother Bot** (singkatan: **Godmother Bot**) berformat `fgdm-{kataacak+angkaacak}cdxintrcom` yang diterbitkan oleh `POST /api/v1/bots/{id}/tokens` hanya dikembalikan **satu kali** saat pembuatan (pola *one-time reveal* seperti PAT/API key) agar user menyalin dan menyimpannya sendiri di `.env` VPS, Notepad, atau Secret Manager. Backend hanya menyimpan hash SHA-256 di `bot_tokens` sehingga token tidak dapat dilihat atau dipulihkan lagi di dashboard; jika hilang atau bocor, user harus melakukan revoke (`DELETE`) lalu membuat token baru.
13. **Managed Bot Hosting via Pterodactyl Application API (VPS Terpisah):** Untuk paket add-on berbayar *Managed Bot*, backend memanggil Pterodactyl Application API (`POST /api/application/servers`, `suspend`, `unsuspend`, `delete`) dengan `external_id` idempoten milik `bot_id` pada **VPS Wings terpisah** dari VPS inti (PostgreSQL, Valkey, Caddy, Axum). Syarat mutlak: (a) tetap wajib melewati gate `approval_status == 'APPROVED'` oleh `dev` (`INV-15`) sebelum server/token dibuat dan dilarang mengaktifkan `BOT_ADMIN` bit `8`; (b) `CODEXTER_BOT_TOKEN` hanya di-inject ke environment startup container saat provisioning tanpa menyimpan plaintext-nya di DB Codexter; (c) jaringan Docker Wings wajib memblokir IP privat/loopback/metadata (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.169.254`) serta membatasi kuota CPU/RAM/Disk/PID agar container bot tetap harus lewat endpoint publik seperti bot eksternal.
14. **DOKU Webhook Signature Parity & Larangan Surcharge QRIS BI:** Webhook DOKU Checkout (`HMAC-SHA256`) dan SNAP (`HMAC-SHA512`) wajib diverifikasi dengan perbandingan *constant-time* (`subtle`), jendela replay `<= 300 detik`, serta idempotency `Request-Id`/`provider_ref`. Sesuai aturan Bank Indonesia & DOKU, merchant dilarang menampilkan/membebankan *surcharge* "biaya QRIS" kepada pembeli—nominal di layar wajib sama persis dengan nominal yang di-scan.
15. **Non-Invasive APK Device Hashing & Play Store Routing:** Modul Kotlin dilarang meminta izin `READ_PHONE_STATE`/IMEI atau memindai daftar proses/memori OS (menghindari *false positive* perangkat *rooted*/Termux di komunitas IT). Cukup hash kombinasi `ANDROID_ID` + Widevine `MediaDrm` Unique ID dengan SHA-256 sebelum dikirim ke backend. Apabila APK suatu saat didistribusikan melalui Google Play Store, arahkan pembayaran langganan/paywall ke checkout Web (*consume-only* entitlements di APK) untuk menghindari potongan Google Play Billing.

---

## P§8. Tiered Message Archive (`before_seq`), Tombstone Overlay & Retensi Media R2

### P§8.1 Arsitektur Hot/Cold Storage (`DEC-18`)
- **Hot Storage (PostgreSQL):** Menyimpan pesan aktif `< 1 tahun` agar query harian tetap cepat dan ukuran disk/backup VPS terkendali.
- **Cold Storage (Cloudflare R2 — Storage Class *Infrequent Access*):** Worker `cleaner` secara berkala memindahkan pesan berumur `>= 1 tahun` per chunk ke R2 dalam format `archive/{channel_id}/{min_seq}_{max_seq}.jsonl.zst` (memakai kelas **R2 Infrequent Access** `$0,01/GB-bln` karena sangat jarang dibuka), mencatat metadata ke tabel `archive_manifests` (`channel_id`, `min_seq`, `max_seq`, `r2_object_key`), lalu menghapus baris dari `messages`.
- **Stateless Streaming Decompression:** Pembacaan arsip menggunakan `async-compression` (`zstd`, `tokio`) + `tokio::io::AsyncBufReadExt::lines()` secara stateless langsung dari R2 tanpa cache arsip di Valkey.

### P§8.2 Pagination `before_seq`
- Endpoint `GET /messages` menggunakan cursor `before_seq` dan `limit` (default 50) untuk scroll mundur di seluruh channel (DM dan community); `after_seq` tetap dipertahankan untuk catch-up/reconnect WebSocket.
- **Hot Path:** Query `WHERE channel_id = $1 AND seq_id < $2 AND deleted_at IS NULL ORDER BY seq_id DESC LIMIT 50`. Jika hasil = 50 baris, langsung kembalikan tanpa menyentuh R2.
- **Boundary Crossing:** Jika DB mengembalikan `< 50` baris, cari 1 manifest terbaru di `archive_manifests` dengan `max_seq <= seq_terakhir_di_db`, stream-decompress dari R2, ambil sisa baris teratas, lalu gabungkan dalam satu array response.
- **Cold Path:** Jika DB mengembalikan 0 baris, rujuk langsung ke `archive_manifests` berdasarkan `before_seq`, tarik file R2 terkait, saring `seq_id < before_seq`, dan ambil 50 item.

### P§8.3 Tombstone Overlay (Immutable R2)
- File `jsonl.zst` di R2 bersifat **100% write-once / immutable** (dilarang melakukan siklus download → edit → re-upload).
- **`archive_tombstones`:** Composite PK `(channel_id, message_id)`, `seq_id`, `action_type` (`USER_DELETED` | `MOD_REMOVED`), `audit_log_id` (opsional, terhubung ke audit log `on_duty`).
- **`wiped_archive_users`:** Menyimpan `(user_id, wiped_before_seq)` untuk penghapusan akun yang mewajibkan isi pesan ikut hilang.
- **Filter-on-Read:** Saat menarik file R2, backend menjalankan query paralel (`tokio::join!`) ke kedua tabel tersebut untuk rentang `seq_id` terkait, memuat ke `HashMap`/`HashSet` di memori Rust (pencarian O(1)): `USER_DELETED` atau user di `wiped_archive_users` di-skip; `MOD_REMOVED` tetap mengirim kerangka pesan dengan konten diganti placeholder moderasi. File arsip hanya menyimpan `author_id` agar anonimisasi profil otomatis saat hydration.

### P§8.4 Retensi Media R2 (> 3 Bulan) & Storage Class (`DEC-19`)
- **Retensi Media:** Worker `cleaner` menghapus objek media R2 berumur `> 3 bulan` dan menandai `media_assets.status = 'EXPIRED'` (baris pesan teks tetap dipertahankan), **kecuali** untuk:
  - Channel community milik server dengan langganan **`Super Server`** aktif.
  - Channel DM di mana salah satu pihak (pengirim atau penerima) memiliki langganan **`Super` / `sudo`** aktif.
- **Storage Class Media Berbayar:** Seluruh media aktif dan media retensi berbayar tetap disimpan di **R2 Standard** (`$0,015/GB-bln`) dan **tidak** dipindahkan ke R2 Infrequent Access (menghindari biaya retrieval per GB ketika media chat sering dibuka ulang). R2 Infrequent Access hanya dipakai untuk arsip teks `archive/*.jsonl.zst` (`P§8.1`).
- **Acuan Limit Upload & Tier:** Limit upload (`Free` 25 MB/180s, `Super` 200 MB/300s, `sudo` 500 MB/300s + 5× Jumbo 1 GB rolling 30 hari) mengikuti matriks resmi di `P§2.2` dan `P§9.1` (target teks pesan dasar ~3.000 karakter untuk `Free`, meningkat pada tier berbayar melalui `plans.entitlements JSONB`).

---

## P§9. Subsistem AI Native (DeepSeek v4.1 Flash Multi-Key Pool) & Sinkronisasi Implementasi Aktual

### P§9.1 Arsitektur Multi-API-Key & Quota Guard (`DEC-25`)

- **Tabel `0013_ai_native.sql`:**
  - `ai_api_keys`: menyimpan pool API key DeepSeek v4.1 Flash (`label`, `provider`, `model`, `base_url`, `api_key_encrypted`, `key_preview`, `weight`, `is_active`, `max_concurrency`, `total_requests`, `total_input_tokens`, `total_output_tokens`, `error_count`, `cooldown_until`). Plaintext key **tidak pernah** dikembalikan ke client; seluruh mutasi dicatat ke `audit_logs` (`dev` only).
  - `ai_message_embeddings`: indeks pencarian semantik (`source_type` `'message' | 'post'`, `source_id`, `channel_id`, `content_preview`, `keywords TEXT[]`, `embedding REAL[]`) yang diisi asinkron via `tokio::spawn` untuk pesan `>= 20` karakter tanpa ketergantungan ekstensi `pgvector`.
  - `ai_triage_reports`: hasil analisis trust & safety (`toxicity_score`, `spam_score`, `category`, `summary`, `recommended_action`) yang dipicu asinkron saat `POST /api/v1/reports`.
  - `ai_voice_transcripts`: penyimpanan transkrip dan *meeting notes* hasil fitur Voice Notes (`duration_secs`, `transcript`, `meeting_notes`).
- **Load Balancing & Failover:** `call_deepseek_chat` memakai *weighted round-robin* di seluruh key aktif yang tidak sedang `cooldown_until`. Jika satu key mengembalikan `429` atau `5xx`, key tersebut masuk cooldown 60 detik dan request otomatis *failover* ke key lain.
- **Valkey Quota & Cache Keys:**
  - `ai:summary:{channel_id}:{from_seq}:{to_seq}` (TTL `600s`) — cache ringkasan *Catch Me Up* agar puluhan member di channel yang sama tidak memanggil API AI berulang kali.
  - `ai:quota:req:{user_id}:{yyyy-mm-dd}` (TTL 25 jam), `ai:quota:search:{user_id}:{yyyy-mm-dd}` (TTL 25 jam), dan `ai:quota:asr:{user_id}:{yyyy-mm}` (TTL 35 hari) — penegakan batas kuota per tier (`free`, `super`, `sudo`, `dev`).

### P§9.2 Endpoint AI Native & Dev Key Pool

| Endpoint | Akses | Fungsi |
| :--- | :--- | :--- |
| `GET /api/v1/ai/limits` | Auth | Spesifikasi pricing DeepSeek v4.1 Flash, matriks batas tier (`free`/`super`/`sudo`/`dev`), dan pemakaian user saat ini. |
| `POST /api/v1/ai/channels/{id}/catch-me-up` | Auth + `VIEW_CHANNEL` | Ringkasan pesan unread (`last_read_seq_id..last_seq_id`, Postgres + tail `stream:messages`) dengan cache Valkey. |
| `GET /api/v1/ai/search` | Auth | Smart Semantic Search lintas pesan channel terotorisasi dan public posts. |
| `POST /api/v1/ai/channels/{id}/command` | Auth + `SEND_MESSAGES` | Slash command AI (`/ai`, `/ask`, `/summarize`, `/translate`, `/code`) dengan mode `ephemeral`. |
| `POST /api/v1/ai/voice/transcribe` | Auth | Pembuatan *meeting notes* dari transkrip voice channel sesuai kuota menit ASR bulanan. |
| `GET / POST /api/v1/dev/ai/keys` & `PATCH / DELETE /api/v1/dev/ai/keys/{id}` | `dev` Only | Manajemen pool multi-API-key (tambah, ubah weight/model/status, clear cooldown, hapus). |
| `GET /api/v1/dev/ai/triage` & `POST /api/v1/dev/ai/triage/{report_id}` | `dev` Only | Antrean hasil auto-triage AI untuk `content_reports` dan trigger ulang analisis. |

### P§9.3 Catatan Sinkronisasi Implementasi Aktual (`0008`–`0013`)

- **Penomoran Migrasi Aktual:** Migrasi `0008`–`0011` telah terpakai oleh fitur sosial dan governance (`0008_social_posts.sql`, `0009_friends.sql`, `0010_nested_replies_stickers.sql`, `0011_dev_panel_verified_reports.sql`), diikuti `0012_archive.sql` (Task 2.7) dan `0013_ai_native.sql` (AI Native). Migrasi Fase 6–8 (`managed_bots`, `billing`, `escrow_hackathon`) akan melanjutkan dari `0014+`.
- **Modul Sosial, Friends & Stickers:**
  - **Public Read-Only Threads:** `GET /api/v1/social/posts` dan `GET /api/v1/social/posts/{id}` mendukung `OptionalAuthUser` (dapat diakses publik tanpa login di `/threads` dan `/threads/:postId` dalam mode read-only), sementara `tab=saved`, `/bookmarks`, `/activity`, dan seluruh aksi tulis tetap mewajibkan `AuthUser`.
  - **Friends (`/api/v1/friends/*`):** daftar teman, pencarian user, kirim/terima/tolak permintaan pertemanan, dan hapus teman.
  - **Stickers & GIFs (`/api/v1/stickers/*`):** upload dengan deduplikasi SHA-256 dan koleksi sticker tersimpan.

### P§9.4 Kebijakan Enkripsi: Server-Readable Text vs E2EE Audio/Video

- **Text Chat, DM Teks, & Threads (Non-E2EE / Server-Readable):** Seluruh pesan teks menggunakan enkripsi *in-transit* (HTTPS/WSS TLS) dan disimpan *server-readable* di PostgreSQL serta R2 archive (`jsonl.zst`). Keputusan ini **disengaja demi moderasi** (`content_reports`, `dev` `on_duty`, *Auto-Triage AI*), *Catch Me Up*, dan *Smart Semantic Search*.
- **Audio (Voice Chat / Telepon) & Video Call (E2EE):** Aliran media real-time (voice note/voice channel/telepon & video call berbasis WebRTC) menerapkan **End-to-End Encryption (E2EE)** pada level media frame (**WebRTC Insertable Streams / SFrame** di atas DTLS-SRTP), sehingga server/SFU hanya meneruskan paket terenkripsi tanpa memiliki kunci dekripsi media.
