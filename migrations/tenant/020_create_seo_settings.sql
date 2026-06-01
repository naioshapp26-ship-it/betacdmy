-- Migration: Create SEO Settings Table
-- Description: Stores SEO metadata for pages/routes with bilingual support (English & Arabic)

CREATE TABLE IF NOT EXISTS seo_settings (
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
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Create index on page_path for faster lookups
CREATE INDEX IF NOT EXISTS idx_seo_settings_page_path ON seo_settings(page_path);

-- Create index on updated_at for sorting
CREATE INDEX IF NOT EXISTS idx_seo_settings_updated_at ON seo_settings(updated_at DESC);

-- Add trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_seo_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Make trigger creation idempotent (PostgreSQL has no CREATE TRIGGER IF NOT EXISTS)
DROP TRIGGER IF EXISTS trigger_update_seo_settings_updated_at ON seo_settings;
CREATE TRIGGER trigger_update_seo_settings_updated_at
    BEFORE UPDATE ON seo_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_seo_settings_updated_at();

-- Insert default SEO settings for common pages
INSERT INTO seo_settings (page_path, title_en, title_ar, description_en, description_ar, keywords_en, keywords_ar) VALUES
('/dashboard', 'Dashboard', 'لوحة التحكم', 'Access your learning dashboard', 'الوصول إلى لوحة التحكم التعليمية', 'dashboard, learning, courses', 'لوحة التحكم, تعلم, دورات'),
('/courses', 'Courses', 'الدورات', 'Browse available courses', 'تصفح الدورات المتاحة', 'courses, learning, education', 'دورات, تعلم, تعليم'),
('/blog', 'Blog', 'المدونة', 'Read our latest articles', 'اقرأ أحدث مقالاتنا', 'blog, articles, news', 'مدونة, مقالات, أخبار'),
('/', 'Home', 'الصفحة الرئيسية', 'Welcome to our learning platform', 'مرحباً بك في منصتنا التعليمية', 'home, education, learning', 'الصفحة الرئيسية, تعليم, تعلم')
ON CONFLICT (page_path) DO NOTHING;
