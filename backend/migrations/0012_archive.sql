-- Task 2.7: Tiered Message Archive (`before_seq`), Tombstone Overlay & R2 Media Retention (`DEC-18`, `P§8`).

CREATE TABLE IF NOT EXISTS archive_manifests (
    id UUID PRIMARY KEY,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    min_seq BIGINT NOT NULL,
    max_seq BIGINT NOT NULL,
    r2_object_key TEXT NOT NULL,
    message_count INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (channel_id, min_seq, max_seq)
);

CREATE INDEX IF NOT EXISTS idx_archive_manifests_channel_seq
    ON archive_manifests(channel_id, max_seq DESC);

CREATE TABLE IF NOT EXISTS archive_tombstones (
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    message_id UUID NOT NULL,
    seq_id BIGINT NOT NULL,
    action_type VARCHAR(20) NOT NULL CHECK (action_type IN ('USER_DELETED', 'MOD_REMOVED')),
    audit_log_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (channel_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_archive_tombstones_seq
    ON archive_tombstones(channel_id, seq_id);

CREATE TABLE IF NOT EXISTS wiped_archive_users (
    user_id UUID PRIMARY KEY,
    wiped_before_seq BIGINT NOT NULL,
    wiped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
