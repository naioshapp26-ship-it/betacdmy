import { createHmac } from 'node:crypto';
/**
 * Demo login config for isolated test accounts.
 * Passwords are derived from JWT_SECRET (already on the server) so plaintext
 * demo secrets are never committed to the repository.
 */
const DEFAULT_ADMIN_EMAIL = 'demo-admin@naiosh.local';
const DEFAULT_STUDENT_EMAIL = 'demo-customer@naiosh.local';
export const isDemoLoginEnabled = () => {
    const flag = (process.env.DEMO_LOGIN_ENABLED || '').toLowerCase().trim();
    if (flag === 'false' || flag === '0' || flag === 'no')
        return false;
    if (flag === 'true' || flag === '1' || flag === 'yes')
        return true;
    // On Railway, enable quick demo login by default so www.naioshacademy.com works
    // without a manual Variables step. Set DEMO_LOGIN_ENABLED=false to turn off.
    return Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PUBLIC_DOMAIN);
};
const derivePassword = (role) => {
    const secret = process.env.JWT_SECRET || process.env.DEMO_PASSWORD_PEPPER || '';
    if (!secret) {
        throw new Error('JWT_SECRET is required to derive demo passwords');
    }
    return createHmac('sha256', secret).update(`naiosh-demo:${role}`).digest('base64url');
};
export const getDemoAccount = (role) => {
    if (role === 'ADMIN') {
        return {
            email: (process.env.DEMO_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase(),
            password: process.env.DEMO_ADMIN_PASSWORD || derivePassword('ADMIN'),
            name: `${process.env.DEMO_ADMIN_FIRST_NAME || 'Demo'} ${process.env.DEMO_ADMIN_LAST_NAME || 'Admin'}`.trim()
        };
    }
    return {
        email: (process.env.DEMO_STUDENT_EMAIL || DEFAULT_STUDENT_EMAIL).trim().toLowerCase(),
        password: process.env.DEMO_STUDENT_PASSWORD || derivePassword('STUDENT'),
        name: process.env.DEMO_STUDENT_NAME || 'Demo Customer'
    };
};
export const getConfiguredDemoRoles = () => {
    if (!isDemoLoginEnabled())
        return [];
    try {
        getDemoAccount('ADMIN');
        getDemoAccount('STUDENT');
        return ['ADMIN', 'STUDENT'];
    }
    catch {
        return [];
    }
};
