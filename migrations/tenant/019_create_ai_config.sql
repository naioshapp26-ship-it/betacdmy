-- Migration: Create AI Configuration Table for Tenants
-- Description: Add per-tenant AI configuration (similar to payment gateway config)
-- Date: 2026-01-20

DO $$
BEGIN
  -- Create ai_config table if it doesn't exist
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ai_config') THEN
    CREATE TABLE ai_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      
      -- AI Provider Settings
      ai_enabled BOOLEAN DEFAULT FALSE,
      ai_provider VARCHAR(50) DEFAULT 'gemini', -- 'gemini', 'openai', 'claude', etc.
      ai_model VARCHAR(100) DEFAULT 'gemini-2.5-flash', -- Specific model to use
      
      -- Encrypted API Credentials
      api_key BYTEA, -- Encrypted using pgp_sym_encrypt
      api_secret BYTEA, -- Optional, for providers that need it
      
      -- Optional Configuration
      max_tokens INTEGER DEFAULT 4096,
      temperature DECIMAL(3,2) DEFAULT 0.7,
      custom_config JSONB DEFAULT '{}', -- Additional provider-specific settings
      
      -- Audit Fields
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      created_by UUID REFERENCES users(id),
      updated_by UUID REFERENCES users(id),
      
      -- Ensure only one row exists
      CONSTRAINT ai_config_single_row CHECK (id = 1)
    );

    -- Add columns if table exists but missing columns
  ELSE
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'ai_config' AND column_name = 'created_at') THEN
      ALTER TABLE ai_config ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
    END IF;
    
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'ai_config' AND column_name = 'updated_at') THEN
      ALTER TABLE ai_config ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
    END IF;
    
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'ai_config' AND column_name = 'created_by') THEN
      ALTER TABLE ai_config ADD COLUMN created_by UUID REFERENCES users(id);
    END IF;
    
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'ai_config' AND column_name = 'updated_by') THEN
      ALTER TABLE ai_config ADD COLUMN updated_by UUID REFERENCES users(id);
    END IF;
    
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'ai_config' AND column_name = 'ai_model') THEN
      ALTER TABLE ai_config ADD COLUMN ai_model VARCHAR(100) DEFAULT 'gemini-2.5-flash';
    END IF;
    
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'ai_config' AND column_name = 'max_tokens') THEN
      ALTER TABLE ai_config ADD COLUMN max_tokens INTEGER DEFAULT 4096;
    END IF;
    
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'ai_config' AND column_name = 'temperature') THEN
      ALTER TABLE ai_config ADD COLUMN temperature DECIMAL(3,2) DEFAULT 0.7;
    END IF;
    
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'ai_config' AND column_name = 'custom_config') THEN
      ALTER TABLE ai_config ADD COLUMN custom_config JSONB DEFAULT '{}';
    END IF;
  END IF;
END $$;

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS trg_set_ai_config_updated_at ON ai_config;
CREATE TRIGGER trg_set_ai_config_updated_at
BEFORE UPDATE ON ai_config
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Insert default row if not exists
INSERT INTO ai_config (
  id,
  ai_enabled,
  ai_provider,
  ai_model,
  api_key,
  api_secret,
  max_tokens,
  temperature,
  custom_config
)
VALUES (
  1,
  FALSE,
  'gemini',
  'gemini-2.5-flash',
  NULL,
  NULL,
  4096,
  0.7,
  '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- Add comments for documentation
COMMENT ON TABLE ai_config IS 'AI provider configuration for tenant - allows each tenant to configure their own AI integration';
COMMENT ON COLUMN ai_config.api_key IS 'Encrypted API key using pgp_sym_encrypt';
COMMENT ON COLUMN ai_config.api_secret IS 'Encrypted API secret/additional credential using pgp_sym_encrypt';
COMMENT ON COLUMN ai_config.custom_config IS 'Additional provider-specific configuration as JSON';
