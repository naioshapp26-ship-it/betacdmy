import { errorTranslations } from '../i18n/error-translations.js';

type Lang = 'en' | 'ar';

/**
 * Get localized error message based on language preference
 * Checks Accept-Language header or defaults to English
 */
export function getErrorMessage(
  errorKey: string,
  lang?: Lang,
  fallback?: string
): string {
  const language = lang || 'en';
  const t = errorTranslations[language];
  
  // Navigate through nested error keys (e.g., "errors.authLoginFailed")
  const keys = errorKey.split('.');
  let message: any = t;
  
  for (const key of keys) {
    if (message && typeof message === 'object' && key in message) {
      message = message[key];
    } else {
      return fallback || errorKey;
    }
  }
  
  return typeof message === 'string' ? message : (fallback || errorKey);
}

/**
 * Extract language from Accept-Language header or request
 */
export function getLanguageFromRequest(req: any): Lang {
  const acceptLang = req.headers['accept-language'] || '';
  const langParam = req.query?.lang || req.body?.lang;
  
  // Check explicit lang parameter first
  if (langParam === 'ar' || langParam === 'en') {
    return langParam;
  }
  
  // Check Accept-Language header
  if (acceptLang.toLowerCase().includes('ar')) {
    return 'ar';
  }
  
  return 'en';
}

/**
 * Create error response with localized message
 */
export function createErrorResponse(
  errorKey: string,
  req: any,
  fallback?: string
): { error: string; errorKey?: string } {
  const lang = getLanguageFromRequest(req);
  const message = getErrorMessage(errorKey, lang, fallback);
  
  return {
    error: message,
    ...(process.env.NODE_ENV === 'development' && { errorKey })
  };
}
