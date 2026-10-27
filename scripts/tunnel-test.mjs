import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { createVerificationMailer } from '../backend/src/mailer.mjs';
import { openAuthDatabase } from '../backend/src/database.mjs';
import { buildTunnelTestConfig, checkTunnelTestBuild, createTunnelTestApp, loadTunnelTestEnvironment, prepareTunnelTestDatabase } from '../backend/src/tunnel-test.mjs';
import { checkCloudflaredClient } from './cloudflared-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const start = args.includes('--start');
const originIndex = args.indexOf('--origin');
if (args.filter(arg => arg === '--origin').length > 1 || args.some((arg, index) =>
  !['--start', '--check', '--origin'].includes(arg) && !(originIndex >= 0 && index === originIndex + 1))) {
  console.error('Use --check, or --start [--origin https://EXACT.trycloudflare.com].'); process.exit(1);
}

let runtime, server;
const messages = new Set([
  'The private .env.tunnel-test.local file is missing.', 'A LiveKit test setting is missing or duplicated. Values withheld.',
  'Invalid test origin or LiveKit URL. Values withheld.', 'Use an application origin without a path or credentials.',
  'Use the exact HTTPS Quick Tunnel origin, or http://127.0.0.1:3002 locally.',
  'A LiveKit Cloud WSS origin is required. Values withheld.', 'LiveKit test credentials are missing or placeholders. Values withheld.',
  'Save one to five distinct tester email addresses in TUNNEL_TEST_EMAILS before using a public origin.',
  'Build the frontend with npm run build first.', 'A private configuration value was found in the frontend build. Details withheld.',
  'An unmarked database exists at the test path. It will not be opened or migrated.', 'The test database marker is invalid.',
  'The existing backend SMTP configuration is unavailable. Credentials withheld.', 'The LiveKit test service is not configured.',
  'Private test files are not protected by Git ignore rules.', 'Port 3002 is already in use. No existing process was stopped.',
]);
try {
  const environment = loadTunnelTestEnvironment(root);
  const config = buildTunnelTestConfig(environment, { root, ...(originIndex >= 0 ? { origin: args[originIndex + 1] || 'invalid' } : {}) });
  for (const filename of ['.env.tunnel-test.local', 'data/tunnel-test/talk.sqlite']) {
    const ignored = spawnSync('git', ['check-ignore', '--quiet', '--', filename], { cwd: root, windowsHide: true });
    const tracked = spawnSync('git', ['ls-files', '--', filename], { cwd: root, encoding: 'utf8', windowsHide: true });
    if (ignored.status !== 0 || tracked.status !== 0 || tracked.stdout.trim()) throw new Error('Private test files are not protected by Git ignore rules.');
  }
  checkTunnelTestBuild(config);
  const mailer = createVerificationMailer(config.environment);
  if (!mailer.configured) throw new Error('The existing backend SMTP configuration is unavailable. Credentials withheld.');
  prepareTunnelTestDatabase(config);
  const db = openAuthDatabase(config.databasePath);
  let accountCount;
  try { accountCount = Number(db.prepare('SELECT COUNT(*) AS count FROM accounts').get().count); }
  finally { db.close(); }
  const available = await new Promise(resolve => {
    const probe = createNetServer();
    probe.once('error', () => resolve(false));
    probe.listen(3002, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
  if (!available) throw new Error('Port 3002 is already in use. No existing process was stopped.');
  const cloudflared = checkCloudflaredClient();
  console.log(JSON.stringify({
    privateEnvironment: 'PASS', frontendBuildAndSecretScan: 'PASS', gitIgnoreProtection: 'PASS',
    backendMailerConfiguration: 'PASS', databaseIsolation: 'PASS',
    database: 'data/tunnel-test/talk.sqlite', testAccountCount: accountCount,
    invitedTesterCount: config.allowedEmails.length,
    publicOriginReadiness: config.allowedEmails.length ? 'READY_FOR_LATER_APPROVAL' : 'TESTER_EMAILS_REQUIRED',
    recording: 'DISABLED', transcription: 'DISABLED', phoneAndGoogleSignIn: 'DISABLED_IN_TEST_ADAPTER_ONLY',
    cloudflared: cloudflared.status,
    ...(cloudflared.status === 'VERIFIED' ? { cloudflaredExecutable: cloudflared.executable, cloudflaredVersion: cloudflared.version } : {}),
    listener: '127.0.0.1:3002', publicAccess: 'NOT_STARTED',
  }, null, 2));
  if (start) {
    runtime = createTunnelTestApp(config, { mailer });
    server = createServer(runtime.app);
    runtime.attach(server);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(3002, '127.0.0.1', resolve); });
    console.log(config.publicMode ? 'Talk test backend ready for the explicitly configured HTTPS origin. No tunnel was started.'
      : 'Talk temporary test is running locally at http://127.0.0.1:3002/sign-in . No public access.');
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return; stopping = true;
      const deadline = setTimeout(() => process.exit(1), 15000); deadline.unref();
      const closed = new Promise(resolve => server.close(resolve)); server.closeIdleConnections();
      try { await runtime.close(); server.closeAllConnections(); await closed; console.log('Talk temporary test stopped. Test data retained; no other server was stopped.'); }
      finally { clearTimeout(deadline); }
    };
    process.once('SIGINT', () => { void shutdown().catch(() => { console.error('Test shutdown did not complete. Details withheld.'); process.exitCode = 1; }); });
    process.once('SIGTERM', () => { void shutdown().catch(() => { console.error('Test shutdown did not complete. Details withheld.'); process.exitCode = 1; }); });
    // A local parent process can exercise graceful shutdown on Windows without
    // an HTTP administration endpoint or sending signals to unrelated consoles.
    if (process.connected) process.on('message', message => {
      if (message === 'shutdown') void shutdown().then(() => process.disconnect?.()).catch(() => { process.exitCode = 1; process.disconnect?.(); });
    });
  }
} catch (error) {
  console.error(messages.has(error?.message) ? error.message : 'Temporary test preflight failed. Private diagnostic details withheld.');
  if (server) { server.closeAllConnections(); server.close(); }
  if (runtime) await runtime.close().catch(() => {});
  process.exitCode = 1;
}
