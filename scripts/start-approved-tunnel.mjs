// Requires explicit operator approval. Raw connector logs (which can contain
// request URLs/tickets) never reach the terminal or a log file.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCloudflaredClient } from './cloudflared-client.mjs';
import { buildTunnelTestConfig, loadTunnelTestEnvironment } from '../backend/src/tunnel-test.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.length !== 3 || process.argv[2] !== '--approved') {
  console.error('Public access requires explicit approval. Run with --approved only after receiving it.'); process.exit(1);
}
const stateFile = path.join(root, 'data/tunnel-test/public-tunnel.json');
let child, deadline, heartbeat, origin, connected = false, stopping = false, outputBuffer = '', failure = 'connector_unavailable';
const state = running => {
  mkdirSync(path.dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify({ origin: origin || null, connected, running,
    controllerPid: process.pid, connectorPid: child?.pid || null, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
};
const stop = () => { if (stopping) return; stopping = true; clearTimeout(deadline); clearInterval(heartbeat); if (child) child.kill('SIGTERM'); };
const request = (headers = {}) => new Promise((resolve, reject) => {
  const req = http.get({ hostname: '127.0.0.1', port: 3002, path: '/healthz', headers, timeout: 5000 }, res => {
    let bytes = ''; res.on('data', data => { bytes += data; }); res.on('end', () => resolve({ status: res.statusCode, bytes }));
  });
  req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
});
try {
  const config = buildTunnelTestConfig(loadTunnelTestEnvironment(root), { root });
  if (config.allowedEmails.length !== 5) throw new Error('invalid_configuration');
  const client = checkCloudflaredClient();
  if (client.status !== 'VERIFIED') throw new Error('client_unavailable');
  for (const filename of ['config.yml', 'config.yaml']) {
    if (existsSync(path.join(process.env.USERPROFILE || process.env.HOME || root, '.cloudflared', filename))) throw new Error('existing_connector_configuration');
  }
  const local = await request();
  if (local.status !== 200 || JSON.parse(local.bytes).temporaryTest !== true) throw new Error('local_backend_unavailable');
  const locked = await request({ Host: 'not-approved.trycloudflare.com', 'X-Forwarded-Proto': 'https' });
  if (locked.status !== 403) throw new Error('local_origin_lock_required');
  // Do not inherit named-tunnel tokens/configuration or unrelated provider vars.
  const allowed = new Set(['systemroot', 'windir', 'path', 'pathext', 'userprofile', 'appdata', 'localappdata', 'programfiles', 'programfiles(x86)', 'programdata', 'homedrive', 'homepath', 'temp', 'tmp', 'comspec']);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase())));
  child = spawn(client.executable, ['tunnel', '--no-autoupdate', '--metrics', '127.0.0.1:20241', '--url', 'http://127.0.0.1:3002'],
    { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  state(true);
  heartbeat = setInterval(() => state(!stopping), 15000); heartbeat.unref();
  const consume = bytes => {
    outputBuffer = (outputBuffer + bytes.toString()).slice(-32768);
    if (!origin) {
      const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i.exec(outputBuffer);
      if (match) { origin = new URL(match[0]).origin; state(true); console.log(JSON.stringify({ status: 'HTTPS_ADDRESS_ASSIGNED', origin })); }
    }
    if (!connected && /Registered tunnel connection/.test(outputBuffer)) {
      connected = true; clearTimeout(deadline); state(true); console.log('Cloudflare connector connected. Backend exact-origin configuration is still required.');
    }
    if (/failed to (?:request|create) quick Tunnel|failed to request quick tunnel/i.test(outputBuffer)) failure = 'quick_tunnel_allocation_failed';
    else if (/timeout|deadline exceeded/i.test(outputBuffer)) failure = 'connector_network_timeout';
  };
  child.stdout.on('data', consume); child.stderr.on('data', consume);
  child.once('error', () => { failure = 'connector_start_failed'; stop(); connected = false; state(false); process.exitCode = 1; });
  child.once('exit', code => {
    clearTimeout(deadline); clearInterval(heartbeat); connected = false; state(false);
    if (stopping) console.log('Cloudflare Quick Tunnel stopped.');
    else { console.error('Cloudflare connector stopped. Category: ' + failure + '. Raw details withheld.'); process.exitCode = code || 1; }
    if (process.stdin.isTTY) process.stdin.pause();
  });
  deadline = setTimeout(() => { failure = 'connector_start_timeout'; console.error('Cloudflare did not connect in time. Stopping public ingress.'); stop(); process.exitCode = 1; }, 120000);
  if (process.stdin.isTTY) {
    process.stdin.setEncoding('utf8'); process.stdin.resume();
    process.stdin.on('data', value => { if (value.trim() === 'stop') stop(); });
  }
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
} catch {
  console.error('Approved tunnel startup stopped safely. Check local preflight. Private details withheld.'); stop(); process.exitCode = 1;
}
