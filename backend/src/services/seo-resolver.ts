type SeoLanguage = 'en' | 'ar';

type SeoDefaults = {
  title?: string;
  description?: string;
  keywords?: string;
  siteName?: string;
  imageUrl?: string;
  robots?: string;
  indexable?: boolean;
};

type SeoRow = {
  page_path: string;
  title_en?: string | null;
  title_ar?: string | null;
  description_en?: string | null;
  description_ar?: string | null;
  keywords_en?: string | null;
  keywords_ar?: string | null;
  canonical_url?: string | null;
  robots?: string | null;
  indexable?: boolean | null;
  og_title_en?: string | null;
  og_title_ar?: string | null;
  og_description_en?: string | null;
  og_description_ar?: string | null;
  og_image_url?: string | null;
  og_type?: string | null;
  og_site_name?: string | null;
  twitter_card?: string | null;
  twitter_title_en?: string | null;
  twitter_title_ar?: string | null;
  twitter_description_en?: string | null;
  twitter_description_ar?: string | null;
  twitter_image_url?: string | null;
  jsonld_en?: string | null;
  jsonld_ar?: string | null;
  locale?: string | null;
  locale_alternate?: string | null;
  sitemap_priority?: number | null;
  sitemap_changefreq?: string | null;
};

type DynamicSeo = {
  title?: string;
  description?: string;
  imageUrl?: string;
  ogType?: string;
  contentType?: 'blog_post' | 'course' | 'instructor';
  contentId?: string;
};

type ResolveSeoInput = {
  path: string;
  search?: string;
  lang?: SeoLanguage;
  tenantPool?: { query: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number }> } | null;
  isCentral?: boolean;
  baseUrl?: string;
  defaults?: SeoDefaults;
};

type ResolvedSeo = {
  page_path: string;
  title?: string;
  description?: string;
  keywords?: string;
  canonical_url?: string;
  robots?: string;
  indexable: boolean;
  og: {
    title?: string;
    description?: string;
    image?: string;
    type?: string;
    site_name?: string;
  };
  twitter: {
    card?: string;
    title?: string;
    description?: string;
    image?: string;
  };
  jsonld?: string;
  locale?: string;
  locale_alternate?: string;
  sitemap_priority?: number | null;
  sitemap_changefreq?: string | null;
};

const BLOG_PATH_REGEX = /^\/blog\/([^/]+)$/;
const INSTRUCTOR_PROFILE_REGEX = /^\/instructor-profile\/([^/]+)$/;
const COURSE_PLAYER_PATH = '/course-player';

const normalizeRoutePath = (value = '/') => {
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

const extractBlogSlugFromPath = (pathname: string) => {
  const normalizedPath = normalizeRoutePath(pathname);
  const match = normalizedPath.match(BLOG_PATH_REGEX);
  return match ? match[1] : null;
};

const extractInstructorIdFromPath = (pathname: string) => {
  const normalizedPath = normalizeRoutePath(pathname);
  const match = normalizedPath.match(INSTRUCTOR_PROFILE_REGEX);
  return match ? match[1] : null;
};

const extractCourseIdFromSearch = (search = '') => {
  if (!search) return null;
  const query = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  return params.get('courseId');
};

const resolveLocale = (lang: SeoLanguage, override?: string | null) => {
  if (override) return override;
  return lang === 'ar' ? 'ar_AR' : 'en_US';
};

const resolveAlternateLocale = (lang: SeoLanguage, override?: string | null) => {
  if (override) return override;
  return lang === 'ar' ? 'en_US' : 'ar_AR';
};

const resolveText = (lang: SeoLanguage, en?: string | null, ar?: string | null) => {
  if (lang === 'ar') return ar || en || undefined;
  return en || ar || undefined;
};

const resolveCanonicalUrl = (baseUrl?: string, path?: string, search?: string, override?: string | null) => {
  if (override) return override;
  if (!baseUrl || !path) return undefined;
  const normalizedPath = normalizeRoutePath(path);
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const withQuery = search ? `${normalizedPath}${search}` : normalizedPath;
  return `${normalizedBase}${withQuery}`;
};

const buildDynamicSeo = async (
  pool: { query: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number }> },
  path: string,
  search?: string
): Promise<DynamicSeo> => {
  const normalizedPath = normalizeRoutePath(path);
  const blogSlug = extractBlogSlugFromPath(normalizedPath);
  if (blogSlug) {
    const result = await pool.query(
      'SELECT title, excerpt, image, uploaded_image_path FROM blog_posts WHERE slug = $1 OR id::text = $1',
      [blogSlug]
    );
    if (result.rowCount) {
      const row = result.rows[0];
      return {
        contentType: 'blog_post',
        contentId: row.id,
        title: row.title || undefined,
        description: row.excerpt || undefined,
        imageUrl: row.uploaded_image_path || row.image || undefined,
        ogType: 'article'
      };
    }
  }

  if (normalizedPath === COURSE_PLAYER_PATH) {
    const courseId = extractCourseIdFromSearch(search);
    if (courseId) {
      const result = await pool.query(
        'SELECT title, description, thumbnail FROM courses WHERE id = $1',
        [courseId]
      );
      if (result.rowCount) {
        const row = result.rows[0];
        return {
          contentType: 'course',
          contentId: courseId,
          title: row.title || undefined,
          description: row.description || undefined,
          imageUrl: row.thumbnail || undefined
        };
      }
    }
  }

  const instructorId = extractInstructorIdFromPath(normalizedPath);
  if (instructorId) {
    const result = await pool.query(
      "SELECT name, bio, avatar FROM users WHERE id = $1 AND role = 'INSTRUCTOR'",
      [instructorId]
    );
    if (result.rowCount) {
      const row = result.rows[0];
      return {
        contentType: 'instructor',
        contentId: instructorId,
        title: row.name || undefined,
        description: row.bio || undefined,
        imageUrl: row.avatar || undefined
      };
    }
  }

  return {};
};

const mergeSeoRows = (override?: SeoRow | null, base?: SeoRow | null): SeoRow | null => {
  if (!override && !base) return null;
  const merged: SeoRow = {
    page_path: override?.page_path || base?.page_path || ''
  };
  const fields: Array<keyof SeoRow> = [
    'title_en', 'title_ar', 'description_en', 'description_ar', 'keywords_en', 'keywords_ar',
    'canonical_url', 'robots', 'indexable', 'og_title_en', 'og_title_ar', 'og_description_en',
    'og_description_ar', 'og_image_url', 'og_type', 'og_site_name', 'twitter_card',
    'twitter_title_en', 'twitter_title_ar', 'twitter_description_en', 'twitter_description_ar',
    'twitter_image_url', 'jsonld_en', 'jsonld_ar', 'locale', 'locale_alternate',
    'sitemap_priority', 'sitemap_changefreq'
  ];

  fields.forEach((field) => {
    const overrideValue = override?.[field];
    const baseValue = base?.[field];
    (merged as any)[field] = overrideValue !== undefined && overrideValue !== null ? overrideValue : baseValue;
  });

  return merged;
};

const fetchSeoOverride = async (
  pool: { query: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number }> },
  contentType: 'blog_post' | 'course',
  contentId: string
): Promise<SeoRow | null> => {
  const result = await pool.query(
    'SELECT * FROM seo_overrides WHERE content_type = $1 AND content_id = $2',
    [contentType, contentId]
  );
  return result.rowCount ? (result.rows[0] as SeoRow) : null;
};

export const resolveSeoForPath = async (input: ResolveSeoInput): Promise<ResolvedSeo> => {
  const {
    path,
    search,
    lang = 'en',
    tenantPool,
    isCentral = false,
    baseUrl,
    defaults
  } = input;

  const normalizedPath = normalizeRoutePath(path);
  const pool = isCentral ? null : tenantPool;

  let seoRow: SeoRow | null = null;
  if (isCentral) {
    const { centralPool } = await import('../central-db.js');
    const result = await centralPool.query(
      'SELECT * FROM central_seo_settings WHERE page_path = $1',
      [normalizedPath]
    );
    seoRow = result.rowCount ? (result.rows[0] as SeoRow) : null;
  } else if (pool) {
    const result = await pool.query(
      'SELECT * FROM seo_settings WHERE page_path = $1',
      [normalizedPath]
    );
    seoRow = result.rowCount ? (result.rows[0] as SeoRow) : null;
  }

  const dynamicSeo = pool ? await buildDynamicSeo(pool, normalizedPath, search) : {};
  const overrideSeo = pool && dynamicSeo.contentType && dynamicSeo.contentId && dynamicSeo.contentType !== 'instructor'
    ? await fetchSeoOverride(pool, dynamicSeo.contentType, dynamicSeo.contentId)
    : null;
  const effectiveSeo = mergeSeoRows(overrideSeo, seoRow);

  const title =
    resolveText(lang, effectiveSeo?.title_en, effectiveSeo?.title_ar)
    || dynamicSeo.title
    || defaults?.title;

  const description =
    resolveText(lang, effectiveSeo?.description_en, effectiveSeo?.description_ar)
    || dynamicSeo.description
    || defaults?.description;

  const keywords =
    resolveText(lang, effectiveSeo?.keywords_en, effectiveSeo?.keywords_ar)
    || defaults?.keywords;

  const canonical_url = resolveCanonicalUrl(
    baseUrl,
    normalizedPath,
    search,
    effectiveSeo?.canonical_url
  );

  const robots = effectiveSeo?.robots || defaults?.robots;
  const indexable = effectiveSeo?.indexable ?? defaults?.indexable ?? true;

  const ogTitle = resolveText(lang, effectiveSeo?.og_title_en, effectiveSeo?.og_title_ar) || title;
  const ogDescription = resolveText(lang, effectiveSeo?.og_description_en, effectiveSeo?.og_description_ar) || description;
  const ogImage = effectiveSeo?.og_image_url || dynamicSeo.imageUrl || defaults?.imageUrl;
  const ogType = effectiveSeo?.og_type || dynamicSeo.ogType || 'website';
  const ogSiteName = effectiveSeo?.og_site_name || defaults?.siteName;

  const twitterTitle = resolveText(lang, effectiveSeo?.twitter_title_en, effectiveSeo?.twitter_title_ar) || title;
  const twitterDescription = resolveText(lang, effectiveSeo?.twitter_description_en, effectiveSeo?.twitter_description_ar) || description;
  const twitterImage = effectiveSeo?.twitter_image_url || ogImage;

  const jsonld = resolveText(lang, effectiveSeo?.jsonld_en, effectiveSeo?.jsonld_ar);

  return {
    page_path: normalizedPath,
    title,
    description,
    keywords,
    canonical_url,
    robots,
    indexable,
    og: {
      title: ogTitle,
      description: ogDescription,
      image: ogImage,
      type: ogType,
      site_name: ogSiteName
    },
    twitter: {
      card: effectiveSeo?.twitter_card || 'summary_large_image',
      title: twitterTitle,
      description: twitterDescription,
      image: twitterImage
    },
    jsonld: jsonld || undefined,
    locale: resolveLocale(lang, effectiveSeo?.locale),
    locale_alternate: resolveAlternateLocale(lang, effectiveSeo?.locale_alternate),
    sitemap_priority: effectiveSeo?.sitemap_priority ?? null,
    sitemap_changefreq: effectiveSeo?.sitemap_changefreq ?? null
  };
};

export type { ResolvedSeo, SeoDefaults, SeoLanguage };
