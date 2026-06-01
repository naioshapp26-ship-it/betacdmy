import { translations } from '../translations';

type Lang = 'en' | 'ar';

/**
 * Get localized error message for frontend
 */
export function getErrorMessage(
  errorKey: string,
  lang: Lang = 'en',
  fallback?: string
): string {
  const t = translations[lang];
  
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
 * Get error message from API error response
 * Handles both error objects and error strings
 */
export function getApiErrorMessage(
  error: any,
  lang: Lang = 'en',
  fallbackKey: string = 'errors.apiRequestFailed'
): string {
  // If error has a message property, use it
  if (error?.message && typeof error.message === 'string') {
    return error.message;
  }
  
  // If error has an error property (API response), use it
  if (error?.error && typeof error.error === 'string') {
    return error.error;
  }
  
  // If error is a string itself
  if (typeof error === 'string') {
    return error;
  }
  
  // Fallback to localized generic error
  return getErrorMessage(fallbackKey, lang);
}
