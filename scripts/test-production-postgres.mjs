import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import pg from 'pg';

const root = fileURLToPath(new URL('../', import.meta.url));
const name = `talk-auth-postgres-test-${process.pid}`;
const password = randomBytes(24).toString('base64url');
let started = false; let step = 'start isolated local database';
try {
  execFileSync('docker', ['run', '--pull=never', '--memory=384m', '--cpus=1', '--rm', '-d', '--name', name, '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_USER=talk_test', '-e', 'POSTGRES_DB=talk_auth_test', '-p', '127.0.0.1::5432', 'postgres:16-bookworm'], { env: { ...process.env, POSTGRES_PASSWORD: password }, stdio: 'pipe', windowsHide: true, timeout: 60000, killSignal: 'SIGKILL' });
  started = true;
  step = 'resolve isolated database port';
  const binding = execFileSync('docker', ['port', name, '5432/tcp'], { encoding: 'utf8', windowsHide: true, timeout: 10000, killSignal: 'SIGKILL' }).trim();
  if (!/^127\.0\.0\.1:\d+$/.test(binding)) throw new Error('Unexpected test port.');
  const env = { ...process.env, TALK_POSTGRES_TEST: '1', PGHOST: '127.0.0.1', PGPORT: binding.split(':')[1], PGUSER: 'talk_test', PGPASSWORD: password, PGDATABASE: 'talk_auth_test', PGSSLMODE: 'disable' };
  let ready = false;
  step = 'wait for isolated database readiness';
  for (let i = 0; i < 90; i++) {
    const client = new pg.Client({ host: env.PGHOST, port: Number(env.PGPORT), user: env.PGUSER, password, database: env.PGDATABASE, connectionTimeoutMillis: 2000 });
    client.on('error', () => {});
    try { await client.connect(); await client.query('SELECT 1'); ready = true; } catch {} finally { await client.end().catch(() => {}); }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Test database unavailable.');
  console.log('Isolated PostgreSQL 16 is ready. No cloud, SMTP or SMS services are used.');
  step = 'production database authentication and recording persistence tests';
  // These suites intentionally share one disposable database. Authentication
  // asserts an initially empty session table, so run files sequentially.
  const suites = process.argv.includes('--calendar-only') ? ['production-google-calendar.test.mjs','production-scheduling.test.mjs'] : process.argv.includes('--scheduling-only') ? ['production-scheduling.test.mjs'] : process.argv.includes('--whiteboard-cloud-only') ? ['production-whiteboard-cloud.test.mjs'] : process.argv.includes('--whiteboard-ai-only') ? ['production-whiteboard-intelligence.test.mjs'] : process.argv.includes('--password-reset-only') ? ['production-password-reset.test.mjs'] : process.argv.includes('--whiteboard-only') ? ['production-whiteboards.test.mjs'] : process.argv.includes('--assistant-only') ? ['production-assistant.test.mjs']
    : ['production-auth.test.mjs', 'production-recordings.test.mjs', 'production-assistant.test.mjs', 'production-whiteboards.test.mjs', 'production-password-reset.test.mjs', 'production-whiteboard-intelligence.test.mjs', 'production-whiteboard-cloud.test.mjs'];
  const result = spawnSync(process.execPath, ['--import',pathToFileURL(path.join(root,'tests/helpers/cloud-egress-guard.mjs')).href,'--test', '--test-concurrency=1', ...suites.map(suite => path.join(root, 'tests', suite))], { cwd: root, env, stdio: 'inherit', windowsHide: true });
  process.exitCode = result.status ?? 1;
} catch { console.error(`Production test runner failed at: ${step}. Private local database details withheld.`); process.exitCode = 1; }
finally {
  if (started && /^talk-auth-postgres-test-\d+$/.test(name)) {
    try { execFileSync('docker', ['stop', '--time', '5', name], { stdio: 'pipe', windowsHide: true, timeout: 15000, killSignal: 'SIGKILL' }); } catch { console.error('Stop the named Talk test container manually; unrelated containers were not touched.'); }
  }
}
