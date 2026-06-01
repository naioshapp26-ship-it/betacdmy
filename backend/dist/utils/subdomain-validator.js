export const SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;
const RESERVED = new Set(['www', 'api', 'admin', 'super-admin', 'mail', 'ftp', 'localhost']);
export function isValidSubdomain(subdomain) {
    if (!subdomain)
        return false;
    const value = subdomain.trim().toLowerCase();
    if (value.length < 3 || value.length > 63)
        return false;
    if (!SUBDOMAIN_REGEX.test(value))
        return false;
    return !RESERVED.has(value);
}
