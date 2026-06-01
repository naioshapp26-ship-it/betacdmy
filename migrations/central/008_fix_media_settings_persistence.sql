-- Fix media_settings persistence for global (tenant_id IS NULL) records.
--
-- Postgres UNIQUE constraints allow multiple NULLs, so multiple "global" rows can exist.
-- This migration:
-- 1) Deduplicates global rows (keeps most recently updated)
-- 2) Ensures at least one global row exists
-- 3) Adds a unique index that treats NULL tenant_id as a fixed UUID, enabling correct UPSERT behavior

-- Keep only the most recently updated global row
DELETE FROM media_settings
WHERE tenant_id IS NULL
  AND id NOT IN (
    SELECT id
    FROM media_settings
    WHERE tenant_id IS NULL
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
    LIMIT 1
  );

-- Ensure a global row exists
INSERT INTO media_settings (tenant_id, allow_direct_upload, created_at, updated_at)
SELECT NULL, true, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM media_settings WHERE tenant_id IS NULL
);

-- Treat NULL tenant_id as a single value for uniqueness/upsert
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_settings_tenant_coalesced_unique
  ON media_settings (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid));
