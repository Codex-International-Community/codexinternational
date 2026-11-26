-- Moat Features: Solved-to-Wiki, Verified Builder Profile, Code Snippets/Diff & Skill Radar.

CREATE TABLE IF NOT EXISTS wiki_articles (
    id UUID PRIMARY KEY,
    community_id UUID REFERENCES communities(id) ON DELETE SET NULL,
    channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
    source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('chat', 'thread')),
    source_id UUID NOT NULL,
    slug VARCHAR(160) UNIQUE NOT NULL,
    title VARCHAR(200) NOT NULL,
    question_summary TEXT NOT NULL,
    solution_markdown TEXT NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}',
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    solved_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    view_count BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wiki_articles_public_created
    ON wiki_articles(is_public, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wiki_articles_tags
    ON wiki_articles USING GIN (tags);

CREATE TABLE IF NOT EXISTS code_snippets (
    id UUID PRIMARY KEY,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
    message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    post_id UUID REFERENCES posts(id) ON DELETE SET NULL,
    language VARCHAR(32) NOT NULL,
    title VARCHAR(160) NOT NULL DEFAULT '',
    code TEXT NOT NULL DEFAULT '',
    diff_patch TEXT NOT NULL DEFAULT '',
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_code_snippets_channel
    ON code_snippets(channel_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_skill_tags (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tag VARCHAR(48) NOT NULL,
    score INT NOT NULL DEFAULT 1,
    opt_in BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_user_skill_tags_lookup
    ON user_skill_tags(tag, opt_in, score DESC);

CREATE TABLE IF NOT EXISTS help_radar_questions (
    id UUID PRIMARY KEY,
    community_id UUID REFERENCES communities(id) ON DELETE CASCADE,
    channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SOLVED')),
    matched_user_ids UUID[] NOT NULL DEFAULT '{}',
    solved_wiki_id UUID REFERENCES wiki_articles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    solved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_help_radar_status
    ON help_radar_questions(status, created_at DESC);

ALTER TABLE posts
    ADD COLUMN IF NOT EXISTS source_channel_id UUID REFERENCES channels(id) ON DELETE SET NULL;

ALTER TABLE channels
    ADD COLUMN IF NOT EXISTS resolution_post_id UUID REFERENCES posts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS resolution_note TEXT;
