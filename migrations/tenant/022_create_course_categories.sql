-- Create course categories table
CREATE TABLE IF NOT EXISTS course_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_course_categories_name ON course_categories(name);

-- Seed default categories if table is empty
INSERT INTO course_categories (name)
SELECT unnest(ARRAY[
  'Technology',
  'Business',
  'Finance',
  'Marketing',
  'Design',
  'Languages',
  'Personal Development',
  'Health & Fitness',
  'Academics',
  'Professional Skills'
])
WHERE NOT EXISTS (SELECT 1 FROM course_categories);
