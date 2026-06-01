-- AI Configuration for Super Admin (Platform Level / Main Domain)
-- This table stores AI provider credentials for the main platform (www.betacdmy.com)
-- These are used ONLY for platform-level AI features, NOT for tenant features

-- Check if table exists and add missing columns if needed
DO $$ 
BEGIN
  -- Create table if it doesn't exist
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ai_config') THEN
    CREATE TABLE ai_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      
      -- AI Provider Settings
      ai_enabled BOOLEAN NOT NULL DEFAULT false,
      ai_provider VARCHAR(50) NOT NULL DEFAULT 'gemini', -- 'gemini', 'openai', 'claude', etc.
      ai_model VARCHAR(100) NOT NULL DEFAULT 'gemini-2.5-flash', -- Specific model to use
      
      -- Encrypted API Credentials (using pgp_sym_encrypt)
      api_key BYTEA, -- Encrypted API key
      api_secret BYTEA, -- Optional encrypted secret for providers that need it
      
      -- Configuration Parameters
      max_tokens INTEGER NOT NULL DEFAULT 4096,
      temperature DECIMAL(3,2) NOT NULL DEFAULT 0.7,
      custom_config JSONB NOT NULL DEFAULT '{}', -- Additional provider-specific settings
      
      -- Metadata
      updated_by UUID REFERENCES tenant_admins(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      
      CONSTRAINT ai_config_single_row CHECK (id = 1)
    );
  ELSE
    -- Add missing columns if table exists
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
    
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'ai_config' AND column_name = 'created_at') THEN
      ALTER TABLE ai_config ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
    END IF;
  END IF;
END $$;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trg_set_ai_config_updated_at ON ai_config;
CREATE TRIGGER trg_set_ai_config_updated_at
BEFORE UPDATE ON ai_config
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Insert default row (AI disabled initially)
INSERT INTO ai_config (
  id,
  ai_enabled,
  ai_provider,
  ai_model,
  api_key,
  api_secret,
  max_tokens,
  temperature,
  custom_config,
  updated_by
) VALUES (
  1,
  false,
  'gemini',
  'gemini-2.5-flash',
  NULL,
  NULL,
  4096,
  0.7,
  '{}'::jsonb,
  NULL
) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE ai_config IS 'AI provider configuration for Super Admin (platform level / main domain only) - used for platform AI features';
COMMENT ON COLUMN ai_config.api_key IS 'Encrypted API key using pgp_sym_encrypt';
COMMENT ON COLUMN ai_config.api_secret IS 'Encrypted API secret/additional credential using pgp_sym_encrypt';
COMMENT ON COLUMN ai_config.custom_config IS 'Additional provider-specific configuration as JSON';
