-- Add category column to courses table
ALTER TABLE courses 
ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Technology';

-- Create index for faster category filtering
CREATE INDEX IF NOT EXISTS idx_courses_category ON courses(category);

-- Update existing courses to have a default category if NULL
UPDATE courses SET category = 'Technology' WHERE category IS NULL;
