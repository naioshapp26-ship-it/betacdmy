CREATE SEQUENCE IF NOT EXISTS users_public_user_id_seq;

ALTER TABLE IF EXISTS users
ADD COLUMN IF NOT EXISTS public_user_id TEXT;

ALTER TABLE IF EXISTS users
ALTER COLUMN public_user_id SET DEFAULT ('U-' || LPAD(nextval('users_public_user_id_seq')::text, 6, '0'));

DO $$
DECLARE
  max_existing BIGINT := 0;
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RETURN;
  END IF;

  UPDATE users
  SET public_user_id = 'U-' || LPAD(nextval('users_public_user_id_seq')::text, 6, '0')
  WHERE public_user_id IS NULL;

  SELECT COALESCE(MAX(COALESCE(substring(public_user_id FROM '([0-9]+)$')::BIGINT, 0)), 0)
    INTO max_existing
  FROM users
  WHERE public_user_id ~ '^U-[0-9]+$';

  IF max_existing > 0 THEN
    PERFORM setval('users_public_user_id_seq', max_existing, true);
  ELSE
    PERFORM setval('users_public_user_id_seq', 1, false);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_public_user_id_unique ON users (public_user_id);

ALTER TABLE IF EXISTS users
ALTER COLUMN public_user_id SET NOT NULL;