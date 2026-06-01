import { centralPool } from '../central-db.js';
import { generateAccessToken, generateRefreshToken, verifyToken } from '../middleware/auth.middleware.js';
import { verifyPassword } from '../utils/password.utils.js';
import { createErrorResponse } from '../utils/error-messages.js';
const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};
/**
 * Helper to map user row to response format
 */
const mapUserRow = (user) => ({
    id: user.id,
    publicUserId: user.public_user_id || '',
    name: user.name || '',
    email: user.email || '',
    role: user.role || 'STUDENT',
    enrolledCourses: user.enrolled_courses || [],
    credits: user.credits || 0,
    streak: user.streak || 0,
    phone: user.phone || '',
    avatar: user.avatar || '',
    bio: user.bio || '',
    specialization: user.specialization || '',
    yearsOfExperience: user.years_of_experience || 0,
    portfolioUrl: user.portfolio_url || '',
    socialLinks: user.social_links || {},
    certifications: user.certifications || [],
    status: user.status || 'active',
});
/**
 * POST /api/auth/login - Authenticate user and issue tokens
 */
export const login = async (req, res) => {
    console.log('\n========== AUTH LOGIN REQUEST START ==========');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Host:', req.headers.host);
    console.log('Tenant:', req.tenant?.subdomain || 'No tenant context');
    try {
        const { email, password } = req.body || {};
        console.log('Login attempt for email:', email);
        if (!email || !password) {
            console.log('Login failed: Missing email or password');
            const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
            const message = lang === 'ar'
                ? 'البريد الإلكتروني وكلمة المرور مطلوبان'
                : 'Email and password are required';
            return res.status(400).json(createErrorResponse('errors.authMissingCredentials', req, message));
        }
        let tokenPayload = null;
        let userResponse = null;
        // Check if this is a tenant admin (stored in central DB)
        if (req.tenant) {
            console.log('Checking for tenant admin in central database...');
            const adminResult = await centralPool.query(`SELECT ta.id, ta.email, ta.first_name, ta.last_name, ta.phone, ta.password, ta.password_hash, ta.is_primary,
                t.id as tenant_id, t.subdomain
         FROM tenant_admins ta
         JOIN tenants t ON ta.tenant_id = t.id
         WHERE ta.email = $1 AND t.id = $2 AND t.status != 'deleted'`, [email, req.tenant.id]);
            if (adminResult.rows.length > 0) {
                const admin = adminResult.rows[0];
                // Verify password: prefer password_hash (bcrypt), fall back to legacy password column
                const storedPassword = admin.password_hash || admin.password;
                const isValidPassword = storedPassword ? await verifyPassword(password, storedPassword) : false;
                if (!isValidPassword) {
                    console.log('Login failed: Invalid password for admin:', email);
                    const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
                    const message = lang === 'ar'
                        ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
                        : 'Invalid email or password';
                    return res.status(401).json(createErrorResponse('errors.authInvalidCredentials', req, message));
                }
                console.log('Tenant admin login successful for:', email);
                tokenPayload = {
                    userId: admin.id,
                    email: admin.email,
                    role: 'ADMIN',
                    tenantId: req.tenant.id,
                    isTenantAdmin: true,
                };
                userResponse = {
                    id: admin.id,
                    publicUserId: '',
                    name: `${admin.first_name || ''} ${admin.last_name || ''}`.trim(),
                    email: admin.email,
                    role: 'ADMIN',
                    enrolledCourses: [],
                    credits: 0,
                    streak: 0,
                    socialLinks: {},
                    certifications: [],
                };
            }
        }
        // If not a tenant admin, check tenant users
        if (!tokenPayload && req.tenantPool) {
            console.log('Checking tenant users...');
            const result = await req.tenantPool.query('SELECT * FROM users WHERE email = $1', [email]);
            if (result.rows.length > 0) {
                const user = result.rows[0];
                // Verify password (supports both plain text and hashed)
                const passwordToCheck = user.password_hash || user.password;
                const isValidPassword = await verifyPassword(password, passwordToCheck);
                if (!isValidPassword) {
                    console.log('Login failed: Invalid password for user:', email);
                    const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
                    const message = lang === 'ar'
                        ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
                        : 'Invalid email or password';
                    return res.status(401).json(createErrorResponse('errors.authInvalidCredentials', req, message));
                }
                console.log('User login successful for:', email);
                tokenPayload = {
                    userId: user.id,
                    email: user.email,
                    role: user.role || 'STUDENT',
                    tenantId: req.tenant?.id,
                    isTenantAdmin: false,
                };
                userResponse = mapUserRow(user);
            }
        }
        // If still not found, check platform users (central database)
        if (!tokenPayload && !req.tenant) {
            console.log('Checking platform users in central database...');
            const result = await centralPool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
            if (result.rows.length > 0) {
                const user = result.rows[0];
                // Verify password using password_hash field
                const passwordToCheck = user.password_hash || user.password;
                const isValidPassword = await verifyPassword(password, passwordToCheck);
                if (!isValidPassword) {
                    console.log('Login failed: Invalid password for platform user:', email);
                    const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
                    const message = lang === 'ar'
                        ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
                        : 'Invalid email or password';
                    return res.status(401).json(createErrorResponse('errors.authInvalidCredentials', req, message));
                }
                console.log('Platform user login successful for:', email);
                tokenPayload = {
                    userId: user.id,
                    email: user.email,
                    role: user.role || 'STUDENT',
                    tenantId: undefined,
                    isTenantAdmin: false,
                };
                userResponse = mapUserRow(user);
            }
        }
        // No valid credentials found
        if (!tokenPayload || !userResponse) {
            console.log('Login failed: User not found');
            const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
            const message = lang === 'ar'
                ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
                : 'Invalid email or password';
            return res.status(401).json(createErrorResponse('errors.authInvalidCredentials', req, message));
        }
        // Generate tokens
        const accessToken = generateAccessToken(tokenPayload);
        const refreshToken = generateRefreshToken(tokenPayload);
        // Set tokens as httpOnly cookies
        res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);
        res.cookie('accessToken', accessToken, {
            ...COOKIE_OPTIONS,
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days to match JWT expiry
        });
        console.log('========== AUTH LOGIN REQUEST END (SUCCESS) ==========\n');
        // Return user data with access token
        res.json({
            user: userResponse,
            accessToken,
        });
    }
    catch (error) {
        console.error('\n========== AUTH LOGIN ERROR ==========');
        console.error('Error details:', error);
        console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        console.error('========== AUTH LOGIN ERROR END ==========\n');
        const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
        const message = lang === 'ar'
            ? 'فشل تسجيل الدخول'
            : 'Login failed';
        res.status(500).json(createErrorResponse('errors.apiServerError', req, message));
    }
};
/**
 * POST /api/auth/logout - Clear authentication tokens
 */
export const logout = async (req, res) => {
    res.clearCookie('refreshToken', COOKIE_OPTIONS);
    res.clearCookie('accessToken', COOKIE_OPTIONS);
    const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
    const message = lang === 'ar'
        ? 'تم تسجيل الخروج بنجاح'
        : 'Logged out successfully';
    res.json({ message });
};
/**
 * GET /api/auth/me - Get current authenticated user
 */
export const getCurrentUser = async (req, res) => {
    try {
        if (!req.user) {
            const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
            const message = lang === 'ar'
                ? 'غير مصادق عليه'
                : 'Not authenticated';
            return res.status(401).json(createErrorResponse('errors.authRequired', req, message));
        }
        // If tenant admin, get from central DB
        if (req.user.isTenantAdmin) {
            const adminResult = await centralPool.query(`SELECT ta.id, ta.email, ta.first_name, ta.last_name, ta.phone, ta.is_primary
         FROM tenant_admins ta
         WHERE ta.id = $1`, [req.user.id]);
            if (adminResult.rows.length === 0) {
                const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
                const message = lang === 'ar'
                    ? 'المستخدم غير موجود'
                    : 'User not found';
                return res.status(404).json(createErrorResponse('errors.userNotFound', req, message));
            }
            const admin = adminResult.rows[0];
            return res.json({
                id: admin.id,
                name: `${admin.first_name || ''} ${admin.last_name || ''}`.trim(),
                email: admin.email,
                role: 'ADMIN',
                enrolledCourses: [],
                credits: 0,
                streak: 0,
                socialLinks: {},
                certifications: [],
            });
        }
        // Otherwise, get from tenant DB
        if (req.tenantPool) {
            const result = await req.tenantPool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
            if (result.rows.length === 0) {
                const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
                const message = lang === 'ar'
                    ? 'المستخدم غير موجود'
                    : 'User not found';
                return res.status(404).json(createErrorResponse('errors.userNotFound', req, message));
            }
            const user = result.rows[0];
            return res.json(mapUserRow(user));
        }
        // If no tenant context, get from central platform users
        const result = await centralPool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        if (result.rows.length === 0) {
            const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
            const message = lang === 'ar'
                ? 'المستخدم غير موجود'
                : 'User not found';
            return res.status(404).json(createErrorResponse('errors.userNotFound', req, message));
        }
        const user = result.rows[0];
        res.json(mapUserRow(user));
    }
    catch (error) {
        console.error('Error fetching current user:', error);
        const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
        const message = lang === 'ar'
            ? 'فشل جلب المستخدم'
            : 'Failed to fetch user';
        res.status(500).json(createErrorResponse('errors.apiServerError', req, message));
    }
};
/**
 * POST /api/auth/refresh - Refresh access token using refresh token
 */
export const refreshAccessToken = async (req, res) => {
    try {
        const refreshToken = req.cookies?.refreshToken;
        if (!refreshToken) {
            const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
            const message = lang === 'ar'
                ? 'رمز التحديث غير موجود'
                : 'Refresh token not provided';
            return res.status(401).json(createErrorResponse('errors.authRequired', req, message));
        }
        const payload = verifyToken(refreshToken);
        if (!payload) {
            const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
            const message = lang === 'ar'
                ? 'رمز التحديث غير صالح أو منتهي الصلاحية'
                : 'Invalid or expired refresh token';
            return res.status(401).json(createErrorResponse('errors.authInvalid', req, message));
        }
        // Generate new access token
        const newAccessToken = generateAccessToken({
            userId: payload.userId,
            email: payload.email,
            role: payload.role,
            tenantId: payload.tenantId,
            isTenantAdmin: payload.isTenantAdmin,
        });
        // Set the new access token as a cookie so cookie-based auth keeps working
        res.cookie('accessToken', newAccessToken, {
            ...COOKIE_OPTIONS,
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days to match JWT expiry
        });
        res.json({ accessToken: newAccessToken });
    }
    catch (error) {
        console.error('Error refreshing token:', error);
        const lang = req.headers['accept-language']?.includes('ar') ? 'ar' : 'en';
        const message = lang === 'ar'
            ? 'فشل تحديث الرمز'
            : 'Failed to refresh token';
        res.status(500).json(createErrorResponse('errors.apiServerError', req, message));
    }
};
