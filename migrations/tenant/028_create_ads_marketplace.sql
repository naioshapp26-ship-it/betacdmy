-- Ads marketplace schema

CREATE TABLE IF NOT EXISTS ad_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category_id UUID REFERENCES ad_categories(id) ON DELETE SET NULL,
  price NUMERIC(10,2),
  location TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  image_url TEXT,
  media_type TEXT DEFAULT 'image',
  media_url TEXT,
  gallery JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  is_featured BOOLEAN DEFAULT false,
  publish_date DATE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ads_display_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hero_title TEXT,
  hero_subtitle TEXT,
  search_placeholder TEXT,
  stat_ads_label TEXT,
  stat_users_label TEXT,
  stat_satisfaction_label TEXT,
  stat_support_label TEXT,
  stat_support_value TEXT DEFAULT '24/7',
  homepage_promo_enabled BOOLEAN DEFAULT false,
  homepage_promo_type TEXT DEFAULT 'image',
  homepage_promo_media_url TEXT,
  homepage_promo_link TEXT,
  homepage_promo_title TEXT,
  homepage_promo_subtitle TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ads_status_created_at ON ads(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ads_category ON ads(category_id);
CREATE INDEX IF NOT EXISTS idx_ads_featured ON ads(is_featured);
