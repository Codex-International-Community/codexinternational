-- Replace bypass_compress with uniform quality_tier ('standard' | 'pro')
-- and track video duration_secs + error_reason for decompression bomb rejection.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS quality_tier VARCHAR(20) NOT NULL DEFAULT 'standard';

ALTER TABLE media_assets
    ADD COLUMN IF NOT EXISTS quality_tier VARCHAR(20) NOT NULL DEFAULT 'standard';

ALTER TABLE media_assets
    ADD COLUMN IF NOT EXISTS duration_secs INT;

ALTER TABLE media_assets
    ADD COLUMN IF NOT EXISTS error_reason TEXT;
