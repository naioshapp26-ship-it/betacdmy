import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { centralPool } from '../central-db.js';
import { createErrorResponse } from '../utils/error-messages.js';

const JWT_SECRET: string = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';
const REFRESH_TOKEN_EXPIRES_IN = '30d';

export interface AuthUser {
  id: string | number;
  email: string;
  role: 'ADMIN' | 'INSTRUCTOR' | 'STUDENT' | 'MEMBER' | 'SUPER_ADMIN';
  tenantId?: string | number;
  isTenantAdmin?: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
    userId?: string | number;
  }
}

export interface TokenPayload {
  userId: string | number;
  email: string;
  role: string;
  tenantId?: number | string;
  isTenantAdmin?: boolean;
}

/**
 * Generate access token for authenticated user
 */
export const generateAccessToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

/**
 * Generate refresh token for authenticated user
 */
export const generateRefreshToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRES_IN });
};

/**
 * Verify and decode JWT token
 */
export const verifyToken = (token: string): TokenPayload | null => {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch (error) {
    return null;
  }
};

/**
 * Extract token from Authorization header or cookie
 */
const extractToken = (req: Request): string | null => {
  // Check Authorization header first (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Check for token in cookies (refresh token or access token)
  if (req.cookies?.accessToken) {
    return req.cookies.accessToken;
  }

  return null;
};

/**
 * Authentication middleware - Requires valid JWT token
 */
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const token = extractToken(req);

  if (!token) {
    const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
    const message = lang === 'ar' 
      ? 'مطلوب مصادقة. يرجى تسجيل الدخول.'
      : 'Authentication required. Please log in.';
    return res.status(401).json(createErrorResponse('errors.authRequired', req, message));
  }

  const payload = verifyToken(token);

  if (!payload) {
    const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
    const message = lang === 'ar' 
      ? 'رمز المصادقة غير صالح أو منتهي الصلاحية.'
      : 'Invalid or expired authentication token.';
    return res.status(401).json(createErrorResponse('errors.authInvalid', req, message));
  }

  // Attach user info to request
  req.user = {
    id: payload.userId,
    email: payload.email,
    role: payload.role as 'ADMIN' | 'INSTRUCTOR' | 'STUDENT' | 'MEMBER' | 'SUPER_ADMIN',
    tenantId: payload.tenantId,
    isTenantAdmin: payload.isTenantAdmin,
  };
  req.userId = payload.userId;

  next();
};

/**
 * Optional authentication middleware - Doesn't fail if no token
 */
export const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
  const token = extractToken(req);

  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      req.user = {
        id: payload.userId,
        email: payload.email,
        role: payload.role as 'ADMIN' | 'INSTRUCTOR' | 'STUDENT' | 'MEMBER' | 'SUPER_ADMIN',
        tenantId: payload.tenantId,
        isTenantAdmin: payload.isTenantAdmin,
      };
      req.userId = payload.userId;
    }
  }

  next();
};

/**
 * Role-based authorization middleware
 */
export const requireRole = (...roles: Array<'ADMIN' | 'INSTRUCTOR' | 'STUDENT' | 'MEMBER' | 'SUPER_ADMIN'>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
      const message = lang === 'ar' 
        ? 'مطلوب مصادقة.'
        : 'Authentication required.';
      return res.status(401).json(createErrorResponse('errors.authRequired', req, message));
    }

    const normalizedRole = req.user.role;
    const hasPermission = roles.includes(normalizedRole)
      || (normalizedRole === 'SUPER_ADMIN' && roles.includes('ADMIN'));

    if (!hasPermission) {
      const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
      const message = lang === 'ar' 
        ? 'ليس لديك صلاحية للوصول إلى هذا المورد.'
        : 'You do not have permission to access this resource.';
      return res.status(403).json(createErrorResponse('errors.authForbidden', req, message));
    }

    next();
  };
};

/**
 * Tenant admin verification middleware
 */
export const requireTenantAdmin = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
    const message = lang === 'ar' 
      ? 'مطلوب مصادقة.'
      : 'Authentication required.';
    return res.status(401).json(createErrorResponse('errors.authRequired', req, message));
  }

  if (!req.user.isTenantAdmin && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
    const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
    const message = lang === 'ar' 
      ? 'يلزم وصول المسؤول.'
      : 'Admin access required.';
    return res.status(403).json(createErrorResponse('errors.authForbidden', req, message));
  }

  next();
};

/**
 * Ensure user can only access their own resources
 * Allows:
 * - Super admins and admins (global access)
 * - Tenant admins (can edit users in their tenant)
 * - Users editing their own resources
 */
export const requireSelfOrAdmin = (userIdParam: string = 'id') => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
      const message = lang === 'ar' 
        ? 'مطلوب مصادقة.'
        : 'Authentication required.';
      return res.status(401).json(createErrorResponse('errors.authRequired', req, message));
    }

    const rawTargetUserId = req.params[userIdParam] ?? req.body[userIdParam] ?? req.query[userIdParam];
    const targetUserId = rawTargetUserId?.toString();
    const requesterUserId = req.user.id?.toString();

    if (!targetUserId) {
      const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
      const message = lang === 'ar'
        ? 'معرف المستخدم مطلوب.'
        : 'User ID is required.';
      return res.status(400).json(createErrorResponse('errors.userIdRequired', req, message));
    }

    // Allow super admins and admins
    if (req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN') {
      return next();
    }

    // Allow tenant admins to edit any user in their tenant
    if (req.user.isTenantAdmin) {
      return next();
    }

    // Allow users to edit their own resources
    if (requesterUserId === targetUserId) {
      return next();
    }

    // Deny access
    const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
    const message = lang === 'ar' 
      ? 'يمكنك فقط الوصول إلى الموارد الخاصة بك.'
      : 'You can only access your own resources.';
    return res.status(403).json(createErrorResponse('errors.authForbidden', req, message));
  };
};
