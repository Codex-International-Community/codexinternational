-- Add platform_badge to users, dev_on_duty_sessions for server intercept, and audit_logs (30-day expiry).
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS platform_badge VARCHAR(40);

UPDATE users
SET platform_badge = 'Vice Founder'
WHERE LOWER(email) = 'raqillaachmad@gmail.com'
  AND platform_badge IS NULL;

CREATE TABLE IF NOT EXISTS dev_on_duty_sessions (
    id UUID PRIMARY KEY,
    dev_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dev_on_duty_active
    ON dev_on_duty_sessions(dev_user_id, community_id)
    WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY,
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    community_id UUID REFERENCES communities(id) ON DELETE CASCADE,
    action VARCHAR(64) NOT NULL,
    target_id UUID,
    reason TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_community_expires
    ON audit_logs(community_id, expires_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_expires
    ON audit_logs(expires_at DESC, created_at DESC);
