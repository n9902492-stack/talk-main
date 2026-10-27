import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { postgresConfig } from './postgres-database.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tables = ['accounts', 'identities', 'sessions', 'google_challenges', 'email_challenges', 'phone_profiles', 'phone_challenges', 'phone_token_uses', 'rate_limits', 'talk_meetings', 'talk_meeting_members', 'talk_meeting_connections', 'talk_meeting_events', 'account_avatars', 'account_backgrounds'];
tables.push('password_reset_challenges');
tables.push('talk_recordings','talk_recording_consents','talk_recording_events','talk_recording_jobs','talk_transcript_segments');
tables.push('talk_transcript_revisions','talk_ai_consents','talk_ai_reports','talk_ai_report_sources','talk_ai_report_revisions','talk_ai_jobs','talk_ai_events');
tables.push('talk_whiteboards','talk_whiteboard_permissions','talk_whiteboard_operations','talk_whiteboard_snapshots','talk_whiteboard_images','talk_whiteboard_events','talk_whiteboard_versions');
tables.push('talk_whiteboard_ai_jobs');
tables.push('talk_whiteboard_ai_approvals','talk_whiteboard_ai_usage');

/** Import only into an empty, migrated target. Never export or print row values. */
export async function importSqlite(source, pool) {
  const client = await pool.connect();
  const counts = {};
  let sourceTransaction = false;
  try {
    source.exec('BEGIN'); sourceTransaction = true;
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(791604215)');
    for (const table of tables) {
      await client.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
      if ((await client.query(`SELECT 1 FROM ${table} LIMIT 1`)).rowCount) throw new Error('Import requires an empty target.');
    }
    for (const table of tables) {
      if ((table.startsWith('talk_') || table === 'account_avatars' || table === 'account_backgrounds' || table === 'password_reset_challenges') && !source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) { counts[table] = 0; continue; }
      const allowed = new Set((await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1', [table])).rows.map(row => row.column_name));
      const rows = source.prepare(`SELECT * FROM ${table}`).all();
      for (const row of rows) {
        const columns = Object.keys(row);
        if (!columns.every(name => /^[a-z_]+$/.test(name) && allowed.has(name))) throw new Error('Source schema is incompatible.');
        await client.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((_, i) => '$' + (i + 1)).join(',')})`, columns.map(name => row[name]));
      }
      counts[table] = rows.length;
    }
    source.exec('COMMIT'); sourceTransaction = false;
    await client.query('COMMIT'); return counts;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (sourceTransaction) try { source.exec('ROLLBACK'); } catch {}
    throw error;
  }
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
