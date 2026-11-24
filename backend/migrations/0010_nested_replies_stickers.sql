-- ============================================================
-- NESTED REPLIES, STICKERS & GIFS (SHA-256 DEDUPLICATED)
-- ============================================================

-- Global deduplicated sticker & GIF registry (1 file per sha256_hash)
CREATE TABLE IF NOT EXISTS stickers (
    id UUID PRIMARY KEY,
    kind VARCHAR(16) NOT NULL DEFAULT 'sticker', -- 'sticker' | 'gif'
    sha256_hash CHAR(64) NOT NULL,
    label VARCHAR(80) NOT NULL DEFAULT '',
    media_url TEXT NOT NULL,
    mime_type VARCHAR(64) NOT NULL,
    byte_size BIGINT NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_stickers_kind_hash UNIQUE (kind, sha256_hash)
);
CREATE INDEX IF NOT EXISTS idx_stickers_kind_created ON stickers(kind, created_at DESC);

-- Personal user sticker/GIF collection (references sticker_id only, no duplicate files)
CREATE TABLE IF NOT EXISTS user_stickers (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sticker_id UUID NOT NULL REFERENCES stickers(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, sticker_id)
);
CREATE INDEX IF NOT EXISTS idx_user_stickers_user ON user_stickers(user_id, created_at DESC);

-- Nested replies & media/sticker support on social posts and replies
ALTER TABLE posts
    ADD COLUMN IF NOT EXISTS sticker_id UUID REFERENCES stickers(id) ON DELETE SET NULL;

ALTER TABLE post_replies
    ADD COLUMN IF NOT EXISTS parent_reply_id UUID REFERENCES post_replies(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS media_url TEXT,
    ADD COLUMN IF NOT EXISTS media_alt TEXT,
    ADD COLUMN IF NOT EXISTS sticker_id UUID REFERENCES stickers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_post_replies_parent ON post_replies(parent_reply_id);

-- Sticker support on chat messages
ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS sticker_id UUID REFERENCES stickers(id) ON DELETE SET NULL;
