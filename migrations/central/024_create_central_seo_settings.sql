-- Migration: Create Central SEO Settings Table
-- Description: Stores SEO metadata for main domain pages with bilingual support (English & Arabic)

CREATE TABLE IF NOT EXISTS central_seo_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_path VARCHAR(255) NOT NULL UNIQUE,
    title_en VARCHAR(255),
    title_ar VARCHAR(255),
    description_en TEXT,
    description_ar TEXT,
    keywords_en TEXT,
    keywords_ar TEXT,
    canonical_url TEXT,
    robots VARCHAR(255),
    indexable BOOLEAN DEFAULT TRUE,
    og_title_en VARCHAR(255),
    og_title_ar VARCHAR(255),
    og_description_en TEXT,
    og_description_ar TEXT,
    og_image_url TEXT,
    og_type VARCHAR(100),
    og_site_name VARCHAR(255),
    twitter_card VARCHAR(100),
    twitter_title_en VARCHAR(255),
    twitter_title_ar VARCHAR(255),
    twitter_description_en TEXT,
    twitter_description_ar TEXT,
    twitter_image_url TEXT,
    jsonld_en TEXT,
    jsonld_ar TEXT,
    locale VARCHAR(100),
    locale_alternate VARCHAR(255),
    sitemap_priority NUMERIC(3,2),
    sitemap_changefreq VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID
);

-- Create index on page_path for faster lookups
CREATE INDEX IF NOT EXISTS idx_central_seo_settings_page_path ON central_seo_settings(page_path);

-- Create index on updated_at for sorting
CREATE INDEX IF NOT EXISTS idx_central_seo_settings_updated_at ON central_seo_settings(updated_at DESC);

-- Add trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_central_seo_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_central_seo_settings_updated_at ON central_seo_settings;
CREATE TRIGGER trigger_update_central_seo_settings_updated_at
    BEFORE UPDATE ON central_seo_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_central_seo_settings_updated_at();
