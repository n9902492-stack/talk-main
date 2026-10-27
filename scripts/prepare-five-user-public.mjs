// Local preparation only. A separate approved connector starts public access.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { fiveUserConfiguration, prepareFiveUserDatabase, createFiveUserApp } from '../backend/src/five-user-test.mjs';
import { checkCloudflaredClient } from './cloudflared-client.mjs';
const root = process.cwd(), file = 'artifacts/qa/five-user-public-launch.json';
const digest = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
let runtime, server, stage = 'approval';
try {
  assert.deepEqual(process.argv.slice(2), ['--approved']);
  assert.equal(fs.existsSync(file), false, 'An existing launch must be reviewed before creating another one.');
  const tap = fs.readFileSync('artifacts/qa/five-user-public-security.tap', 'utf8'); assert.match(tap, /# fail 0\b/); assert.match(tap, /# pass [4-9]\b/);
  stage = 'port availability'; const probe = createServer(); await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(3003, '127.0.0.1', resolve); }); await new Promise(resolve => probe.close(resolve));
  stage = 'client and isolation'; const client = checkCloudflaredClient(); assert.equal(client.status, 'VERIFIED');
  for (const name of ['config.yml', 'config.yaml']) assert.equal(fs.existsSync(path.join(process.env.USERPROFILE, '.cloudflared', name)), false);
  const parent = path.resolve('data/five-user-public-test'); fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, 'run-'));
  for (const p of [directory, '.env.local', '.env.tunnel-test.local']) assert.equal(spawnSync('git', ['check-ignore', '--quiet', '--', p], { windowsHide: true }).status, 0);
  // Protect credential hashes/invitation fixtures under the user's private data directory.
  if (process.platform === 'win32') {
    const who = spawnSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
    const sid = /S-1-5-[\d-]+/.exec(who.stdout || '')?.[0]; assert.ok(sid);
    assert.equal(spawnSync('icacls', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { windowsHide: true, stdio: 'ignore' }).status, 0);
    const runtimeOwner = path.join(root, 'artifacts/qa/five-user-runtime-owner.private.json');
    if (fs.existsSync(runtimeOwner)) { const owner = JSON.parse(fs.readFileSync(runtimeOwner)).sid; assert.match(owner, /^S-1-5-[\d-]+$/); assert.equal(spawnSync('icacls', [directory, '/grant:r', `*${owner}:(OI)(CI)F`], { windowsHide: true, stdio: 'ignore' }).status, 0); }
  }
  const smtp = JSON.parse(fs.readFileSync('artifacts/qa/smtp-reliability-fixture.private.json'));
  const preserve = ['.env.local', '.env.tunnel-test.local', 'data/tunnel-test/talk.sqlite', 'data/booking-link-test/confirmation-flow-vBfobG/confirmation-send-guard.sqlite', smtp.guardPath, 'artifacts/qa/smtp-reliability-approved-send.json'];
  const preserved = Object.fromEntries(preserve.map(p => [p, digest(p)]));
  const config = fiveUserConfiguration(root, 'https://five-user-offline-preflight.trycloudflare.com', directory);
  stage = 'separate synthetic database'; const seeded = await prepareFiveUserDatabase(config);
  stage = 'local security probes'; runtime = createFiveUserApp(config); server = createServer(runtime.app); runtime.attach(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const call = (p, headers = {}) => new Promise((resolve, reject) => { const q = request({ host: '127.0.0.1', port: server.address().port, path: p, headers: { Host: new URL(config.origin).host, 'X-Forwarded-Proto': 'https', 'CF-Connecting-IP': '192.0.2.91', ...headers } }, r => { let text = ''; r.on('data', b => text += b); r.on('end', () => resolve({ status: r.statusCode, text, headers: r.headers })); }); q.on('error', reject); q.end(); });
  const health = await call('/healthz'); assert.equal(health.status, 200); for (const flag of ['smtp', 'otp', 'sms', 'recording', 'transcription', 'gemini', 'calendar']) assert.equal(JSON.parse(health.text)[flag], false);
  const auth = await call('/api/auth/config'); assert.equal(auth.status, 200); assert.ok(auth.headers['set-cookie'].every(c => c.startsWith('fiveuser_talk_') && /; Secure/.test(c) && /; HttpOnly/.test(c)));
  assert.equal((await call('/healthz', { Host: 'unapproved.example' })).status, 403);
  assert.equal((await call('/api/auth/scheduling/dashboard')).status, 401);
  assert.equal((await call('/api/auth/whiteboards')).status, 404);
  assert.equal((await call('/api/auth/scheduling/google-calendar/callback')).status, 404);
  assert.equal((await runtime.auth.locals.schedulingJobs.tick()).enabled, false);
  for (const [p, value] of Object.entries(preserved)) assert.equal(digest(p), value);
  const manifest = { id: randomUUID(), approvedAction: 'five-user-public-test', root, directory, databasePath: config.databasePath, frontendPath: config.frontendPath,
    client: client.executable, originFile: path.join(directory, 'origin.json'), serverState: path.join(directory, 'server-state.json'), connectorState: path.join(directory, 'connector-state.json'),
    serverStdout: path.join(directory, 'server.stdout.log'), serverStderr: path.join(directory, 'server.stderr.log'), connectorStdout: path.join(directory, 'connector.stdout.log'), connectorStderr: path.join(directory, 'connector.stderr.log'),
    preparedAt: new Date().toISOString(), securityPreflight: 'PASS', servicesDisabled: true, preserved, ...seeded };
  fs.writeFileSync(path.join(directory, 'launch.private.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ preflight: 'PASS', listener: '127.0.0.1:3003', database: path.relative(root, config.databasePath), allowlistCount: 5, importedVerifiedAccounts: seeded.importedVerifiedAccounts, verificationRequiredAccounts: seeded.verificationRequiredAccounts, smtp: false, otp: false, publicAccess: 'NOT_STARTED' }));
} catch { console.error('Five-user preparation stopped at ' + stage + '. No public connector or email started.'); process.exitCode = 1; }
finally { server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve)); await runtime?.close(); }
