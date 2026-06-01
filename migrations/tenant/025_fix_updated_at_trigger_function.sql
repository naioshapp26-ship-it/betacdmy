-- =====================================================
-- Migration: Fix updated_at trigger for legacy tables
-- Description:
--  - Makes set_updated_at() safe when updated_at column is missing (legacy schemas)
-- Date: 2026-02-18
-- =====================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  IF to_jsonb(NEW) ? 'updated_at' THEN
    NEW := jsonb_populate_record(NEW, jsonb_build_object('updated_at', NOW()));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
