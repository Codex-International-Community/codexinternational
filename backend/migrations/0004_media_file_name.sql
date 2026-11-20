ALTER TABLE media_assets
    ADD COLUMN IF NOT EXISTS file_name VARCHAR(255) NOT NULL DEFAULT 'attachment';
