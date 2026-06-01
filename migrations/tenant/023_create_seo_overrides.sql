-- Migration: Create SEO Overrides Table
-- Description: Stores SEO overrides for dynamic content (courses, blog posts, lessons)

CREATE TABLE IF NOT EXISTS seo_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_type VARCHAR(50) NOT NULL,
    content_id UUID NOT NULL,
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
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (content_type, content_id)
);

CREATE INDEX IF NOT EXISTS idx_seo_overrides_content ON seo_overrides(content_type, content_id);

CREATE OR REPLACE FUNCTION update_seo_overrides_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Make trigger creation idempotent (PostgreSQL has no CREATE TRIGGER IF NOT EXISTS)
DROP TRIGGER IF EXISTS trigger_update_seo_overrides_updated_at ON seo_overrides;
CREATE TRIGGER trigger_update_seo_overrides_updated_at
    BEFORE UPDATE ON seo_overrides
    FOR EACH ROW
    EXECUTE FUNCTION update_seo_overrides_updated_at();
