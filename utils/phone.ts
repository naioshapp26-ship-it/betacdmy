import { COUNTRIES } from './countries';

/**
 * Resolves a dialing prefix from an ISO 3166-1 alpha-2 country code.
 * Example: "SA" -> "+966".
 */
export const getDialCodeFromCountryCode = (countryCode?: string): string | undefined => {
  if (typeof countryCode !== 'string') return undefined;
  const normalized = countryCode.trim().toUpperCase();
  if (!normalized) return undefined;
  return COUNTRIES.find((country) => country.code === normalized)?.dialCode;
};

/**
 * Returns a consistently formatted phone string for UI display.
 * - If `phone` already starts with "+" it is returned unchanged.
 * - If a dial code can be resolved from `phoneCountryCode`, it is prepended.
 * Example: ("5551234", "SA") => "+966 5551234".
 */
export const formatPhoneNumberDisplay = (phone?: string, phoneCountryCode?: string): string => {
  const normalizedPhone = typeof phone === 'string' ? phone.trim() : '';
  if (!normalizedPhone) return '';
  if (normalizedPhone.startsWith('+')) return normalizedPhone;

  const dialCode = getDialCodeFromCountryCode(phoneCountryCode);
  if (!dialCode) return normalizedPhone;
  if (normalizedPhone.startsWith(dialCode)) return normalizedPhone;

  return `${dialCode} ${normalizedPhone}`;
};
