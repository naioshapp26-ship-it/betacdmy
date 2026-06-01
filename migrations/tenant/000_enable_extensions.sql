-- Tenant database bootstrap (no PostgreSQL extensions required on managed hosting)

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  IF to_jsonb(NEW) ? 'updated_at' THEN
    NEW := jsonb_populate_record(NEW, jsonb_build_object('updated_at', NOW()));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
