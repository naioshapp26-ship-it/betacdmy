// @ts-check

const BLOG_POST_PATH_REGEX = /^\/blog\/([^/]+)$/;

/**
 * Normalize route-like paths by trimming whitespace and trailing slashes.
 * Ensures the returned value always starts with '/'.
 * @param {string} value
 * @returns {string}
 */
export const normalizeRoutePath = (value = '/') => {
  if (!value || value === '/') {
    return '/';
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }
  const withoutTrailing = trimmed.replace(/\/+$/, '');
  if (!withoutTrailing) {
    return '/';
  }
  return withoutTrailing.startsWith('/') ? withoutTrailing : `/${withoutTrailing}`;
};

/**
 * Extract the blog post slug (or ID) from a pathname, accounting for tenant base paths.
 * This works with both slug-based and ID-based URLs for backward compatibility.
 * @param {string} pathname
 * @param {string} [tenantBasePath='']
 * @returns {string | null}
 */
export const extractBlogPostSlugFromPath = (pathname, tenantBasePath = '') => {
  const normalizedPath = normalizeRoutePath(pathname);
  const normalizedBase = tenantBasePath ? normalizeRoutePath(tenantBasePath) : '';
  const relativeCandidate =
    normalizedBase && normalizedPath.startsWith(normalizedBase)
      ? normalizedPath.slice(normalizedBase.length) || '/'
      : normalizedPath;
  const relativePath = normalizeRoutePath(relativeCandidate);
  const match = relativePath.match(BLOG_POST_PATH_REGEX);
  return match ? match[1] : null;
};

// Keep old function name for backward compatibility but redirect to new function
export const extractBlogPostIdFromPath = extractBlogPostSlugFromPath;

