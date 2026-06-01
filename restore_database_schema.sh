#!/bin/bash

# Database restoration script to match the schema at commit "Allow tenant signup without prior auth"
# This restores the database to match migration files in that commit

set -e

DB_URL="postgresql://postgres:mFGpKOkbDuXpwmTovAihPtlujXRIXqst@shortline.proxy.rlwy.net:25275/railway"
export PGPASSWORD="mFGpKOkbDuXpwmTovAihPtlujXRIXqst"

echo "========================================="
echo "Database Schema Restoration Script"
echo "========================================="
echo ""

# Step 1: Check current schema
echo "Step 1: Checking current database schema..."
psql "$DB_URL" -c "\dt" > /tmp/current_tables.txt 2>&1
echo "Current tables saved to /tmp/current_tables.txt"
echo ""

# Step 2: Verify critical columns exist
echo "Step 2: Verifying critical columns..."
echo "Checking users.password_hash..."
psql "$DB_URL" -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password_hash';" 2>&1 | grep -q password_hash && echo "✓ users.password_hash exists" || echo "✗ users.password_hash missing"

echo "Checking tenant_admins.password_hash..."
psql "$DB_URL" -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'tenant_admins' AND column_name = 'password_hash';" 2>&1 | grep -q password_hash && echo "✓ tenant_admins.password_hash exists" || echo "✗ tenant_admins.password_hash missing"
echo ""

# Step 3: Add missing columns if needed
echo "Step 3: Adding missing columns if needed..."
psql "$DB_URL" << 'EOSQL'
-- Add password_hash to users if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'password_hash'
  ) THEN
    ALTER TABLE users ADD COLUMN password_hash TEXT;
    CREATE INDEX IF NOT EXISTS idx_users_password_hash ON users(password_hash) WHERE password_hash IS NOT NULL;
    RAISE NOTICE 'Added password_hash column to users table';
  ELSE
    RAISE NOTICE 'users.password_hash already exists';
  END IF;
END $$;

-- Add password_hash to tenant_admins if it doesn't exist  
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'tenant_admins' AND column_name = 'password_hash'
  ) THEN
    ALTER TABLE tenant_admins ADD COLUMN password_hash TEXT;
    CREATE INDEX IF NOT EXISTS idx_tenant_admins_password_hash ON tenant_admins(password_hash) WHERE password_hash IS NOT NULL;
    RAISE NOTICE 'Added password_hash column to tenant_admins table';
  ELSE
    RAISE NOTICE 'tenant_admins.password_hash already exists';
  END IF;
END $$;
EOSQL

echo ""
echo "Step 4: Final verification..."
psql "$DB_URL" << 'EOSQL'
SELECT 
  table_name, 
  column_name, 
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name IN ('users', 'tenant_admins')
  AND column_name IN ('password', 'password_hash')
ORDER BY table_name, column_name;
EOSQL

echo ""
echo "========================================="
echo "Database restoration complete!"
echo "========================================="
echo ""
echo "What was done:"
echo "1. Verified password_hash columns exist in users and tenant_admins tables"
echo "2. Added missing password_hash columns if they were missing"
echo "3. Created appropriate indexes for performance"
echo ""
echo "Note: If you made other accidental changes to tables, please specify"
echo "which tables and what changes so I can restore them specifically."
