import blogImageConfig from '@/blogImageConfig.json';

type BlogImageConfig = {
  fallback?: string;
  blockedSources?: string[];
};

const config = (blogImageConfig || {}) as BlogImageConfig;

export const BLOG_IMAGE_FALLBACK = config.fallback ?? '/blog-placeholder.svg';
const BLOCKED_BLOG_IMAGE_PATTERNS = config.blockedSources ?? [];

export const isBlockedBlogImage = (source?: string): boolean => {
  if (!source) {
    return false;
  }
  return BLOCKED_BLOG_IMAGE_PATTERNS.some((pattern) => source.includes(pattern));
};

export const resolveBlogImage = (image?: string, uploadedImagePath?: string): string => {
  if (uploadedImagePath) {
    return uploadedImagePath;
  }
  if (!image || isBlockedBlogImage(image)) {
    return BLOG_IMAGE_FALLBACK;
  }
  return image;
};

export const sanitizeBlogImageInput = (image?: string): string => {
  if (!image) {
    return '';
  }
  return isBlockedBlogImage(image) ? '' : image;
};
