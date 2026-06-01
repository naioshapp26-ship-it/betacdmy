import { createHash, randomBytes } from 'crypto';
import { centralPool } from '../central-db.js';
import { hashPassword } from '../utils/password.utils.js';
import { createErrorResponse } from '../utils/error-messages.js';
import { EmailService } from '../services/email.service.js';
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const MIN_PASSWORD_LENGTH = 8;
const emailService = new EmailService();
const getEffectiveHost = (req) => {
    const forwarded = req.headers['x-forwarded-host'];
    if (forwarded) {
        const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim();
        if (first) {
            return first;
        }
    }
    return req.headers.host || process.env.MAIN_DOMAIN || 'betacdmy.com.vendoworld.com';
};
const getProtocol = (req) => {
    const forwarded = req.headers['x-forwarded-proto'];
    if (forwarded) {
        const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim();
        if (first) {
            return first;
        }
    }
    if (process.env.PROTOCOL) {
        return process.env.PROTOCOL;
    }
    return req.secure ? 'https' : 'http';
};
const normalizeEmail = (value) => value.trim().toLowerCase();
const hashResetToken = (token) => createHash('sha256').update(token, 'utf8').digest('hex');
const generateResetToken = () => {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = hashResetToken(rawToken);
    return { rawToken, tokenHash };
};
const genericForgotPasswordResponse = {
    success: true,
    message: 'If the email exists, a password reset link has been sent.'
};
const findForgotPasswordTarget = async (req, email) => {
    if (req.tenant) {
        const tenantAdminResult = await centralPool.query(`SELECT id, email, tenant_id
         FROM tenant_admins
        WHERE tenant_id = $1
          AND LOWER(email) = LOWER($2)
        LIMIT 1`, [req.tenant.id, email]);
        if (tenantAdminResult.rows.length > 0) {
            const row = tenantAdminResult.rows[0];
            return {
                type: 'tenant-admin',
                id: String(row.id),
                email: String(row.email),
                tenantId: String(row.tenant_id)
            };
        }
        if (req.tenantPool) {
            const tenantUserResult = await req.tenantPool.query(`SELECT id, email
           FROM users
          WHERE LOWER(email) = LOWER($1)
          LIMIT 1`, [email]);
            if (tenantUserResult.rows.length > 0) {
                const row = tenantUserResult.rows[0];
                return {
                    type: 'tenant-user',
                    id: String(row.id),
                    email: String(row.email)
                };
            }
        }
        return null;
    }
    const platformUserResult = await centralPool.query(`SELECT id, email
       FROM users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1`, [email]);
    if (platformUserResult.rows.length > 0) {
        const row = platformUserResult.rows[0];
        return {
            type: 'platform-user',
            id: String(row.id),
            email: String(row.email)
        };
    }
    return null;
};
const persistResetToken = async (req, target, tokenHash, expiresAt) => {
    if (target.type === 'tenant-admin') {
        await centralPool.query(`UPDATE tenant_admins
          SET reset_token_hash = $1,
              reset_token_expires = $2
        WHERE id = $3
          AND tenant_id = $4`, [tokenHash, expiresAt.toISOString(), target.id, target.tenantId]);
        return;
    }
    if (target.type === 'tenant-user') {
        if (!req.tenantPool) {
            throw new Error('Tenant context is missing for tenant user reset');
        }
        await req.tenantPool.query(`UPDATE users
          SET reset_token_hash = $1,
              reset_token_expires = $2
        WHERE id = $3`, [tokenHash, expiresAt.toISOString(), target.id]);
        return;
    }
    await centralPool.query(`UPDATE users
        SET reset_token_hash = $1,
            reset_token_expires = $2
      WHERE id = $3`, [tokenHash, expiresAt.toISOString(), target.id]);
};
export const forgotPassword = async (req, res) => {
    try {
        const rawEmail = typeof req.body?.email === 'string' ? req.body.email : '';
        const email = normalizeEmail(rawEmail);
        if (!email) {
            return res.status(400).json(createErrorResponse('errors.validationRequired', req, 'Email is required'));
        }
        const target = await findForgotPasswordTarget(req, email);
        if (!target) {
            return res.json(genericForgotPasswordResponse);
        }
        const { rawToken, tokenHash } = generateResetToken();
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
        await persistResetToken(req, target, tokenHash, expiresAt);
        const protocol = getProtocol(req);
        const host = getEffectiveHost(req);
        const resetLink = `${protocol}://${host}/reset-password?token=${encodeURIComponent(rawToken)}`;
        const siteName = req.tenant?.company_name || 'Betacademy';
        // Default to Arabic for tenant subdomains, English for main site
        const lang = req.tenant ? 'ar' : 'en';
        const emailResult = await emailService.sendPasswordReset({
            to: target.email,
            resetLink,
            siteName,
            expiresMinutes: 60,
            tenantId: req.tenant?.id || null,
            lang: lang
        });
        if (!emailResult.sent) {
            console.warn('[PasswordReset] Reset email not sent:', emailResult.reason || emailResult.error || 'Unknown reason');
        }
        return res.json(genericForgotPasswordResponse);
    }
    catch (error) {
        console.error('[PasswordReset] Forgot password failed', error);
        return res.status(500).json(createErrorResponse('errors.apiServerError', req, 'Failed to process forgot password request'));
    }
};
const findResetRecordByToken = async (req, tokenHash) => {
    if (req.tenant) {
        const adminResult = await centralPool.query(`SELECT id, tenant_id
         FROM tenant_admins
        WHERE tenant_id = $1
          AND reset_token_hash = $2
          AND reset_token_expires > NOW()
        LIMIT 1`, [req.tenant.id, tokenHash]);
        if (adminResult.rows.length > 0) {
            const row = adminResult.rows[0];
            return {
                type: 'tenant-admin',
                id: String(row.id),
                tenantId: String(row.tenant_id)
            };
        }
        if (req.tenantPool) {
            const tenantUserResult = await req.tenantPool.query(`SELECT id
           FROM users
          WHERE reset_token_hash = $1
            AND reset_token_expires > NOW()
          LIMIT 1`, [tokenHash]);
            if (tenantUserResult.rows.length > 0) {
                return {
                    type: 'tenant-user',
                    id: String(tenantUserResult.rows[0].id)
                };
            }
        }
        return null;
    }
    const platformUserResult = await centralPool.query(`SELECT id
       FROM users
      WHERE reset_token_hash = $1
        AND reset_token_expires > NOW()
      LIMIT 1`, [tokenHash]);
    if (platformUserResult.rows.length > 0) {
        return {
            type: 'platform-user',
            id: String(platformUserResult.rows[0].id)
        };
    }
    return null;
};
const applyNewPassword = async (req, record, passwordHash) => {
    if (record.type === 'tenant-admin') {
        await centralPool.query(`UPDATE tenant_admins
          SET password_hash = $1,
              password = $1,
              reset_token_hash = NULL,
              reset_token_expires = NULL
        WHERE id = $2
          AND tenant_id = $3`, [passwordHash, record.id, record.tenantId]);
        return;
    }
    if (record.type === 'tenant-user') {
        if (!req.tenantPool) {
            throw new Error('Tenant context is missing for tenant password reset');
        }
        await req.tenantPool.query(`UPDATE users
          SET password_hash = $1,
              password = $1,
              reset_token_hash = NULL,
              reset_token_expires = NULL
        WHERE id = $2`, [passwordHash, record.id]);
        return;
    }
    await centralPool.query(`UPDATE users
        SET password_hash = $1,
            password = $1,
            reset_token_hash = NULL,
            reset_token_expires = NULL
      WHERE id = $2`, [passwordHash, record.id]);
};
export const resetPassword = async (req, res) => {
    try {
        const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
        const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
        if (!token || !newPassword) {
            return res.status(400).json(createErrorResponse('errors.validationRequired', req, 'Token and new password are required'));
        }
        if (newPassword.length < MIN_PASSWORD_LENGTH) {
            return res.status(400).json(createErrorResponse('errors.authWeakPassword', req, `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`));
        }
        const tokenHash = hashResetToken(token);
        const record = await findResetRecordByToken(req, tokenHash);
        if (!record) {
            return res.status(400).json(createErrorResponse('errors.authInvalidToken', req, 'Invalid or expired reset token'));
        }
        const passwordHash = await hashPassword(newPassword);
        await applyNewPassword(req, record, passwordHash);
        return res.json({
            success: true,
            message: 'Password reset successful. You can now sign in with your new password.'
        });
    }
    catch (error) {
        console.error('[PasswordReset] Reset password failed', error);
        return res.status(500).json(createErrorResponse('errors.apiServerError', req, 'Failed to reset password'));
    }
};
