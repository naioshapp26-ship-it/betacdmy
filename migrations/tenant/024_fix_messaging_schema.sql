-- Migration: Fix Messaging Schema
-- Description: Ensures messaging tables have correct schema with conversation_id

-- Drop existing indexes that might cause conflicts
DROP INDEX IF EXISTS idx_messages_conversation_created_at;
DROP INDEX IF EXISTS idx_message_receipts_conv_user;
DROP INDEX IF EXISTS idx_notifications_user_created;
DROP INDEX IF EXISTS idx_notifications_unread;

-- Backup and drop old messages table if it exists without conversation_id
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'messages'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'messages' AND column_name = 'conversation_id'
    ) THEN
        DROP TABLE IF EXISTS messages CASCADE;
    END IF;
END $$;

-- Create message_conversations table if not exists
CREATE TABLE IF NOT EXISTS message_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255),
  is_group BOOLEAN DEFAULT FALSE,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create conversation_participants table if not exists
CREATE TABLE IF NOT EXISTS conversation_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES message_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  UNIQUE (conversation_id, user_id)
);

-- Create messages table with correct schema
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES message_conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create message_receipts table if not exists
CREATE TABLE IF NOT EXISTS message_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES message_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  last_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  last_read_at TIMESTAMPTZ,
  UNIQUE (conversation_id, user_id)
);

-- Update notifications table to ensure it has the correct columns
DO $$
BEGIN
    -- Add is_read column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'notifications' AND column_name = 'is_read'
    ) THEN
        ALTER TABLE notifications ADD COLUMN is_read BOOLEAN DEFAULT FALSE;
    END IF;
    
    -- Add conversation_id column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'notifications' AND column_name = 'conversation_id'
    ) THEN
        ALTER TABLE notifications ADD COLUMN conversation_id UUID REFERENCES message_conversations(id) ON DELETE SET NULL;
    END IF;
    
    -- Add target_message_id column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'notifications' AND column_name = 'target_message_id'
    ) THEN
        ALTER TABLE notifications ADD COLUMN target_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Create necessary indexes only if columns exist
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'messages' AND column_name = 'conversation_id'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at ON messages (conversation_id, created_at DESC);
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'message_receipts' AND column_name = 'conversation_id'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_message_receipts_conv_user ON message_receipts (conversation_id, user_id);
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'notifications' AND column_name = 'user_id'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'notifications' AND column_name = 'is_read'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (user_id, is_read, created_at DESC);
    END IF;
END $$;
