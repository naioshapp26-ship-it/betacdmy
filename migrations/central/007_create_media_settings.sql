-- Create media settings table for controlling media upload behavior
CREATE TABLE IF NOT EXISTS media_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  allow_direct_upload BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_tenant_media_setting UNIQUE (tenant_id)
);

-- Create index for faster tenant lookups
CREATE INDEX IF NOT EXISTS idx_media_settings_tenant_id ON media_settings(tenant_id);

-- Insert default global setting (NULL tenant_id means global/super admin setting).
-- Postgres UNIQUE(tenant_id) does not treat NULLs as equal, so avoid ON CONFLICT(tenant_id).
INSERT INTO media_settings (tenant_id, allow_direct_upload)
SELECT NULL, true
WHERE NOT EXISTS (
  SELECT 1 FROM media_settings WHERE tenant_id IS NULL
);

-- Add comment
COMMENT ON TABLE media_settings IS 'Controls whether users can upload media directly or must use external links';
COMMENT ON COLUMN media_settings.tenant_id IS 'NULL for global setting, otherwise specific tenant ID';
COMMENT ON COLUMN media_settings.allow_direct_upload IS 'If true, allow direct media uploads. If false, only external links allowed';
