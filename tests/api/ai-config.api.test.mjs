import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAIProvider, isGeminiProvider } from '../../backend/dist/utils/ai-provider.js';
import { requireRole } from '../../backend/dist/middleware/rbac.middleware.js';
import { extractSubdomain } from '../../backend/dist/utils/tenant-host.js';

const createMockResponse = () => {
  const response = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    }
  };

  return response;
};

test('normalizeAIProvider resolves common provider variants', () => {
  assert.equal(normalizeAIProvider('Gemini'), 'gemini');
  assert.equal(normalizeAIProvider(' Google Gemini '), 'gemini');
  assert.equal(normalizeAIProvider('Anthropic Claude'), 'claude');
  assert.equal(normalizeAIProvider('OpenAI'), 'openai');
});

test('isGeminiProvider handles normalized and display forms', () => {
  assert.equal(isGeminiProvider('gemini'), true);
  assert.equal(isGeminiProvider('Google Gemini'), true);
  assert.equal(isGeminiProvider('openai'), false);
});

test('requireRole(super_admin) returns 403 without tenant-context error on main domain', async () => {
  const middleware = requireRole('super_admin');
  const req = {
    userId: 'user-1',
    user: { id: 'user-1', role: 'ADMIN', isTenantAdmin: false },
    tenantPool: null,
    headers: { host: 'www.betacdmy.com' },
    path: '/api/super-admin/ai-config',
    method: 'PUT'
  };
  const res = createMockResponse();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.notEqual(res.payload?.error, 'Tenant context missing.');
});

test('extractSubdomain resolves tenant from subdomain host and ignores central domain', () => {
  const previousMainDomain = process.env.MAIN_DOMAIN;
  process.env.MAIN_DOMAIN = 'betacdmy.com';

  try {
    assert.equal(extractSubdomain('poshacademy.betacdmy.com'), 'poshacademy');
    assert.equal(extractSubdomain('poshacademy.betacdmy.com:443'), 'poshacademy');
    assert.equal(extractSubdomain('www.betacdmy.com'), null);
    assert.equal(extractSubdomain('betacdmy.com'), null);
  } finally {
    if (previousMainDomain === undefined) {
      delete process.env.MAIN_DOMAIN;
    } else {
      process.env.MAIN_DOMAIN = previousMainDomain;
    }
  }
});
