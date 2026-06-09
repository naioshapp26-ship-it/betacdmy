import dotenv from 'dotenv';
import { hasDatabaseConfig } from '../db/resolve-database-url.js';

dotenv.config();

if (!hasDatabaseConfig()) {
  console.error('');
  console.error('=== BETACADEMY STARTUP FAILED ===');
  console.error('PostgreSQL is not connected to this service.');
  console.error('');
  console.error('Railway fix (choose ONE):');
  console.error('');
  console.error('  Option A — Connect from canvas (easiest):');
  console.error('    1. Click the Postgres box on the canvas');
  console.error('    2. Click "Connect"');
  console.error('    3. Select service: betacdmy');
  console.error('    4. Redeploy');
  console.error('');
  console.error('  Option B — Variables tab:');
  console.error('    1. Open betacdmy → Variables');
  console.error('    2. + New Variable → Add Reference');
  console.error('    3. Postgres → DATABASE_URL');
  console.error('    4. Redeploy');
  console.error('');
  process.exit(1);
}

console.log('[Startup] Database URL configured ✓');
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
