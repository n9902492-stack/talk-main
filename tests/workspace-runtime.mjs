import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Test the actual standalone entry point from the backend workspace, not an
// injected app. Only loopback GET requests and a temporary database are used.
const root = fileURLToPath(new URL('../', import.meta.url));
const prefix = path.join(os.tmpdir(), 'talk-workspace-runtime-');
const temp = await mkdtemp(prefix);
const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
let child; let exited; let step = 'start the standalone backend';
try {
  child = spawn(process.execPath, [path.join(root, 'backend/src/index.mjs')], {
    cwd: path.join(root, 'backend'), windowsHide: true, stdio: 'ignore',
    env: { ...process.env, NODE_ENV: 'development', APP_URL: origin, PORT: String(port), HOST: '127.0.0.1',
      AUTH_DB_DRIVER: 'sqlite', AUTH_DATABASE_PATH: path.join(temp, 'auth.sqlite'),
      GOOGLE_CLIENT_ID: 'workspace-fixture.apps.googleusercontent.com',
      SMTP_HOST: 'smtp.invalid', SMTP_PORT: '587', SMTP_USER: 'fixture@example.com',
      SMTP_PASSWORD: 'offline-workspace-fixture', SMTP_FROM: 'fixture@example.com' },
  });
  exited = once(child, 'exit');
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error('Backend exited.');
    try { ready = (await fetch(origin + '/healthz')).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(ready);
  step = 'resolve frontend assets and API paths from the backend workspace';
  const page = await fetch(origin + '/sign-in'); assert.equal(page.status, 200);
  const html = await page.text(); const asset = html.match(/src="(\/assets\/[^\"]+\.js)"/);
  assert(asset); const script = await fetch(origin + asset[1]); assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);
  const config = await (await fetch(origin + '/api/auth/config')).json();
  assert.equal(config.clientId, 'workspace-fixture.apps.googleusercontent.com');
  assert.equal((await (await fetch(origin + '/api/auth/session')).json()).user, null);
  const missing = await fetch(origin + '/api/not-a-route'); assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'not_found');
  step = 'resolve the moved LFS video through its original website URL';
  const video = await fetch(origin + '/reference/session-recording.mp4', { headers: { Range: 'bytes=0-31' } });
  assert.equal(video.status, 206); const bytes = Buffer.from(await video.arrayBuffer());
  assert.equal(bytes.subarray(4, 8).toString(), 'ftyp');
  assert((await stat(path.join(temp, 'auth.sqlite'))).isFile());
  console.log('PASS Actual backend workspace entry: isolated SQLite, health, API, SPA fallback, built frontend assets and moved Git LFS video. No SMTP or SMS requested.');
} catch { console.error(`FAIL Workspace runtime at: ${step}. Private configuration and responses withheld.`); process.exitCode = 1; }
finally {
  if (child?.exitCode === null) { child.kill('SIGTERM'); await exited; }
  assert(path.resolve(temp).startsWith(path.resolve(prefix)));
  await rm(temp, { recursive: true, force: true });
}
