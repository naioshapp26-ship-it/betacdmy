import rateLimit from 'express-rate-limit';
// Import the ipKeyGenerator helper for IPv6 compatibility
// This ensures proper handling of IPv6 addresses in rate limiting
const ipKeyGenerator = (req) => {
    // Use forwarded IP if available (for proxies), otherwise use socket remote address
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
        const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(',')[0];
        return ips.trim();
    }
    return req.ip || req.socket.remoteAddress || 'unknown';
};
// Store rate limit state in memory (in production, use Redis)
const rateLimitStore = new Map();
/**
 * Custom store implementation for rate limiting
 * In production, replace with Redis store for distributed systems
 */
class MemoryStore {
    hits;
    constructor() {
        this.hits = rateLimitStore;
        // Clean up old entries every 5 minutes
        setInterval(() => this.cleanup(), 5 * 60 * 1000);
    }
    cleanup() {
        const now = Date.now();
        for (const [key, value] of this.hits.entries()) {
            if (value.resetTime < now) {
                this.hits.delete(key);
            }
        }
    }
    increment(key) {
        const now = Date.now();
        const record = this.hits.get(key);
        if (!record || record.resetTime < now) {
            // Create new record with 1 minute window
            const resetTime = now + 60 * 1000;
            this.hits.set(key, { count: 1, resetTime });
            return { totalHits: 1, resetTime: new Date(resetTime) };
        }
        record.count++;
        this.hits.set(key, record);
        return { totalHits: record.count, resetTime: new Date(record.resetTime) };
    }
    decrement(key) {
        const record = this.hits.get(key);
        if (record && record.count > 0) {
            record.count--;
            this.hits.set(key, record);
        }
    }
    resetKey(key) {
        this.hits.delete(key);
    }
}
const memoryStore = new MemoryStore();
/**
 * Get client identifier (IP + tenant if available)
 */
function getClientKey(req, prefix) {
    const ip = ipKeyGenerator(req);
    const tenantId = req.tenant?.id || 'no-tenant';
    return `${prefix}:${tenantId}:${ip}`;
}
/**
 * Per-IP rate limiter for login endpoints
 * Limits: 5 attempts per minute per IP
 */
export const loginRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5,
    message: { error: 'Too many login attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        const ip = ipKeyGenerator(req);
        return `login:${ip}`;
    },
    handler: (req, res) => {
        console.warn(`[Rate Limit] Login attempt blocked for IP: ${req.ip}`);
        res.status(429).json({
            error: 'Too many login attempts',
            message: 'You have exceeded the maximum number of login attempts. Please try again in 1 minute.',
            retryAfter: 60
        });
    }
});
/**
 * Per-IP rate limiter for provisioning endpoints
 * Limits: 50 requests per hour per IP (allows testing and legitimate usage)
 */
export const provisioningRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 50,
    message: { error: 'Provisioning rate limit exceeded' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        const ip = ipKeyGenerator(req);
        return `provisioning:${ip}`;
    },
    handler: (req, res) => {
        console.warn(`[Rate Limit] Provisioning blocked for IP: ${req.ip}`);
        res.status(429).json({
            error: 'Provisioning rate limit exceeded',
            message: 'You have exceeded the tenant creation limit. Please try again later.',
            retryAfter: 3600
        });
    }
});
/**
 * Per-IP rate limiter for webhook endpoints
 * Limits: 100 requests per minute per IP
 */
export const webhookRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100,
    message: { error: 'Webhook rate limit exceeded' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    keyGenerator: (req) => {
        const ip = ipKeyGenerator(req);
        return `webhook:${ip}`;
    },
    handler: (req, res) => {
        console.warn(`[Rate Limit] Webhook blocked for IP: ${req.ip}`);
        res.status(429).json({
            error: 'Webhook rate limit exceeded',
            message: 'Too many webhook requests. Please check your integration.',
            retryAfter: 60
        });
    }
});
/**
 * Plan-based quotas for different subscription tiers
 */
export const PLAN_QUOTAS = {
    basic: {
        maxUsers: 50,
        maxCourses: 10,
        storageGb: 5,
        apiRequestsPerHour: 500,
    },
    pro: {
        maxUsers: 200,
        maxCourses: 50,
        storageGb: 20,
        apiRequestsPerHour: 2000,
    },
    enterprise: {
        maxUsers: Infinity,
        maxCourses: Infinity,
        storageGb: 100,
        apiRequestsPerHour: 10000,
    },
};
/**
 * Get quota limits for a specific plan
 */
export function getPlanQuota(plan) {
    const normalizedPlan = plan.toLowerCase();
    return PLAN_QUOTAS[normalizedPlan] || PLAN_QUOTAS.basic;
}
/**
 * Per-tenant rate limiter based on subscription plan
 */
export const tenantApiRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: (req) => {
        const tenant = req.tenant;
        if (!tenant)
            return 100; // Default limit if no tenant context
        const plan = tenant.subscription_plan || 'basic';
        const quota = getPlanQuota(plan);
        return quota.apiRequestsPerHour;
    },
    message: { error: 'API rate limit exceeded for your plan' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => getClientKey(req, 'tenant-api'),
    handler: (req, res) => {
        const tenant = req.tenant;
        const plan = tenant?.subscription_plan || 'unknown';
        console.warn(`[Rate Limit] Tenant API blocked - Tenant: ${tenant?.subdomain}, Plan: ${plan}`);
        res.status(429).json({
            error: 'API rate limit exceeded',
            message: 'You have exceeded the API request limit for your plan. Please upgrade or try again later.',
            plan: plan,
            retryAfter: 3600
        });
    },
    skip: (req) => {
        // Skip rate limiting for super admin endpoints
        return req.path.startsWith('/api/super-admin');
    }
});
/**
 * General API rate limiter for non-tenant specific endpoints
 * Limits: 1000 requests per hour per IP
 */
export const generalApiRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 1000,
    message: { error: 'API rate limit exceeded' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        const ip = ipKeyGenerator(req);
        return `general-api:${ip}`;
    },
    handler: (req, res) => {
        console.warn(`[Rate Limit] General API blocked for IP: ${req.ip}`);
        res.status(429).json({
            error: 'API rate limit exceeded',
            message: 'Too many requests. Please try again later.',
            retryAfter: 3600
        });
    }
});
