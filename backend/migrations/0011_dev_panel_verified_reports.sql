-- Add is_verified, banned_at, banned_reason to users and create content_reports queue for Dev Panel.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS banned_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_users_platform_role ON users(platform_role);

CREATE TABLE IF NOT EXISTS content_reports (
    id UUID PRIMARY KEY,
    reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type VARCHAR(24) NOT NULL, -- 'social_post', 'social_reply', 'chat_message'
    target_id UUID NOT NULL,
    target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    community_id UUID REFERENCES communities(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'resolved', 'dismissed'
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolution_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_content_reports_status_created
    ON content_reports(status, created_at DESC);
