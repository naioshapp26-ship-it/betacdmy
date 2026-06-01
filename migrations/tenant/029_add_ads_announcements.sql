-- Add top announcement items for ads management marquee

CREATE TABLE IF NOT EXISTS ads_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  show_in_top_bar BOOLEAN DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ads_announcements_sequence
  ON ads_announcements(enabled, show_in_top_bar, sort_order, created_at DESC);
