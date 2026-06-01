-- Add bilingual fields for announcement bar items

ALTER TABLE ads_announcements
  ADD COLUMN IF NOT EXISTS text_en TEXT DEFAULT '' NOT NULL,
  ADD COLUMN IF NOT EXISTS text_ar TEXT DEFAULT '' NOT NULL;

UPDATE ads_announcements
  SET text_en = COALESCE(NULLIF(text_en, ''), text),
      text_ar = COALESCE(NULLIF(text_ar, ''), text)
  WHERE text IS NOT NULL;
