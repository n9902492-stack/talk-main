import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { postgresConfig } from './postgres-database.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tables = ['accounts', 'identities', 'sessions', 'google_challenges', 'email_challenges', 'phone_profiles', 'phone_challenges', 'phone_token_uses', 'rate_limits'];

/** Import only into an empty, migrated target. Never export or print row values. */
export async function importSqlite(source, pool) {
  const client = await pool.connect();
  const counts = {};
  source.exec('BEGIN');
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(791604215)');
    for (const table of tables) {
      await client.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
      if ((await client.query(`SELECT 1 FROM ${table} LIMIT 1`)).rowCount) throw new Error('Import requires an empty target.');
    }
    for (const table of tables) {
      const allowed = new Set((await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1', [table])).rows.map(row => row.column_name));
      const rows = source.prepare(`SELECT * FROM ${table}`).all();
      for (const row of rows) {
        const columns = Object.keys(row);
        if (!columns.every(name => /^[a-z_]+$/.test(name) && allowed.has(name))) throw new Error('Source schema is incompatible.');
        await client.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((_, i) => '$' + (i + 1)).join(',')})`, columns.map(name => row[name]));
      }
      counts[table] = rows.length;
    }
    await client.query('COMMIT'); source.exec('COMMIT'); return counts;
  } catch (error) { await client.query('ROLLBACK'); source.exec('ROLLBACK'); throw error; }
  finally { client.release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let pool; let source;
  try {
    if (!process.argv.includes('--confirm-empty-target') || !process.env.SQLITE_IMPORT_PATH) throw new Error('Explicit import confirmation and source path required.');
    source = new DatabaseSync(path.resolve(process.env.SQLITE_IMPORT_PATH), { readOnly: true });
    pool = new pg.Pool(postgresConfig(process.env)); pool.on('error', () => {});
    await importSqlite(source, pool);
    console.log('Authentication data imported transactionally. Password/session hashes and account IDs preserved; no row values logged.');
  } catch { console.error('Import failed or target was not empty. No partial import committed; database details withheld.'); process.exitCode = 1; }
  finally { source?.close(); await pool?.end(); }
}
