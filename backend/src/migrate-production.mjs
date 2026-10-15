import pg from 'pg';
import { migratePostgres, postgresConfig } from './postgres-database.mjs';

// Explicit operator/job action. Never reads local SMTP or private test settings.
let pool;
try {
  pool = new pg.Pool(postgresConfig(process.env));
  pool.on('error', () => {});
  await migratePostgres(pool);
  console.log('Production authentication schema is up to date. No row values were logged.');
} catch { console.error('Production schema migration failed. Database details withheld.'); process.exitCode = 1; }
finally { await pool?.end(); }
