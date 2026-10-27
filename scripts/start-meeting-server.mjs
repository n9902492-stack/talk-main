import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { RoomServiceClient } from 'livekit-server-sdk';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'data');
const credentialsPath = path.join(directory, 'livekit-local.json');
const configPath = path.join(directory, 'livekit-local.yaml');
const executable = path.join(root, 'artifacts/qa/livekit/livekit-server.exe');
if (process.platform !== 'win32' || !existsSync(executable)) throw new Error('Install the local Windows server first with npm run meeting:setup. Other platforms: see deployment/MEETINGS.md.');
mkdirSync(directory, { recursive: true });
let configuration;
try { configuration = JSON.parse(readFileSync(credentialsPath, 'utf8')); } catch { /* First local run. */ }
if (!configuration) {
  configuration = { url: 'ws://127.0.0.1:7880', apiKey: `talklocal${randomBytes(8).toString('hex')}`, apiSecret: randomBytes(32).toString('base64url') };
  writeFileSync(credentialsPath, JSON.stringify(configuration), { mode: 0o600, flag: 'wx' });
}
if (configuration.url !== 'ws://127.0.0.1:7880' || !/^talklocal[a-f0-9]{16}$/.test(configuration.apiKey) || !/^[\w-]{43}$/.test(configuration.apiSecret)) throw new Error('Local meeting settings are invalid. Values withheld.');
const client = new RoomServiceClient('http://127.0.0.1:7880', configuration.apiKey, configuration.apiSecret);
async function ready() { try { await client.listRooms(); return true; } catch { return false; } }
if (await ready()) { console.log('The local Talk meeting server is already ready on port 7880.'); process.exit(0); }
// Loopback only: this server is intentionally inaccessible to other computers.
writeFileSync(configPath, [
  'port: 7880', 'bind_addresses: ["127.0.0.1"]', 'rtc:', '  tcp_port: 7881', '  udp_port: 7882',
  '  use_external_ip: false', '  node_ip: 127.0.0.1', '  enable_loopback_candidate: true',
  'keys:', `  ${configuration.apiKey}: ${configuration.apiSecret}`, 'logging:', '  level: warn', '',
].join('\n'), { mode: 0o600 });
const log = openSync(path.join(directory, 'livekit-local.log'), 'a', 0o600);
const child = spawn(executable, ['--config', configPath], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
closeSync(log);
let failed = false;
child.on('error', () => { failed = true; });
child.unref();
writeFileSync(path.join(directory, 'livekit-local.pid'), String(child.pid || ''), { mode: 0o600 });
for (let i = 0; i < 30 && !failed; i++) {
  await new Promise(resolve => setTimeout(resolve, 500));
  if (await ready()) { console.log('Local Talk meeting server ready at ws://127.0.0.1:7880. Random credentials remain in ignored data/. Restart npm run dev to load them. No cloud resources were created.'); process.exit(0); }
}
throw new Error('The local meeting server did not become ready. Inspect the private data/livekit-local.log.');
