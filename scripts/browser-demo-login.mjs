/**
 * Browser walkthrough for demo Admin + Customer login flows.
 * Saves screenshots under /opt/cursor/artifacts/demo-login (no passwords in output).
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import dotenv from 'dotenv';

dotenv.config({ path: '/cursor/stores/self/demo-login/credentials.env' });

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
const TENANT = process.env.TENANT_SUBDOMAIN || 'naiosh';
const ADMIN_EMAIL = process.env.DEMO_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD;
const STUDENT_EMAIL = process.env.DEMO_STUDENT_EMAIL;
const STUDENT_PASSWORD = process.env.DEMO_STUDENT_PASSWORD;
const OUT = process.env.DEMO_ARTIFACT_DIR || '/opt/cursor/artifacts/demo-login';

fs.mkdirSync(OUT, { recursive: true });

const loginUrl = `${BASE}/t/${TENANT}/login`;
const dashboardUrl = `${BASE}/t/${TENANT}/dashboard`;

const shot = async (page, name) => {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log('screenshot:', file);
  return file;
};

const dismissOverlays = async (page) => {
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const dismiss = buttons.find((el) => /ليس الآن|Not now|Not Now|Close|إغلاق/i.test(el.textContent || ''));
    if (dismiss) dismiss.click();
  });
  await new Promise((r) => setTimeout(r, 400));
};

const setInputValue = async (page, selector, value) => {
  await page.waitForSelector(selector, { timeout: 20000 });
  await page.focus(selector);
  await page.evaluate(
    (sel, val) => {
      const input = document.querySelector(sel);
      if (!input) throw new Error(`missing ${sel}`);
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      nativeSetter?.call(input, val);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    selector,
    value
  );
};

const submitEmailLogin = async (page, email, password) => {
  await dismissOverlays(page);
  await setInputValue(page, '#email', email);
  await setInputValue(page, '#password', password);
  await page.evaluate(() => {
    const form = document.querySelector('form');
    if (form) {
      form.requestSubmit();
      return;
    }
    const btn = Array.from(document.querySelectorAll('button[type="submit"], button')).find((el) =>
      /تسجيل الدخول|Logging in|Login|Sign in/i.test(el.textContent || '')
    );
    btn?.click();
  });
};

const waitForAuthedDashboard = async (page) => {
  await page.waitForFunction(
    () => {
      const text = document.body?.innerText || '';
      const pathOk = /\/dashboard/i.test(location.pathname);
      const loggedInChrome =
        /تسجيل الخروج|Logout|Log out|لوحة التحكم|Dashboard|المتعلمون|Students|اشتراك|Subscriptions/i.test(
          text
        );
      const stillOnLogin = /سجل الدخول إلى حسابك|Log in to your account/i.test(text);
      return pathOk && loggedInChrome && !stillOnLogin;
    },
    { timeout: 45000 }
  );
  await page.waitForNetworkIdle({ idleTime: 800, timeout: 15000 }).catch(() => null);
};

const ensureLoggedOut = async (page) => {
  await page.goto(loginUrl, { waitUntil: 'networkidle2' });
  await page.evaluate(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem('betacademy_user');
    } catch {
      /* ignore */
    }
  });
  await page.goto(loginUrl, { waitUntil: 'networkidle2' });
  await dismissOverlays(page);
};

const clickLogoutUi = async (page) => {
  const clicked = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('button, a'));
    const logout = candidates.find((el) => {
      const label = `${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`;
      return /تسجيل الخروج|Logout|Log out/i.test(label);
    });
    if (logout) {
      logout.click();
      return true;
    }
    return false;
  });
  if (!clicked) {
    await page.evaluate(async () => {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      localStorage.removeItem('betacademy_user');
    });
  }
  await page.waitForFunction(
    () => /سجل الدخول إلى حسابك|Log in to your account|إنشاء حساب|Create Account/i.test(document.body.innerText || ''),
    { timeout: 20000 }
  ).catch(() => null);
};

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,900'],
  defaultViewport: { width: 1400, height: 900 }
});

const page = await browser.newPage();
page.setDefaultTimeout(45000);

// Capture console errors for debugging (no secrets)
page.on('pageerror', (err) => console.error('pageerror:', err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('console:', msg.text());
});

console.log('Opening login:', loginUrl);
await ensureLoggedOut(page);
await shot(page, '01_login_page');

// --- Admin email/password journey ---
await submitEmailLogin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
await waitForAuthedDashboard(page);
const adminRole = await page.evaluate(() => {
  try {
    return JSON.parse(localStorage.getItem('betacademy_user') || '{}').role || null;
  } catch {
    return null;
  }
});
console.log('admin local role:', adminRole);
if (adminRole !== 'ADMIN') throw new Error(`Expected ADMIN role in localStorage, got ${adminRole}`);
await shot(page, '02_admin_dashboard');

await page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll('button, a'));
  const users = tabs.find((el) => /المستخدم|Users|User Management|المتعلمون|Students/i.test(el.textContent || ''));
  users?.click();
});
await page.waitForNetworkIdle({ idleTime: 600, timeout: 10000 }).catch(() => null);
await shot(page, '03_admin_users');

await page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll('button, a'));
  const courses = tabs.find((el) => /الدورات|Courses|المحتوى|Content/i.test(el.textContent || ''));
  courses?.click();
});
await page.waitForNetworkIdle({ idleTime: 600, timeout: 10000 }).catch(() => null);
await shot(page, '04_admin_courses');

await clickLogoutUi(page);
await page.goto(loginUrl, { waitUntil: 'networkidle2' });
await dismissOverlays(page);
await shot(page, '05_admin_logged_out');

await page.goto(dashboardUrl, { waitUntil: 'networkidle2' });
await dismissOverlays(page);
await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => null);
const afterLogoutUser = await page.evaluate(() => localStorage.getItem('betacademy_user'));
console.log('user after logout+dashboard:', afterLogoutUser);
await shot(page, '06_dashboard_after_logout_requires_auth');

// --- Customer journey ---
await ensureLoggedOut(page);
await submitEmailLogin(page, STUDENT_EMAIL, STUDENT_PASSWORD);
await waitForAuthedDashboard(page);
const studentRole = await page.evaluate(() => {
  try {
    return JSON.parse(localStorage.getItem('betacademy_user') || '{}').role || null;
  } catch {
    return null;
  }
});
console.log('customer local role:', studentRole);
if (studentRole !== 'STUDENT') throw new Error(`Expected STUDENT role, got ${studentRole}`);
await shot(page, '07_customer_dashboard');

const isolation = await page.evaluate(async () => {
  const res = await fetch('/api/admin/ads', { credentials: 'include' });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, error: body?.error || body?.message || null };
});
fs.writeFileSync(path.join(OUT, '08_customer_admin_api_denied.json'), JSON.stringify(isolation, null, 2));
console.log('customer admin API:', isolation);
if (![401, 403].includes(isolation.status)) {
  throw new Error(`Expected customer denied admin API, got ${isolation.status}`);
}
await shot(page, '08_customer_denied_admin_context');

await clickLogoutUi(page);
await page.goto(loginUrl, { waitUntil: 'networkidle2' });
await dismissOverlays(page);
await shot(page, '09_customer_logged_out');

// One-click demo buttons (env-gated UI)
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((el) =>
    /دخول أدمن تجريبي|Demo Admin/i.test(el.textContent || '')
  );
  btn?.click();
});
await waitForAuthedDashboard(page);
await shot(page, '10_demo_button_admin');

await browser.close();
console.log('Browser walkthrough complete');
