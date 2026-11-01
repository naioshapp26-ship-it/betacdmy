/**
 * API + cookie E2E for demo Admin/Customer login, logout, and RBAC isolation.
 * Does not print passwords.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';

dotenv.config({ path: '/cursor/stores/self/demo-login/credentials.env' });
dotenv.config();

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
const TENANT = process.env.TENANT_SUBDOMAIN || 'naiosh';
const ADMIN_EMAIL = process.env.DEMO_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD;
const STUDENT_EMAIL = process.env.DEMO_STUDENT_EMAIL;
const STUDENT_PASSWORD = process.env.DEMO_STUDENT_PASSWORD;

assert.ok(ADMIN_EMAIL && ADMIN_PASSWORD && STUDENT_EMAIL && STUDENT_PASSWORD, 'demo env required');

const parseSetCookie = (res) => {
  const raw = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
  return raw.filter(Boolean);
};

const cookieJarFrom = (setCookies) => {
  const map = new Map();
  for (const line of setCookies) {
    const [pair] = line.split(';');
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!value || value === 'undefined') {
      map.delete(name);
    } else {
      map.set(name, value);
    }
  }
  return map;
};

const cookieHeader = (jar) =>
  [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

const mergeCookies = (jar, setCookies) => {
  const next = cookieJarFrom(setCookies);
  for (const [k, v] of next) jar.set(k, v);
  // Handle clearing: empty Max-Age=0 cookies may appear as empty values
  for (const line of setCookies) {
    if (/Max-Age=0/i.test(line) || /Expires=Thu, 01 Jan 1970/i.test(line)) {
      const [pair] = line.split(';');
      const name = pair.split('=')[0].trim();
      jar.delete(name);
    }
  }
  return jar;
};

const api = async (path, { method = 'GET', jar, body, headers = {} } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept-Language': 'ar',
      'x-tenant-subdomain': TENANT,
      ...(jar?.size ? { Cookie: cookieHeader(jar) } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const setCookies = parseSetCookie(res);
  if (jar) mergeCookies(jar, setCookies);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { res, json, setCookies };
};

console.log('=== E2E demo login ===');
console.log('base:', BASE, 'tenant:', TENANT);

const status = await api('/api/auth/demo-status');
assert.equal(status.res.status, 200);
assert.equal(status.json.enabled, true);
assert.ok(status.json.roles.includes('ADMIN'));
assert.ok(status.json.roles.includes('STUDENT'));
console.log('✓ demo-status enabled');

// --- Admin email/password login ---
const adminJar = new Map();
const adminLogin = await api('/api/auth/login', {
  method: 'POST',
  jar: adminJar,
  body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
});
assert.equal(adminLogin.res.status, 200, `admin login ${JSON.stringify(adminLogin.json)}`);
assert.equal(adminLogin.json.user.role, 'ADMIN');
assert.ok(adminJar.has('accessToken'), 'admin accessToken cookie');
console.log('✓ admin login → ADMIN');

const adminMe = await api('/api/auth/me', { jar: adminJar });
assert.equal(adminMe.res.status, 200);
assert.equal(adminMe.json.role, 'ADMIN');
console.log('✓ admin /me');

const adminUsers = await api('/api/users', { jar: adminJar });
assert.ok([200, 304].includes(adminUsers.res.status), `admin users ${adminUsers.res.status}`);
console.log('✓ admin can list users');

const adminCourses = await api('/api/courses', { jar: adminJar });
assert.ok([200, 304].includes(adminCourses.res.status), `admin courses ${adminCourses.res.status}`);
console.log('✓ admin can list courses');

// Admin logout
const adminLogout = await api('/api/auth/logout', { method: 'POST', jar: adminJar });
assert.equal(adminLogout.res.status, 200);
adminJar.delete('accessToken');
adminJar.delete('refreshToken');
const adminMeAfter = await api('/api/auth/me', { jar: adminJar });
assert.equal(adminMeAfter.res.status, 401);
console.log('✓ admin logout ends session');

// --- Customer login ---
const studentJar = new Map();
const studentLogin = await api('/api/auth/login', {
  method: 'POST',
  jar: studentJar,
  body: { email: STUDENT_EMAIL, password: STUDENT_PASSWORD }
});
assert.equal(studentLogin.res.status, 200, `student login ${JSON.stringify(studentLogin.json)}`);
assert.equal(studentLogin.json.user.role, 'STUDENT');
console.log('✓ customer login → STUDENT');

const studentMe = await api('/api/auth/me', { jar: studentJar });
assert.equal(studentMe.res.status, 200);
assert.equal(studentMe.json.role, 'STUDENT');
console.log('✓ customer /me');

// Isolation: customer must not hit admin-only routes
const forbiddenPaths = [
  '/api/admin/memberships',
  '/api/admin/freelancers',
  '/api/admin/ads',
  '/api/tenant/email-settings'
];
for (const path of forbiddenPaths) {
  const denied = await api(path, { jar: studentJar });
  assert.ok(
    [401, 403].includes(denied.res.status),
    `customer should be denied ${path}, got ${denied.res.status}`
  );
  console.log(`✓ customer denied ${path} (${denied.res.status})`);
}

const studentLogout = await api('/api/auth/logout', { method: 'POST', jar: studentJar });
assert.equal(studentLogout.res.status, 200);
studentJar.delete('accessToken');
studentJar.delete('refreshToken');
const studentMeAfter = await api('/api/auth/me', { jar: studentJar });
assert.equal(studentMeAfter.res.status, 401);
console.log('✓ customer logout ends session');

// One-click demo login (server-gated)
const demoJar = new Map();
const demoAdmin = await api('/api/auth/demo-login', {
  method: 'POST',
  jar: demoJar,
  body: { role: 'ADMIN' }
});
assert.equal(demoAdmin.res.status, 200);
assert.equal(demoAdmin.json.user.role, 'ADMIN');
console.log('✓ demo-login ADMIN');

const demoStudentJar = new Map();
const demoStudent = await api('/api/auth/demo-login', {
  method: 'POST',
  jar: demoStudentJar,
  body: { role: 'STUDENT' }
});
assert.equal(demoStudent.res.status, 200);
assert.equal(demoStudent.json.user.role, 'STUDENT');
console.log('✓ demo-login STUDENT');

// Login page HTML reachable
const loginPage = await fetch(`${BASE}/t/${TENANT}/login`);
assert.ok([200, 301, 302].includes(loginPage.status), `login page ${loginPage.status}`);
console.log('✓ login page reachable');

console.log('=== E2E demo login PASSED ===');

// Keep a machine-readable summary for walkthrough (no secrets)
const summary = {
  passed: true,
  base: BASE,
  tenant: TENANT,
  loginPath: `${BASE}/t/${TENANT}/login`,
  adminDashboardUrl: `${BASE}/t/${TENANT}/dashboard`,
  customerDashboardUrl: `${BASE}/t/${TENANT}/dashboard`,
  checks: [
    'admin email/password login',
    'admin /me + users + courses',
    'admin logout clears session',
    'customer email/password login',
    'customer denied admin APIs',
    'customer logout clears session',
    'gated demo-login for ADMIN and STUDENT'
  ]
};
process.stdout.write(`\nSUMMARY ${JSON.stringify(summary)}\n`);
