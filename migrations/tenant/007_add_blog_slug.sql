-- Add slug column to blog_posts table
-- Slugs are URL-friendly versions of titles used for SEO-friendly URLs

-- Add slug column
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;

-- Create function to generate slug from title
CREATE OR REPLACE FUNCTION generate_blog_slug(title TEXT)
RETURNS TEXT AS $$
DECLARE
  base_slug TEXT;
  final_slug TEXT;
  counter INTEGER := 0;
BEGIN
  -- Convert to lowercase, replace special chars with hyphens, remove multiple hyphens
  base_slug := lower(regexp_replace(
    regexp_replace(
      regexp_replace(title, '[^a-zA-Z0-9\s-]', '', 'g'),
      '\s+', '-', 'g'
    ),
    '-+', '-', 'g'
  ));
  
  -- Trim hyphens from start and end
  base_slug := trim(both '-' from base_slug);
  
  -- Limit length to 100 characters
  base_slug := substring(base_slug from 1 for 100);
  
  final_slug := base_slug;
  
  -- Check for uniqueness and append counter if needed
  WHILE EXISTS (SELECT 1 FROM blog_posts WHERE slug = final_slug) LOOP
    counter := counter + 1;
    final_slug := base_slug || '-' || counter;
  END LOOP;
  
  RETURN final_slug;
END;
$$ LANGUAGE plpgsql;

-- Generate slugs for existing posts that don't have them
UPDATE blog_posts 
SET slug = generate_blog_slug(title)
WHERE slug IS NULL OR slug = '';

-- Make slug NOT NULL after populating existing records
ALTER TABLE blog_posts ALTER COLUMN slug SET NOT NULL;

-- Create index on slug for faster lookups
CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON blog_posts(slug);

-- Create trigger to auto-generate slug on insert if not provided
CREATE OR REPLACE FUNCTION auto_generate_blog_slug()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := generate_blog_slug(NEW.title);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS blog_posts_auto_slug ON blog_posts;
CREATE TRIGGER blog_posts_auto_slug
  BEFORE INSERT OR UPDATE ON blog_posts
  FOR EACH ROW
  EXECUTE FUNCTION auto_generate_blog_slug();
