-- AI Native: Multi-Key Pool, Semantic Search Embeddings, Auto-Triage & Voice Meeting Notes.

CREATE TABLE IF NOT EXISTS ai_api_keys (
    id UUID PRIMARY KEY,
    label VARCHAR(80) NOT NULL,
    provider VARCHAR(30) NOT NULL DEFAULT 'deepseek',
    model VARCHAR(80) NOT NULL DEFAULT 'deepseek-chat',
    base_url TEXT NOT NULL DEFAULT 'https://api.deepseek.com',
    api_key_encrypted TEXT NOT NULL,
    key_preview VARCHAR(32) NOT NULL,
    weight INT NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    max_concurrency INT NOT NULL DEFAULT 2500,
    total_requests BIGINT NOT NULL DEFAULT 0,
    total_input_tokens BIGINT NOT NULL DEFAULT 0,
    total_output_tokens BIGINT NOT NULL DEFAULT 0,
    error_count BIGINT NOT NULL DEFAULT 0,
    cooldown_until TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_api_keys_active
    ON ai_api_keys(is_active, cooldown_until, weight DESC);

CREATE TABLE IF NOT EXISTS ai_message_embeddings (
    id UUID PRIMARY KEY,
    source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('message', 'post')),
    source_id UUID NOT NULL,
    channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    content_preview TEXT NOT NULL,
    keywords TEXT[] NOT NULL DEFAULT '{}',
    embedding REAL[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_embeddings_channel
    ON ai_message_embeddings(channel_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_triage_reports (
    report_id UUID PRIMARY KEY REFERENCES content_reports(id) ON DELETE CASCADE,
    toxicity_score REAL NOT NULL DEFAULT 0,
    spam_score REAL NOT NULL DEFAULT 0,
    category VARCHAR(40) NOT NULL DEFAULT 'clean',
    summary TEXT NOT NULL DEFAULT '',
    recommended_action VARCHAR(30) NOT NULL DEFAULT 'review',
    analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_voice_transcripts (
    id UUID PRIMARY KEY,
    channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    duration_secs INT NOT NULL DEFAULT 0,
    transcript TEXT NOT NULL,
    meeting_notes TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
