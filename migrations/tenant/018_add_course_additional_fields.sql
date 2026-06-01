-- Migration 018: Add additional fields to courses table
-- Adds language, status, targetAudience, prerequisites, and learningOutcomes

ALTER TABLE courses 
ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'en',
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'draft',
ADD COLUMN IF NOT EXISTS target_audience TEXT,
ADD COLUMN IF NOT EXISTS prerequisites TEXT,
ADD COLUMN IF NOT EXISTS learning_outcomes TEXT;

-- Add check constraint for language
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'courses_language_check'
	) THEN
		ALTER TABLE courses
			ADD CONSTRAINT courses_language_check
			CHECK (language IN ('en', 'ar', 'fr', 'es'));
	END IF;
END$$;

-- Add check constraint for status
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'courses_status_check'
	) THEN
		ALTER TABLE courses
			ADD CONSTRAINT courses_status_check
			CHECK (status IN ('draft', 'published'));
	END IF;
END$$;

-- Create index on status for faster filtering
CREATE INDEX IF NOT EXISTS idx_courses_status ON courses(status);

-- Create index on language for faster filtering
CREATE INDEX IF NOT EXISTS idx_courses_language ON courses(language);
