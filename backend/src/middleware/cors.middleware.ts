import cors from 'cors';

/**
 * CORS Configuration Middleware
 * 
 * Configurable Cross-Origin Resource Sharing for API and media routes
 * with environment variable support for production deployments.
 */

// Parse allowed origins from environment variable
const getAllowedOrigins = () => {
  const envOrigins = process.env.CORS_ALLOWED_ORIGINS;

  if (envOrigins) {
    // Split by comma and trim whitespace
    return envOrigins.split(',').map(origin => origin.trim()).filter(Boolean);
  }

  // Default allowed origins
  const defaults = [];

  // In development, always allow localhost
  if (process.env.NODE_ENV !== 'production') {
    defaults.push(
      'http://localhost:3000',
      'http://localhost:5173',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173'
    );
  }

  // Add main domain if specified
  if (process.env.MAIN_DOMAIN) {
    const protocol = process.env.PROTOCOL || 'https';
    defaults.push(`${protocol}://${process.env.MAIN_DOMAIN}`);
    // Also allow www subdomain
    defaults.push(`${protocol}://www.${process.env.MAIN_DOMAIN}`);
  }

  // Add Railway deployment URL if specified
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    defaults.push(`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
  }

  return defaults.length > 0 ? defaults : ['*'];
};

const allowedOrigins = getAllowedOrigins();
const allowWildcard = allowedOrigins.includes('*');

/**
 * Check if an origin is a valid subdomain of the main domain.
 * This allows tenant subdomains (e.g. https://beta.betacdmy.com) automatically.
 */
const mainDomain = (process.env.MAIN_DOMAIN || '').toLowerCase();
const isTenantSubdomainOrigin = (origin: string): boolean => {
  if (!mainDomain) return false;
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    // Must end with .MAIN_DOMAIN and not be just MAIN_DOMAIN or www.MAIN_DOMAIN
    if (!hostname.endsWith(`.${mainDomain}`)) return false;
    const sub = hostname.slice(0, -(mainDomain.length + 1));
    return sub.length > 0 && sub !== 'www';
  } catch {
    return false;
  }
};

/**
 * CORS Configuration for API Routes
 * Stricter policy for authenticated endpoints
 */
export const apiCorsConfig = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) {
      return callback(null, true);
    }

    // Check if origin is allowed
    if (allowWildcard || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Allow any tenant subdomain of the main domain automatically
    if (isTenantSubdomainOrigin(origin)) {
      return callback(null, true);
    }

    // Check for subdomain wildcards in the configured origins
    const isAllowedSubdomain = allowedOrigins.some(allowedOrigin => {
      if (allowedOrigin.includes('*')) {
        const pattern = allowedOrigin.replace(/\*/g, '.*');
        const regex = new RegExp(`^${pattern}$`);
        return regex.test(origin);
      }
      return false;
    });

    if (isAllowedSubdomain) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // Allow cookies and authentication headers
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Cookie',
    'Set-Cookie',
    'X-Tenant-Id',
    'X-CSRF-Token'
  ],
  exposedHeaders: ['Set-Cookie'],
  maxAge: 86400, // 24 hours for preflight cache
  preflightContinue: false,
  optionsSuccessStatus: 204
});

/**
 * CORS Configuration for Media Routes
 * More permissive to support streaming from different origins
 */
export const mediaCorsConfig = cors({
  origin: (origin, callback) => {
    // For media, allow all origins if CORS_MEDIA_ALLOW_ALL is set
    if (process.env.CORS_MEDIA_ALLOW_ALL === 'true') {
      return callback(null, true);
    }

    // Otherwise use the same logic as API CORS
    if (!origin || allowWildcard || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Allow tenant subdomains
    if (isTenantSubdomainOrigin(origin)) {
      return callback(null, true);
    }

    const isAllowedSubdomain = allowedOrigins.some(allowedOrigin => {
      if (allowedOrigin.includes('*')) {
        const pattern = allowedOrigin.replace(/\*/g, '.*');
        const regex = new RegExp(`^${pattern}$`);
        return regex.test(origin);
      }
      return false;
    });

    callback(null, isAllowedSubdomain);
  },
  credentials: false, // Media doesn't need credentials
  methods: ['GET', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Range', 'Accept', 'Content-Type'],
  exposedHeaders: ['Accept-Ranges', 'Content-Length', 'Content-Range', 'Content-Type'],
  maxAge: 3600, // 1 hour for preflight cache
  preflightContinue: false,
  optionsSuccessStatus: 204
});

/**
 * Get CORS configuration info for debugging/logging
 */
export const getCorsConfig = () => {
  return {
    allowedOrigins: allowWildcard ? ['*'] : allowedOrigins,
    isProduction: process.env.NODE_ENV === 'production',
    mediaAllowAll: process.env.CORS_MEDIA_ALLOW_ALL === 'true',
    wildcardEnabled: allowWildcard
  };
};
