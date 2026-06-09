import dotenv from 'dotenv';

dotenv.config();

const hasDatabaseUrl = [
  process.env.CENTRAL_DATABASE_URL,
  process.env.DATABASE_URL,
  process.env.PROVISIONING_ADMIN_DATABASE_URL,
  process.env.TENANT_DATABASE_URL,
].some((value) => value && !value.includes('******'));

if (!hasDatabaseUrl) {
  console.error('');
  console.error('=== BETACADEMY STARTUP FAILED ===');
  console.error('No database URL configured (DATABASE_URL / CENTRAL_DATABASE_URL).');
  console.error('');
  console.error('Railway fix:');
  console.error('  1. Project → + New → Database → PostgreSQL');
  console.error('  2. Open betacdmy web service → Variables');
  console.error('  3. + New Variable → Add Reference → Postgres → DATABASE_URL');
  console.error('  4. Redeploy');
  console.error('');
  process.exit(1);
}

console.log('[Startup] Database URL configured');
console.log('[Startup] NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('[Startup] PORT:', process.env.PORT || '3000 (default)');

try {
  await import('../server.js');
} catch (error) {
  console.error('');
  console.error('=== BETACADEMY STARTUP FAILED ===');
  console.error(error?.message || error);
  console.error('');
  console.error('Check Railway Deploy Logs for details.');
  process.exit(1);
}
