import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTenantPublicUrl,
  extractTenantPathSubdomain,
  isRailwayDeploymentHost,
  stripTenantPathPrefix,
  supportsHostSubdomainTenants
} from '../../utils/platform-host.js';

test('Railway hosts do not support nested subdomain tenants (TLS)', () => {
  assert.equal(isRailwayDeploymentHost('betacdmy-production.up.railway.app'), true);
  assert.equal(supportsHostSubdomainTenants('betacdmy-production.up.railway.app'), false);
  assert.equal(supportsHostSubdomainTenants('betacdmy.com'), true);
});

test('buildTenantPublicUrl uses /t/{sub} on Railway hosts', () => {
  const url = buildTenantPublicUrl({
    subdomain: 'mnm',
    mainDomain: 'betacdmy-production.up.railway.app',
    host: 'betacdmy-production.up.railway.app',
    protocol: 'https'
  });
  assert.equal(url, 'https://betacdmy-production.up.railway.app/t/mnm');
});

test('buildTenantPublicUrl uses classic host subdomain on real domains', () => {
  const url = buildTenantPublicUrl({
    subdomain: 'mnm',
    mainDomain: 'betacdmy.com',
    host: 'betacdmy.com',
    protocol: 'https'
  });
  assert.equal(url, 'https://mnm.betacdmy.com');
});

test('extractTenantPathSubdomain and stripTenantPathPrefix', () => {
  assert.equal(extractTenantPathSubdomain('/t/mnm'), 'mnm');
  assert.equal(extractTenantPathSubdomain('/t/mnm/dashboard'), 'mnm');
  assert.equal(extractTenantPathSubdomain('/saas/signup'), null);
  assert.equal(stripTenantPathPrefix('/t/mnm/dashboard', 'mnm'), '/dashboard');
  assert.equal(stripTenantPathPrefix('/t/mnm', 'mnm'), '/');
});

test('nested railway academy host must never be generated', () => {
  const url = buildTenantPublicUrl({
    subdomain: 'mnm',
    mainDomain: 'betacdmy-production.up.railway.app',
    host: 'betacdmy-production.up.railway.app'
  });
  assert.ok(url);
  assert.equal(url.includes('mnm.betacdmy-production.up.railway.app'), false);
  assert.ok(url.includes('/t/mnm'));
});
