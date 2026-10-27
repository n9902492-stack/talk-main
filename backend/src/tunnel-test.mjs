// Opt-in, loopback-only adapter for the temporary five-person test.
// Normal development/production entry points and authentication stay unchanged.
import path from 'node:path';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import express from 'express';
import dotenv from 'dotenv';
import { RoomServiceClient } from 'livekit-server-sdk';
import { createAuthApp } from './auth.mjs';
import { createVerificationMailer } from './mailer.mjs';
import { createMeetingService } from './meetings.mjs';
import { openAuthDatabase } from './database.mjs';

const livekitKeys = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'];
const smtpKeys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'];
const markerText = 'Talk temporary tunnel test database v1\n';
const assertSafe = (condition, message) => { if (!condition) throw new Error(message); };
const placeholder = value => typeof value !== 'string' || !value.trim()
  || /^(?:your[_ -]|replace[_ -]|change[ _-]?me|placeholder|x{6,}$)/i.test(value) || /[<>]|\$\{/.test(value);

export function loadTunnelTestEnvironment(root) {
  const testPath = path.join(root, '.env.tunnel-test.local');
  assertSafe(existsSync(testPath), 'The private .env.tunnel-test.local file is missing.');
  const raw = readFileSync(testPath, 'utf8'), test = dotenv.parse(raw);
  for (const key of livekitKeys) {
    assertSafe([...raw.matchAll(new RegExp('^\\s*(?:export\\s+)?' + key + '\\s*=', 'gm'))].length === 1,
      'A LiveKit test setting is missing or duplicated. Values withheld.');
  }
  // Read only SMTP configuration from existing files; never populate process.env
  // or inherit production DB, storage, Firebase, recording or provider settings.
  const fallback = existsSync(path.join(root, '.env')) ? dotenv.parse(readFileSync(path.join(root, '.env'))) : {};
  const local = existsSync(path.join(root, '.env.local')) ? dotenv.parse(readFileSync(path.join(root, '.env.local'))) : {};
  const environment = Object.fromEntries(smtpKeys.map(key => [key, local[key] ?? fallback[key]]));
  for (const key of [...livekitKeys, 'TUNNEL_TEST_EMAILS']) environment[key] = test[key];
  return environment;
}

export function buildTunnelTestConfig(env, { root, origin = 'http://127.0.0.1:3002' } = {}) {
  assertSafe(typeof root === 'string' && path.isAbsolute(root), 'A project root is required.');
  let url, cloud;
  try { url = new URL(origin); cloud = new URL(env.LIVEKIT_URL); } catch { throw new Error('Invalid test origin or LiveKit URL. Values withheld.'); }
  const publicMode = url.protocol === 'https:';
  assertSafe(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'Use an application origin without a path or credentials.');
  assertSafe(publicMode ? /^[a-z0-9-]+\.trycloudflare\.com$/i.test(url.hostname) && !url.port
    : url.origin === 'http://127.0.0.1:3002', 'Use the exact HTTPS Quick Tunnel origin, or http://127.0.0.1:3002 locally.');
  assertSafe(cloud.protocol === 'wss:' && /^[a-z0-9-]+\.livekit\.cloud$/i.test(cloud.hostname)
    && !cloud.username && !cloud.password && !cloud.search && !cloud.hash && !cloud.port && cloud.pathname === '/', 'A LiveKit Cloud WSS origin is required. Values withheld.');
  assertSafe(livekitKeys.every(key => !placeholder(env[key]) && env[key] === env[key].trim())
    && !/your-project|example|replace-me/i.test(cloud.hostname)
    && env.LIVEKIT_API_KEY.length >= 6 && env.LIVEKIT_API_SECRET.length >= 32, 'LiveKit test credentials are missing or placeholders. Values withheld.');
  const emails = (env.TUNNEL_TEST_EMAILS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  assertSafe((emails.length === 0 && !publicMode || emails.length >= 1 && emails.length <= 5)
    && new Set(emails).size === emails.length
    && emails.every(value => value.length <= 254 && /^[a-z\d.!#$%&'*+/=?^_`{|}~-]+@[a-z\d.-]+\.[a-z]{2,}$/i.test(value)),
  'Save one to five distinct tester email addresses in TUNNEL_TEST_EMAILS before using a public origin.');
  return Object.freeze({
    root: path.resolve(root), origin: url.origin, origins: [url.origin], publicMode, secureCookies: publicMode,
    host: '127.0.0.1', port: 3002, allowedEmails: Object.freeze(emails),
    databasePath: path.join(path.resolve(root), 'data', 'tunnel-test', 'talk.sqlite'),
    frontendPath: path.join(path.resolve(root), 'frontend', 'dist'),
    environment: Object.freeze(Object.fromEntries([...livekitKeys, ...smtpKeys].map(key => [key, env[key]]))),
  });
}

function rejectLinks(root, target) {
  const resolvedRoot = realpathSync(root);
  const relative = path.relative(root, target);
  assertSafe(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'The test path must stay inside the project.');
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (existsSync(current)) assertSafe(!lstatSync(current).isSymbolicLink(), 'Linked test paths are not permitted.');
  }
  if (existsSync(target)) {
    const resolved = realpathSync(target);
    assertSafe(resolved.startsWith(resolvedRoot + path.sep), 'The test path resolves outside the project.');
  }
}

export function prepareTunnelTestDatabase(config) {
  const expected = path.join(config.root, 'data', 'tunnel-test', 'talk.sqlite');
  assertSafe(config.databasePath === expected, 'Only the dedicated test database is permitted.');
  rejectLinks(config.root, config.databasePath);
  const directory = path.dirname(config.databasePath), marker = path.join(directory, '.talk-test-database');
  rejectLinks(config.root, marker);
  if (existsSync(config.databasePath)) assertSafe(existsSync(marker) && readFileSync(marker, 'utf8') === markerText,
    'An unmarked database exists at the test path. It will not be opened or migrated.');
  if (existsSync(marker)) assertSafe(readFileSync(marker, 'utf8') === markerText, 'The test database marker is invalid.');
  mkdirSync(directory, { recursive: true });
  if (!existsSync(marker)) writeFileSync(marker, markerText, { flag: 'wx', mode: 0o600 });
}

export function checkTunnelTestBuild(config) {
  rejectLinks(config.root, config.frontendPath);
  assertSafe(existsSync(path.join(config.frontendPath, 'index.html')), 'Build the frontend with npm run build first.');
  const privateValues = [...livekitKeys, 'SMTP_PASSWORD'].map(key => config.environment[key]).filter(value => typeof value === 'string' && value.length >= 6);
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      assertSafe(!entry.isSymbolicLink(), 'Linked frontend build files are not permitted.');
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else {
        const bytes = readFileSync(file);
        assertSafe(!privateValues.some(value => bytes.includes(Buffer.from(value))), 'A private configuration value was found in the frontend build. Details withheld.');
      }
    }
  }
  visit(config.frontendPath);
}

const apiAllowed = (method, pathname) => {
  if (method === 'GET') return /^\/api\/auth\/(?:config|session|email\/(?:config|verification)|phone\/config|meetings\/[a-z\d-]+(?:\/(?:state|recording-state))?|meeting-history(?:\/[a-z\d-]+)?|avatars\/[a-z\d_-]+\/image|profile\/background(?:\/image)?)$/.test(pathname);
  if (method === 'POST') return /^\/api\/auth\/(?:email\/(?:signup|login|resume|verify|resend|change)|logout|meetings(?:\/[a-z\d-]+\/(?:create|token|actions))?|profile\/avatar(?:\/image)?|profile\/background\/image)$/.test(pathname);
  return false;
};
const spaPaths = new Set(['/', '/sign-in', '/sign-up', '/verify-email', '/dashboard', '/meeting', '/device-test', '/test', '/meeting-history']);
const socketPaths = new Set(['/api/auth/meeting-signal/rtc', '/api/auth/meeting-signal/rtc/v1']);
const deny = (res, status = 404) => res.status(status).set('Cache-Control', 'no-store').json({ error: 'temporary_test_restricted', message: 'This action is unavailable in the temporary team test.' });

export function createTunnelTestApp(config, { mailer, meetings } = {}) {
  prepareTunnelTestDatabase(config);
  checkTunnelTestBuild(config);
  const signal = new URL(config.origin); signal.protocol = config.publicMode ? 'wss:' : 'ws:'; signal.pathname = '/api/auth/meeting-signal';
  const service = meetings || createMeetingService({ ...config.environment, NODE_ENV: 'development', MEETING_SIGNAL_URL: signal.toString() });
  assertSafe(service.configured, 'The LiveKit test service is not configured.');
  if (!meetings) service.admin = new RoomServiceClient(service.upstreamUrl.replace(/^wss:/, 'https:'),
    config.environment.LIVEKIT_API_KEY, config.environment.LIVEKIT_API_SECRET, { requestTimeout: 5, failover: false });
  const emailMailer = mailer || createVerificationMailer(config.environment);
  assertSafe(emailMailer.configured, 'The existing backend SMTP configuration is unavailable. Credentials withheld.');
  // The allowlist is immutable until restart. Removing an invitation must also
  // revoke its old sessions, tickets and pending OTP flows in this test DB.
  if (config.allowedEmails.length) {
    const db = openAuthDatabase(config.databasePath), parameters = config.allowedEmails.map(() => '?').join(',');
    try {
      db.exec('BEGIN IMMEDIATE');
      db.prepare(`UPDATE talk_meeting_connections SET revoked=1 WHERE account_id IN (SELECT id FROM accounts WHERE LOWER(COALESCE(email,'')) NOT IN (${parameters}))`).run(...config.allowedEmails);
      db.prepare(`DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE LOWER(COALESCE(email,'')) NOT IN (${parameters}))`).run(...config.allowedEmails);
      db.prepare(`DELETE FROM email_challenges WHERE LOWER(email) NOT IN (${parameters})`).run(...config.allowedEmails);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    finally { db.close(); }
  }
  const auth = createAuthApp({ origins: config.origins, secureCookies: config.secureCookies,
    trustedProxyCidrs: config.publicMode ? '127.0.0.1/32' : '', databasePath: config.databasePath,
    mailer: emailMailer, meetings: service,
    // No recording storage, recording worker, transcription worker or AI provider.
    recordings: { configured: false, reason: 'Recording and transcription are disabled for this temporary test.' },
    assistant: false,
    // Private whiteboards are not exposed in the separate public team test.
    whiteboards: false,
  });
  const app = express(); app.disable('x-powered-by'); app.set('env', 'production');
  const validRequest = req => req.headers.host === new URL(config.origin).host
    && (config.publicMode ? req.headers['x-forwarded-proto'] === 'https'
      : !req.headers['x-forwarded-proto'] && !req.headers['cf-connecting-ip']);
  app.use((req, res, next) => {
    res.set({ 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups', 'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(self), microphone=(self), display-capture=(self)' });
    if (!validRequest(req)) return deny(res, 403);
    // Only the loopback cloudflared connector is reachable. Ignore user-supplied
    // X-Forwarded-For and use the edge-overwritten Cloudflare client IP instead.
    const clientIp = req.headers['cf-connecting-ip'];
    delete req.headers['x-forwarded-for']; delete req.headers.forwarded; delete req.headers['x-forwarded-host'];
    if (config.publicMode) {
      if (typeof clientIp !== 'string' || !isIP(clientIp)) return deny(res, 403);
      req.headers['x-forwarded-for'] = clientIp;
    }
    let pathname;
    try { pathname = decodeURIComponent(req.path); } catch { return deny(res, 400); }
    if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part.startsWith('.'))) return deny(res);
    if (pathname === '/healthz' && req.method === 'GET') return res.set('Cache-Control', 'no-store').json({ ready: true, temporaryTest: true });
    if (pathname.startsWith('/api')) {
      if (!apiAllowed(req.method, pathname)) return deny(res);
      res.set('Cache-Control', 'no-store');
    }
    next();
  });
  app.post(['/api/auth/email/signup', '/api/auth/email/login', '/api/auth/email/resume'],
    express.json({ limit: '16kb' }), (req, res, next) => {
      if (config.allowedEmails.length && !config.allowedEmails.includes(typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '')) return deny(res, 403);
      next();
    });
  app.use(auth);
  app.use('/api', (_req, res) => deny(res));
  // No project-root static mount, Vite/HMR, source maps, directory listings or
  // fallback HTML for private/dev/admin paths.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return deny(res);
    const pathname = req.path;
    if (/\.map$/i.test(pathname)) return deny(res);
    if (pathname.startsWith('/assets/') || pathname.startsWith('/vendor/') || pathname.startsWith('/fonts/') || /^\/(?:favicon\.ico|favicon\.svg|robots\.txt)$/.test(pathname)) return next();
    if (spaPaths.has(pathname) || /^\/meeting-history\/[a-z\d-]+$/.test(pathname)) return res.set('Cache-Control', 'no-store').sendFile(path.join(config.frontendPath, 'index.html'));
    return deny(res);
  });
  app.use(express.static(config.frontendPath, { dotfiles: 'deny', index: false, redirect: false, fallthrough: true }));
  app.use((_req, res) => deny(res));
  app.use((_error, _req, res, _next) => deny(res, 400));
  return { app,
    attach(server) {
      server.on('upgrade', (req, socket) => {
        let pathname; try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { socket.destroy(); return; }
        if (!validRequest(req) || !socketPaths.has(pathname) || !config.origins.includes(req.headers.origin)) {
          // Prevent the existing gateway listener from handling a rejected
          // request later in this same upgrade event.
          req.url = '/__blocked_upgrade';
          socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        }
      });
      auth.locals.attachMeetingGateway(server);
    },
    close: () => auth.locals.closeAuthDatabase(),
  };
}
