-- Server dropdown features: categories, scheduled events and member preferences.
CREATE TABLE IF NOT EXISTS community_categories (
 id UUID PRIMARY KEY,
 community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
 name VARCHAR(100) NOT NULL,
 position INT NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE (community_id, name)
);
ALTER TABLE channels ADD COLUMN IF NOT EXISTS category_id UUID
 REFERENCES community_categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_community_categories_position
 ON community_categories(community_id, position);
CREATE TABLE IF NOT EXISTS community_events (
 id UUID PRIMARY KEY,
 community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
 creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
 name VARCHAR(100) NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 starts_at TIMESTAMPTZ NOT NULL,
 location VARCHAR(200) NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_community_events_start ON community_events(community_id, starts_at);
CREATE TABLE IF NOT EXISTS community_member_settings (
 community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 notification_mode VARCHAR(16) NOT NULL DEFAULT 'mentions'
   CHECK (notification_mode IN ('all', 'mentions', 'none')),
 is_muted BOOLEAN NOT NULL DEFAULT FALSE,
 allow_direct_messages BOOLEAN NOT NULL DEFAULT TRUE,
 allow_message_requests BOOLEAN NOT NULL DEFAULT TRUE,
 hide_muted_channels BOOLEAN NOT NULL DEFAULT FALSE,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY (community_id, user_id)
);
