import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

// Offline container smoke test. PostgreSQL and the app share loopback in a
// network-less namespace: even accidental SMTP/Firebase calls cannot leave it.
const pgName = `talk-auth-image-pg-${process.pid}`;
const appName = `talk-auth-image-app-${process.pid}`;
const image = 'talk-auth:local-check';
const password = randomBytes(32).toString('base64url');
const env = { ...process.env, POSTGRES_PASSWORD: password, PGPASSWORD: password, AUTH_COOKIE_SECRET: randomBytes(32).toString('base64url') };
let pgStarted = false; let appStarted = false; let step = 'start offline PostgreSQL fixture';
const docker = args => execFileSync('docker', args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 60000 }).trim();
const pgArgs = ['--network', `container:${pgName}`, '-e', 'PGHOST=127.0.0.1', '-e', 'PGUSER=talk_test', '-e', 'PGDATABASE=talk_auth_test', '-e', 'PGPASSWORD'];
const appArgs = ['--name', appName, ...pgArgs, '-e', 'APP_URL=https://talk-fc3dc.web.app', '-e', 'AUTH_DB_DRIVER=postgres', '-e', 'AUTH_COOKIE_MODE=hosting', '-e', 'AUTH_COOKIE_SECRET', '-e', 'TRUSTED_PROXY_CIDRS=127.0.0.1/8,::1/128', '-e', 'FIREBASE_PROJECT_ID=talk-production-fixture', '-e', 'GOOGLE_CLIENT_ID=fixture.apps.googleusercontent.com', '-e', 'SMTP_HOST=smtp.invalid', '-e', 'SMTP_PORT=587', '-e', 'SMTP_USER=fixture@example.com', '-e', 'SMTP_PASSWORD=offline-fixture-only', '-e', 'SMTP_FROM=fixture@example.com'];
// Pass a cookie only via the exec environment, never interpolate it into code or
// print the raw output. Docker's exec environment is scoped to that one command.
function configuration() {
  const result = docker(['exec', '-e', 'TALK_SMOKE_COOKIE', appName, 'node', '-e', `(async()=>{const h=await fetch('http://127.0.0.1:8080/healthz');const r=await fetch('http://127.0.0.1:8080/api/auth/config',{headers:{Cookie:process.env.TALK_SMOKE_COOKIE||''}});if(!h.ok||!r.ok)process.exit(2);const d=await r.json();console.log(JSON.stringify({ready:(await h.json()).ready,nonce:d.nonce,cookie:r.headers.getSetCookie()[0]?.split(';')[0]}));})().catch(()=>process.exit(1));`]);
  return JSON.parse(result);
}
try {
  docker(['run', '--rm', '-d', '--network', 'none', '--name', pgName, '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_USER=talk_test', '-e', 'POSTGRES_DB=talk_auth_test', 'postgres:16-bookworm']); pgStarted = true;
  for (let i = 0; ; i++) {
    try { docker(['exec', pgName, 'pg_isready', '-U', 'talk_test', '-d', 'talk_auth_test']); break; }
    catch { if (i >= 40) throw new Error('Fixture not ready.'); await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  step = 'run the production migration entry point from the built image';
  docker(['run', '--rm', ...pgArgs, image, 'node', 'server/migrate-production.mjs']);
  step = 'start and check the actual production entry point';
  docker(['run', '--rm', '-d', ...appArgs, image]); appStarted = true;
  let first;
  for (let i = 0; ; i++) {
    try { first = configuration(); break; }
    catch { if (i >= 40) throw new Error('App not ready.'); await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  if (!first.ready || !first.nonce || !first.cookie?.startsWith('__session=')) throw new Error('Production protocol unavailable.');
  step = 'restart the app with the same durable database and cookie key';
  docker(['stop', '--time', '5', appName]); appStarted = false;
  docker(['run', '--rm', '-d', ...appArgs, image]); appStarted = true;
  env.TALK_SMOKE_COOKIE = first.cookie;
  let second;
  for (let i = 0; ; i++) {
    try { second = configuration(); break; }
    catch { if (i >= 40) throw new Error('Restart not ready.'); await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  if (!second.ready || second.nonce !== first.nonce) throw new Error('Cookie/database persistence failed.');
  console.log('PASS Offline production image: migrations, actual startup, database health, encrypted Hosting challenge and persistence after app restart. No SMTP/SMS/cloud network was available.');
} catch { console.error(`FAIL Offline image smoke at: ${step}. Test secrets and cookies withheld.`); process.exitCode = 1; }
finally {
  if (appStarted) try { docker(['stop', '--time', '5', appName]); } catch {}
  if (pgStarted) try { docker(['stop', '--time', '5', pgName]); } catch {}
}
