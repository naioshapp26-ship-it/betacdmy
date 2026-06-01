import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    console.log('Restoring users table from backup...');
    
    // Check if backup exists
    const backupCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users_old_backup_017'
      ) as exists
    `);
    
    if (!backupCheck.rows[0].exists) {
      console.error('Backup table users_old_backup_017 does not exist!');
      process.exit(1);
    }
    
    // Rename backup to users
    await pool.query('ALTER TABLE users_old_backup_017 RENAME TO users;');
    console.log('✓ Users table restored from backup');
    
    // Verify
    const verify = await pool.query(`SELECT COUNT(*) as count FROM users`);
    console.log(`✓ Users table now has ${verify.rows[0].count} records`);
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
