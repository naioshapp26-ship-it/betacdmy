-- Clear public schema objects (cPanel users are usually not schema owners).
-- Order: tables/views -> functions/procedures -> types -> sequences

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  ) LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
  END LOOP;
END $$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT viewname AS name FROM pg_views WHERE schemaname = 'public'
  ) LOOP
    EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE', r.name);
  END LOOP;
END $$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT p.oid, p.proname, n.nspname, p.prokind
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  ) LOOP
    IF r.prokind = 'p' THEN
      EXECUTE format(
        'DROP PROCEDURE IF EXISTS %I.%I(%s) CASCADE',
        r.nspname,
        r.proname,
        pg_get_function_identity_arguments(r.oid)
      );
    ELSE
      EXECUTE format(
        'DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE',
        r.nspname,
        r.proname,
        pg_get_function_identity_arguments(r.oid)
      );
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typtype = 'e'
  ) LOOP
    EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname);
  END LOOP;
END $$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT sequencename
    FROM pg_sequences
    WHERE schemaname = 'public'
  ) LOOP
    EXECUTE format('DROP SEQUENCE IF EXISTS public.%I CASCADE', r.sequencename);
  END LOOP;
END $$;
