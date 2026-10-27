// Independent connector controller. Never starts/stops/watches the Talk server.
// Raw cloudflared output is consumed in memory; only safe origin/status persists.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { checkCloudflaredClient } from './cloudflared-client.mjs';
let child, deadline, heartbeat, launch, origin, connected = false, stopping = false, buffer = '';
const atomic = (p, value) => { fs.writeFileSync(p + '.connector.tmp', JSON.stringify(value), { mode: 0o600 }); fs.renameSync(p + '.connector.tmp', p); };
const save = running => { if (launch) atomic(launch.connectorState, { launchId: launch.id, controllerPid: process.pid, connectorPid: child?.pid, origin: origin || null, connected, running, serverManagedByConnector: false, updatedAt: new Date().toISOString() }); };
const stop = () => { stopping = true; clearTimeout(deadline); clearInterval(heartbeat); child?.kill(); };
try {
  launch = JSON.parse(fs.readFileSync('artifacts/qa/five-user-public-launch.json'));
  assert.deepEqual(process.argv.slice(2), ['--approved', launch.id]); assert.equal(launch.securityPreflight, 'PASS'); assert.equal(launch.servicesDisabled, true);
  const state = JSON.parse(fs.readFileSync(launch.serverState)); assert.equal(state.launchId, launch.id); assert.equal(state.status, 'WAITING_FOR_NEW_ORIGIN'); assert.notEqual(state.serverPid, process.pid);
  assert.equal(fs.existsSync(launch.originFile), false);
  const client = checkCloudflaredClient(); assert.equal(client.status, 'VERIFIED'); assert.equal(client.executable, launch.client);
  for (const name of ['config.yml', 'config.yaml']) assert.equal(fs.existsSync(path.join(process.env.USERPROFILE, '.cloudflared', name)), false);
  const status = await new Promise((resolve, reject) => { const q = request({ host: '127.0.0.1', port: 3003, path: '/healthz', timeout: 5000 }, r => { r.resume(); r.on('end', () => resolve(r.statusCode)); }); q.on('error', reject); q.on('timeout', () => q.destroy(Error('timeout'))); q.end(); }); assert.equal(status, 503);
  const allowed = new Set(['systemroot', 'windir', 'path', 'pathext', 'userprofile', 'appdata', 'localappdata', 'programfiles', 'programfiles(x86)', 'programdata', 'homedrive', 'homepath', 'temp', 'tmp', 'comspec']);
  child = spawn(client.executable, ['tunnel', '--no-autoupdate', '--metrics', '127.0.0.1:0', '--url', 'http://127.0.0.1:3003'], { cwd: launch.root, env: Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase()))), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const consume = bytes => {
    buffer = (buffer + bytes.toString()).slice(-32768);
    if (!origin) { const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i.exec(buffer); if (match) origin = new URL(match[0]).origin; }
    if (/Registered tunnel connection/.test(buffer)) connected = true;
    if (origin && connected && !fs.existsSync(launch.originFile)) { atomic(launch.originFile, { launchId: launch.id, origin, connected: true, connectorPid: child.pid, controllerPid: process.pid, assignedAt: new Date().toISOString() }); clearTimeout(deadline); console.log(JSON.stringify({ connected: true, origin })); }
    save(true);
  };
  child.stdout.on('data', consume); child.stderr.on('data', consume);
  child.once('error', () => { connected = false; stop(); save(false); console.error('Connector startup failed. Private output withheld.'); process.exitCode = 1; });
  child.once('exit', code => { connected = false; clearTimeout(deadline); clearInterval(heartbeat); save(false); if (!stopping) process.exitCode = code || 1; });
  deadline = setTimeout(() => { console.error('Connector did not become ready; temporary ingress stopped.'); stop(); process.exitCode = 1; }, 120000);
  heartbeat = setInterval(() => save(!stopping), 15000); heartbeat.unref(); save(true);
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
} catch { console.error('Five-user connector preflight failed. No server changed.'); stop(); process.exitCode = 1; }
