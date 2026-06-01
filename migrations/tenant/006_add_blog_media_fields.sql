-- Add video and media fields to blog_posts table
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS video_url TEXT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS uploaded_image_path TEXT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS uploaded_video_path TEXT;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON blog_posts(status);
