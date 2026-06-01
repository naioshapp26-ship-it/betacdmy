-- Add created_by column to courses table
-- This migration adds audit metadata to track who created each course

ALTER TABLE courses 
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Add comment for documentation
COMMENT ON COLUMN courses.created_by IS 'User who created this course';

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_courses_created_by ON courses(created_by);
