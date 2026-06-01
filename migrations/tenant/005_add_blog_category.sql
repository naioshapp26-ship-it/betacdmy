-- Add category column to blog_posts table
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Technology';

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_blog_posts_category ON blog_posts(category);

-- Update existing blog posts to have a default category
UPDATE blog_posts SET category = 'Technology' WHERE category IS NULL;
