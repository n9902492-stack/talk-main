import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { asyncDatabase } from './async-database.mjs';

/** Convert controlled SQL placeholders without changing quoted strings. */
export function parameterize(sql) {
  let quoted = false; let index = 0; let result = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      result += ch;
      if (quoted && sql[i + 1] === "'") result += sql[++i];
      else quoted = !quoted;
    } else result += ch === '?' && !quoted ? `$${++index}` : ch;
  }
  return result;
}

export function postgresConfig(env) {
  for (const key of ['PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD']) if (!env[key]) throw new Error(`Missing backend database setting: ${key}.`);
  const socket = /^\/cloudsql\/[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$/.test(env.PGHOST);
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(env.PGHOST);
  if (!socket && !loopback && env.PGSSLMODE !== 'verify-full') throw new Error('Remote PostgreSQL requires verified TLS.');
  const port = Number(env.PGPORT || 5432);
  const max = Number(env.PGPOOL_MAX || 5);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(max) || max < 1 || max > 20) throw new Error('Invalid PostgreSQL pool configuration.');
  return {
    host: env.PGHOST, database: env.PGDATABASE, user: env.PGUSER, password: env.PGPASSWORD, port, max,
    connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000, statement_timeout: 15000,
    ssl: socket || loopback && env.PGSSLMODE !== 'verify-full' ? false : { rejectUnauthorized: true, ...(env.PGSSL_CA ? { ca: env.PGSSL_CA } : {}) },
    types: { getTypeParser(oid, format) {
      if (oid === 20) return value => { const number = Number(value); if (!Number.isSafeInteger(number)) throw new Error('Database integer exceeds supported range.'); return number; };
      return pg.types.getTypeParser(oid, format);
    } },
  };
}

export async function migratePostgres(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(791604215)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)');
    const directory = new URL('./postgres-migrations/', import.meta.url);
    for (const version of readdirSync(directory).filter(name => /^\d+_.+\.sql$/.test(name)).sort()) {
      if ((await client.query('SELECT 1 FROM schema_migrations WHERE version=$1', [version])).rowCount) continue;
      await client.query(readFileSync(new URL(version, directory), 'utf8'));
      await client.query('INSERT INTO schema_migrations VALUES ($1,$2)', [version, Date.now()]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function openPostgresDatabase(env, { migrate = false } = {}) {
  const pool = new pg.Pool(postgresConfig(env));
  pool.on('error', () => { /* Never emit credential-bearing driver messages. Health checks report availability. */ });
  try {
    if (migrate) await migratePostgres(pool);
    const required = ['accounts', 'identities', 'sessions', 'google_challenges', 'email_challenges', 'phone_profiles', 'phone_challenges', 'phone_token_uses', 'rate_limits'];
    for (const table of required) await pool.query(`SELECT 1 FROM ${table} LIMIT 0`);
    return asyncDatabase({ kind: 'postgres', pool, parameterize });
  } catch { await pool.end(); throw new Error('Authentication database is unavailable or migrations are missing. Details withheld.'); }
}
