import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = fileURLToPath(new URL('../', import.meta.url));
const name = `talk-auth-postgres-test-${process.pid}`;
const password = randomBytes(24).toString('base64url');
let started = false; let step = 'start isolated local database';
try {
  execFileSync('docker', ['run', '--rm', '-d', '--name', name, '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_USER=talk_test', '-e', 'POSTGRES_DB=talk_auth_test', '-p', '127.0.0.1::5432', 'postgres:16-bookworm'], { env: { ...process.env, POSTGRES_PASSWORD: password }, stdio: 'pipe', windowsHide: true });
  started = true;
  const binding = execFileSync('docker', ['port', name, '5432/tcp'], { encoding: 'utf8', windowsHide: true }).trim();
  if (!/^127\.0\.0\.1:\d+$/.test(binding)) throw new Error('Unexpected test port.');
  const env = { ...process.env, TALK_POSTGRES_TEST: '1', PGHOST: '127.0.0.1', PGPORT: binding.split(':')[1], PGUSER: 'talk_test', PGPASSWORD: password, PGDATABASE: 'talk_auth_test', PGSSLMODE: 'disable' };
  let ready = false;
  for (let i = 0; i < 40; i++) {
    const client = new pg.Client({ host: env.PGHOST, port: Number(env.PGPORT), user: env.PGUSER, password, database: env.PGDATABASE, connectionTimeoutMillis: 1000 });
    client.on('error', () => {});
    try { await client.connect(); await client.query('SELECT 1'); ready = true; } catch {} finally { await client.end().catch(() => {}); }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Test database unavailable.');
  console.log('Isolated PostgreSQL 16 is ready. No cloud, SMTP or SMS services are used.');
  step = 'production database authentication tests';
  const result = spawnSync(process.execPath, ['--test', path.join(root, 'tests/production-auth.test.mjs')], { cwd: root, env, stdio: 'inherit', windowsHide: true });
  process.exitCode = result.status ?? 1;
} catch { console.error(`Production test runner failed at: ${step}. Private local database details withheld.`); process.exitCode = 1; }
finally {
  if (started && /^talk-auth-postgres-test-\d+$/.test(name)) {
    try { execFileSync('docker', ['stop', '--time', '5', name], { stdio: 'pipe', windowsHide: true }); } catch { console.error('Stop the named Talk test container manually; unrelated containers were not touched.'); }
  }
}
