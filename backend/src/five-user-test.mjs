// Explicitly launched temporary runtime. No SMTP, SMS, AI or Calendar provider.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import dotenv from 'dotenv';
import express from 'express';
import { RoomServiceClient } from 'livekit-server-sdk';
import { buildTunnelTestConfig, checkTunnelTestBuild } from './tunnel-test.mjs';
import { openAuthDatabase } from './database.mjs';
import { asyncDatabase } from './async-database.mjs';
import { createAuthApp } from './auth.mjs';
import { createMeetingService } from './meetings.mjs';
import { createEmailLinks } from './scheduling/email-links.mjs';
import { createScheduling } from './scheduling/service.mjs';
import { emailBookingSql } from './scheduling/email-outbox.mjs';
import { matchesFiveUserVerification } from './five-user-verification.mjs';

const ensure = condition => { if (!condition) throw Error('Five-user runtime security preflight failed. Private values withheld.'); };
const marker = 'Talk five-user isolated public test v1\n';
export const fiveUserSockets = new Set(['/api/auth/meeting-signal/rtc', '/api/auth/meeting-signal/rtc/v1']);
const pages = new Set(['/', '/sign-in', '/sign-up', '/verify-email', '/dashboard', '/bookings', '/meetings', '/booking-confirmation', '/device-test', '/meeting']);
const hash = value => createHash('sha256').update(value).digest('hex');
function safePath(root, target) {
  const relative = path.relative(root, target);
  ensure(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  let current = root;
  for (const part of relative.split(path.sep)) { current = path.join(current, part); if (fs.existsSync(current)) ensure(!fs.lstatSync(current).isSymbolicLink()); }
  if (fs.existsSync(target)) ensure(fs.realpathSync(target).startsWith(fs.realpathSync(root) + path.sep));
}
export function fiveUserConfiguration(root, origin, directory) {
  root = path.resolve(root);
  const test = dotenv.parse(fs.readFileSync(path.join(root, '.env.tunnel-test.local')));
  const local = dotenv.parse(fs.readFileSync(path.join(root, '.env.local')));
  // Only allowlisted test LiveKit settings are propagated, never SMTP/Firebase.
  const base = buildTunnelTestConfig(test, { root, origin });
  ensure(base.publicMode && base.allowedEmails.length === 5);
  directory = path.resolve(directory);
  ensure(path.dirname(directory) === path.join(root, 'data/five-user-public-test') && /^run-[\w-]+$/.test(path.basename(directory)));
  safePath(root, directory);
  const links = createEmailLinks({ baseUrl: base.origin, secret: local.SCHEDULING_EMAIL_LINK_SECRET });
  const config = Object.freeze({ ...base, port: 3003, directory, databasePath: path.join(directory, 'talk.sqlite'),
    frontendPath: path.join(root, 'artifacts/qa/five-user-build'),
    environment: Object.freeze(Object.fromEntries(['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'].map(k => [k, test[k]]))), links });
  checkTunnelTestBuild(config);
  for (const file of [path.join(config.frontendPath, 'index.html')]) ensure(!fs.readFileSync(file).includes(Buffer.from(local.SCHEDULING_EMAIL_LINK_SECRET)));
  // Also scan all bundled assets for the dedicated signing secret.
  function scan(folder) { for (const entry of fs.readdirSync(folder, { withFileTypes: true })) { const file = path.join(folder, entry.name); ensure(!entry.isSymbolicLink()); if (entry.isDirectory()) scan(file); else ensure(!fs.readFileSync(file).includes(Buffer.from(local.SCHEDULING_EMAIL_LINK_SECRET))); } }
  scan(config.frontendPath);
  return config;
}

export async function prepareFiveUserDatabase(config) {
  safePath(config.root, config.directory);
  ensure(!fs.existsSync(config.databasePath));
  fs.mkdirSync(config.directory, { recursive: true });
  fs.writeFileSync(path.join(config.directory, '.five-user-test'), marker, { flag: 'wx', mode: 0o600 });
  const sourcePath = path.join(config.root, 'data/tunnel-test/talk.sqlite');
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const target = openAuthDatabase(config.databasePath);
  let imported = 0, hostId, fixture;
  try {
    // Existing verified password identities only. No fabricated verification,
    // plaintext passwords, copied sessions or copied meeting/booking history.
    const rows = source.prepare("SELECT a.*,i.password_hash,i.verified_at FROM accounts a JOIN identities i ON i.account_id=a.id AND i.provider='password' WHERE a.email_verified=1 AND i.verified_at IS NOT NULL AND i.password_hash IS NOT NULL").all();
    target.exec('BEGIN IMMEDIATE');
    try {
      for (const email of config.allowedEmails) {
        const row = rows.find(r => r.email.toLowerCase() === email);
        if (!row) continue;
        const id = randomUUID(); hostId ||= id;
        target.prepare('INSERT INTO accounts(id,name,email,email_verified,created_at) VALUES (?,?,?,1,?)').run(id, row.name, email, Date.now());
        target.prepare("INSERT INTO identities(provider,provider_id,account_id,password_hash,verified_at) VALUES ('password',?,?,?,?)").run(email, id, row.password_hash, row.verified_at);
        imported++;
      }
      ensure(imported > 0); target.exec('COMMIT');
    } catch (error) { target.exec('ROLLBACK'); throw error; }
    const db = asyncDatabase(target), service = createScheduling({ db, links: config.links, now: Date.now });
    await db.withContext(async () => {
      await service.saveProfile(hostId, { slug: 'five-user-test', timezone: 'Asia/Kolkata', settings: { notice: 0 }, windows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: 0, end: 1440 })) });
      const { event } = await service.createEvent(hostId, { slug: 'synthetic-test', title: 'Talk Five-User Synthetic Booking', duration: 30, capacity: 5 });
      const start = Math.ceil((Date.now() + 2 * 3600000) / 900000) * 900000;
      const slots = await service.slots(event.id, { from: start, to: start + 86400000, timezone: 'Asia/Kolkata' });
      ensure(slots.slots.length > 0);
      const guest = config.allowedEmails.find(email => email !== target.prepare('SELECT email FROM accounts WHERE id=?').get(hostId).email);
      const result = await service.book(event.id, { start: slots.slots[0].start, name: 'Synthetic Five-User Invitee', email: guest, timezone: 'Asia/Kolkata', credential: randomBytes(32).toString('base64url'), answers: {} });
      await service.run("UPDATE scheduling_jobs SET status='cancelled',error_code='five_user_delivery_disabled',lease_until=NULL");
      fixture = { bookingId: result.booking.id, bookingMeetingId: result.booking.meetingId };
    });
    // A separate immediately joinable synthetic meeting; no SFU room is created.
    const meetingId = 'm-' + randomUUID(), now = Date.now(), name = target.prepare('SELECT name FROM accounts WHERE id=?').get(hostId).name;
    target.prepare('INSERT INTO talk_meetings(id,title,room_name,owner_account_id,created_at,approval_required) VALUES (?,?,?,?,?,1)').run(meetingId, 'Talk Five-User Public Test', 'talk-' + randomUUID(), hostId, now);
    target.prepare("INSERT INTO talk_meeting_members(meeting_id,account_id,role,admission,display_name,updated_at) VALUES (?,?,'host','admitted',?,?)").run(meetingId, hostId, name, now);
    const booking = target.prepare(emailBookingSql).get(fixture.bookingId);
    fs.writeFileSync(path.join(config.directory, 'host-account.private.json'), JSON.stringify(target.prepare('SELECT id,name,email FROM accounts WHERE id=?').get(hostId)), { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(path.join(config.directory, 'confirmation-link.private.json'), JSON.stringify({ bookingId: booking.id, joiningUrl: config.links.inviteeUrl(booking) }), { flag: 'wx', mode: 0o600 });
    return { importedVerifiedAccounts: imported, verificationRequiredAccounts: 5 - imported, hostId, meetingId, ...fixture };
  } finally { source.close(); target.close(); }
}

export function fiveUserApiAllowed(method, pathname) {
  if (method === 'GET') return /^\/api\/auth\/(?:config|session|email\/(?:config|verification)|phone\/config|meeting-history|meetings\/[a-z\d-]+(?:\/(?:state|recording-state))?|profile\/background|avatars\/[a-z\d_-]+\/image|scheduling\/(?:form|dashboard|email-deliveries|analytics|google-calendar|public\/[a-z\d-]+\/[a-z\d-]+|host-booking\/[a-z\d-]+|events\/[a-z\d-]+\/slots|guest\/meetings\/[a-z\d-]+(?:\/state)?))$/.test(pathname);
  if (method === 'POST') return /^\/api\/auth\/(?:email\/(?:login|resume|signup|verify|resend)|logout|meetings(?:\/[a-z\d-]+\/(?:create|token|actions))?|scheduling\/(?:profile|events|parse|events\/[a-z\d-]+\/(?:manage|book)|host-booking\/[a-z\d-]+\/change|booking\/[a-z\d-]+\/(?:detail|calendar|code|redeem)|guest\/meetings\/[a-z\d-]+\/(?:token|actions)))$/.test(pathname);
  return false;
}
export function createFiveUserApp(config, { meetings, verificationMailer } = {}) {
  ensure(config.port === 3003 && config.host === '127.0.0.1' && config.allowedEmails.length === 5);
  ensure(fs.readFileSync(path.join(config.directory, '.five-user-test'), 'utf8') === marker);
  safePath(config.root, config.databasePath);
  const signal = new URL('/api/auth/meeting-signal', config.origin); signal.protocol = 'wss:';
  const service = meetings || createMeetingService({ ...config.environment, NODE_ENV: 'production', MEETING_SIGNAL_URL: signal.href });
  ensure(service.configured);
  ensure(!verificationMailer || matchesFiveUserVerification(verificationMailer, config));
  if (!meetings) service.admin = new RoomServiceClient(service.upstreamUrl.replace(/^wss:/, 'https:'), config.environment.LIVEKIT_API_KEY, config.environment.LIVEKIT_API_SECRET, { requestTimeout: 5, failover: false });
  const auth = createAuthApp({ origins: [config.origin], secureCookies: true, trustedProxyCidrs: '127.0.0.1/32', databasePath: config.databasePath,
    mailer: verificationMailer || { configured: false }, meetings: service, scheduling: { transport: null, links: config.links, calendar: {} },
    recordings: { configured: false }, assistant: false, whiteboards: false, whiteboardIntelligence: false });
  const read = new DatabaseSync(config.databasePath, { readOnly: true });
  const app = express(); app.disable('x-powered-by'); app.set('env', 'production');
  const deny = (res, status = 404) => res.status(status).set('Cache-Control', 'no-store').json({ error: 'five_user_test_restricted', message: 'This action is unavailable in the temporary five-user test.' });
  const valid = req => req.headers.host === new URL(config.origin).host && req.headers['x-forwarded-proto'] === 'https' && isIP(String(req.headers['cf-connecting-ip'] || ''));
  const cookies = req => { req.headers.cookie = String(req.headers.cookie || '').split(';').map(v => v.trim()).filter(v => /^fiveuser_talk_[a-z_]+=/.test(v)).map(v => v.replace(/^fiveuser_/, '')).join('; '); };
  const sessionFor = req => {
    const tokens = String(req.headers.cookie || '').split(';').map(v => v.trim()).filter(v => v.startsWith('talk_session='));
    if (tokens.length !== 1) return null;
    return read.prepare('SELECT a.email,a.email_verified FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>? AND s.requires_confirmation=0').get(hash(tokens[0].slice(13)), Date.now());
  };
  const allowedSession = req => { const session = sessionFor(req); return !session || session.email_verified === 1 && config.allowedEmails.includes(session.email.toLowerCase()); };
  app.use((req, res, next) => {
    res.set({ 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups', 'Cross-Origin-Resource-Policy': 'same-origin', 'Permissions-Policy': 'camera=(self), microphone=(self), display-capture=(self)' });
    if (!valid(req)) return deny(res, 403);
    const ip = req.headers['cf-connecting-ip']; delete req.headers['x-forwarded-for']; delete req.headers.forwarded; delete req.headers['x-forwarded-host']; req.headers['x-forwarded-for'] = ip;
    cookies(req); if (!allowedSession(req)) return deny(res, 403);
    const set = res.setHeader.bind(res); res.setHeader = (name, value) => set(name, name.toLowerCase() === 'set-cookie' ? (Array.isArray(value) ? value : [value]).map(v => String(v).replace(/^(talk_[a-z_]+)=/, 'fiveuser_$1=')) : value);
    let pathname; try { pathname = decodeURIComponent(req.path); } catch { return deny(res, 400); }
    if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(p => p.startsWith('.'))) return deny(res);
    if (pathname === '/healthz' && req.method === 'GET') return res.set('Cache-Control', 'no-store').json({ ready: true, fiveUserTest: true, allowlistCount: 5, smtp: false, otp: false, sms: false, recording: false, transcription: false, gemini: false, calendar: false });
    if (pathname.startsWith('/api')) { if (!fiveUserApiAllowed(req.method, pathname)) return deny(res); res.set('Cache-Control', 'no-store'); }
    next();
  });
  app.post(['/api/auth/email/login', '/api/auth/email/resume', '/api/auth/email/signup'], express.json({ limit: '16kb' }), (req, res, next) => {
    if (!config.allowedEmails.includes(typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '')) return deny(res, 403);
    if (req.path.endsWith('/signup') && verificationMailer && !verificationMailer.permitsSignup(req.body.email)) return deny(res, 403);
    next();
  });
  // A meeting owner cannot disable admission in the public test.
  app.post(/^\/api\/auth\/meetings(?:\/[a-z\d-]+\/create)?$/, express.json({ limit: '16kb' }), (req, _res, next) => { req.body.approvalRequired = true; next(); });
  app.post(/^\/api\/auth\/meetings\/[a-z\d-]+\/actions$/, express.json({ limit: '16kb' }), (req, res, next) => { if (req.body?.action === 'approval_off') return deny(res, 403); next(); });
  app.use('/api/auth/scheduling/public', (req, res, next) => sessionFor(req) ? next() : deny(res, 401));
  app.post(/^\/api\/auth\/scheduling\/events\/[a-z\d-]+\/book$/, express.json({ limit: '32kb' }), (req, res, next) => {
    const session = sessionFor(req);
    if (!session) return deny(res, 401);
    if (typeof req.body?.email !== 'string' || req.body.email.trim().toLowerCase() !== session.email.toLowerCase()) return deny(res, 403);
    next();
  });
  app.use(auth); app.use('/api', (_req, res) => deny(res));
  app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return deny(res);
    if (/\.map$/i.test(req.path)) return deny(res);
    if (req.path.startsWith('/assets/') || req.path.startsWith('/vendor/') || req.path.startsWith('/fonts/') || /^\/favicon\.(?:ico|svg)$/.test(req.path)) return next();
    if (pages.has(req.path) || /^\/booking\/[a-z\d-]+\/[a-z\d-]+$/.test(req.path)) return res.set('Cache-Control', 'no-store').sendFile(path.join(config.frontendPath, 'index.html'));
    return deny(res);
  });
  app.use(express.static(config.frontendPath, { dotfiles: 'deny', index: false, redirect: false }));
  app.use((_req, res) => deny(res)); app.use((_error, _req, res, _next) => deny(res, 400));
  return { app, auth, service, attach(server) {
    server.on('upgrade', (req, socket) => {
      let pathname; try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { socket.destroy(); return; }
      cookies(req);
      if (!valid(req) || !fiveUserSockets.has(pathname) || req.headers.origin !== config.origin || !allowedSession(req)) { req.url = '/__blocked_upgrade'; socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); }
    }); auth.locals.attachMeetingGateway(server);
  }, close: async () => { await auth.locals.closeAuthDatabase(); read.close(); } };
}
