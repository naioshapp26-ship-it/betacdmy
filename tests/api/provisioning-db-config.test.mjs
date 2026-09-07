/**
 * Unit tests for tenant provisioning helpers and the create-tenant encryption bugfix.
 * Run: node --test tests/api/provisioning*.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptField, decryptField } from '../../db/field-encryption.js';
import {
  buildPendingDatabaseUrl,
  isPendingDatabaseUrl,
  quotePgIdentifier,
  replaceDatabaseNameInUrl,
  resolveProvisioningAdminDatabaseUrl,
  resolveTenantDatabaseUrlTemplate
} from '../../backend/dist/utils/provisioning-db-config.js';

test('encryptField returns null for empty string (historical bug)', () => {
  assert.equal(encryptField('', 'secret'), null);
});

test('pending placeholder encrypts to a non-null buffer suitable for NOT NULL column', () => {
  const pending = buildPendingDatabaseUrl('tenant_mnmn');
  assert.ok(isPendingDatabaseUrl(pending));
  const encrypted = encryptField(pending, 'test-secret-key');
  assert.ok(Buffer.isBuffer(encrypted));
  assert.ok(encrypted.length > 0);
  assert.equal(decryptField(encrypted, 'test-secret-key'), pending);
});

test('replaceDatabaseNameInUrl swaps the DB name and keeps query params', () => {
  const source = 'postgresql://user:pass@host:5432/railway?sslmode=require';
  const templated = replaceDatabaseNameInUrl(source, '{db}');
  assert.equal(templated, 'postgresql://user:pass@host:5432/{db}?sslmode=require');
});

test('resolveTenantDatabaseUrlTemplate prefers explicit template', () => {
  const template = resolveTenantDatabaseUrlTemplate({
    TENANT_DATABASE_URL_TEMPLATE: 'postgresql://u:p@h:5432/{db}',
    DATABASE_URL: 'postgresql://u:p@h:5432/railway'
  });
  assert.equal(template, 'postgresql://u:p@h:5432/{db}');
});

test('resolveTenantDatabaseUrlTemplate derives from DATABASE_URL', () => {
  const template = resolveTenantDatabaseUrlTemplate({
    DATABASE_URL: 'postgresql://u:p@host:5432/railway?sslmode=require'
  });
  assert.equal(template, 'postgresql://u:p@host:5432/{db}?sslmode=require');
});

test('resolveProvisioningAdminDatabaseUrl falls back to DATABASE_URL', () => {
  const admin = resolveProvisioningAdminDatabaseUrl({
    DATABASE_URL: 'postgresql://u:p@host:5432/railway'
  });
  assert.equal(admin, 'postgresql://u:p@host:5432/railway');
});

test('quotePgIdentifier escapes quotes', () => {
  assert.equal(quotePgIdentifier('tenant_abc'), '"tenant_abc"');
  assert.equal(quotePgIdentifier('a"b'), '"a""b"');
});
