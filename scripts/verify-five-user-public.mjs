// Existing approved origin only; no sends, OTPs, account creation or room creation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fiveUserConfiguration } from '../backend/src/five-user-test.mjs';
import { emailBookingSql } from '../backend/src/scheduling/email-outbox.mjs';
const launch = JSON.parse(fs.readFileSync('artifacts/qa/five-user-public-launch.json'));
const server = JSON.parse(fs.readFileSync(launch.serverState)), connector = JSON.parse(fs.readFileSync(launch.connectorState));
const report = { passed: false, checkedAt: new Date().toISOString(), checks: [], emailsSent: 0, otpSent: 0, cloudMedia: 'NOT_TESTED', externalDevices: 'NOT_TESTED' };
let step = 'runtime identity';
try {
  assert.equal(server.status, 'READY'); assert.equal(connector.connected, true); assert.equal(connector.running, true);
  assert.notEqual(server.serverPid, connector.controllerPid); assert.notEqual(server.serverPid, connector.connectorPid);
  assert.equal(server.origin, connector.origin); assert.equal(server.launchId, launch.id); assert.equal(connector.launchId, launch.id);
  const config = fiveUserConfiguration(launch.root, server.origin, launch.directory); report.origin = config.origin;
  const call = async (p, body, headers = {}) => { const r = await fetch(config.origin + p, { redirect: 'manual', signal: AbortSignal.timeout(15000), method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { Origin: config.origin, 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); const text = await r.text(); let data; try { data = JSON.parse(text); } catch {} return { status: r.status, text, data, headers: r.headers }; };
  step = 'HTTPS health'; const health = await call('/healthz'); assert.equal(health.status, 200); assert.equal(health.data.fiveUserTest, true);
  for (const flag of ['smtp', 'otp', 'sms', 'recording', 'transcription', 'gemini', 'calendar']) assert.equal(health.data[flag], false);
  report.checks.push('New HTTPS origin and independently managed isolated runtime are healthy; external delivery features disabled');
  step = 'page routes';
  for (const p of ['/sign-in', '/sign-up', '/verify-email', '/dashboard', '/bookings', '/meetings', '/booking-confirmation', '/device-test', '/meeting']) { const r = await call(p); assert.equal(r.status, 200); assert.match(r.text, /<div id="root">/); }
  report.checks.push('Approved frontend routes serve the existing Talk application through HTTPS');
  step = 'private routes';
  for (const p of ['/analytics', '/recordings', '/whiteboards', '/.env.local', '/backend/src/auth.mjs', '/api/auth/admin', '/api/auth/whiteboards', '/api/auth/recordings/private', '/api/auth/scheduling/google-calendar/callback']) assert.equal((await call(p)).status, 404);
  assert.equal((await call('/api/auth/scheduling/dashboard')).status, 401);
  const cfg = await call('/api/auth/config'); assert.equal(cfg.status, 200); assert.equal(cfg.data.configured, false);
  assert.ok(cfg.headers.getSetCookie().every(v => /^fiveuser_talk_/.test(v) && /; Secure/.test(v) && /; HttpOnly/.test(v) && /SameSite=Lax/.test(v)));
  assert.equal((await call('/api/auth/email/login', { email: 'not-allowed@example.invalid', password: 'Not-A-Real-Account' })).status, 403);
  assert.equal((await call('/api/auth/email/login', { email: 'not-allowed@example.invalid', password: 'Not-A-Real-Account' }, { Origin: 'https://outside.example' })).status, 403);
  report.checks.push('Private APIs blocked, anonymous scheduling denied, non-allowlisted identity rejected, Secure/HttpOnly namespaced cookies present');
  step = 'private signed confirmation and ICS';
  const privateLink = JSON.parse(fs.readFileSync(path.join(launch.directory, 'confirmation-link.private.json'))).joiningUrl;
  assert.equal(new URL(privateLink).origin, config.origin);
  const credential = new URL(privateLink).hash.slice(1), form = await call('/api/auth/scheduling/form'), headers = { 'X-Scheduling-Token': form.data.formToken }, base = '/api/auth/scheduling/booking/' + launch.bookingId;
  const detail = await call(base + '/detail', { credential }, headers); assert.equal(detail.status, 200); assert.equal(detail.data.booking.id, launch.bookingId); assert.equal(detail.data.booking.event.emailEnabled, false);
  const ics = await call(base + '/calendar', { credential }, headers); assert.equal(ics.status, 200); assert.match(ics.text, /BEGIN:VCALENDAR/);
  const db = new DatabaseSync(launch.databasePath, { readOnly: true });
  try {
    const b = db.prepare(emailBookingSql).get(launch.bookingId); assert.equal(config.links.verify(b, credential, Date.now()), true);
    for (const key of ['starts_at', 'ends_at']) { const stamp = new Date(b[key]).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); assert.ok(ics.text.includes(stamp)); }
    assert.equal((await call(base + '/detail', { credential: credential.slice(0, -1) + (credential.endsWith('A') ? 'B' : 'A') }, headers)).status, 404);
    assert.equal((await call('/api/auth/scheduling/booking/' + randomUUID() + '/detail', { credential }, headers)).status, 404);
    const stale = new URL(config.links.inviteeUrl({ ...b, version: b.version - 1 })).hash.slice(1);
    assert.equal((await call(base + '/detail', { credential: stale }, headers)).status, 404);
    assert.equal((await call(base + '/detail', { credential })).status, 403);
    assert.equal((await call(base + '/detail', { credential }, { ...headers, Origin: 'https://outside.example' })).status, 403);
    assert.equal((await call(base + '/code', { credential }, headers)).status, 503);
    assert.equal((await call('/api/auth/scheduling/guest/meetings/' + b.meeting_id + '/token', { displayName: 'Unverified' })).status, 401);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM scheduling_email_attempts').get().n, 0);
    report.syntheticBooking = { start: new Date(b.starts_at).toISOString(), end: new Date(b.ends_at).toISOString(), timezone: b.timezone, expiry: new Date(b.ends_at + 3600000).toISOString() };
  } finally { db.close(); }
  report.checks.push('HTTPS signed confirmation and matching ICS verified; tampered/stale/cross-booking links, missing CSRF and wrong Origin rejected; guest OTP remains disabled');
  step = 'preservation';
  for (const [p, digest] of Object.entries(launch.preserved)) assert.equal(createHash('sha256').update(fs.readFileSync(p)).digest('hex'), digest);
  report.checks.push('Existing environment, original test database and SMTP send guards/results remain byte-for-byte unchanged');
  report.importedVerifiedAccounts = launch.importedVerifiedAccounts; report.verificationRequiredAccounts = launch.verificationRequiredAccounts;
  report.serverPid = server.serverPid; report.connectorPid = connector.connectorPid; report.connectorControllerPid = connector.controllerPid;
  report.meetingUrl = config.origin + '/device-test?room=' + launch.meetingId;
  report.passed = true; console.log(JSON.stringify(report, null, 2));
} catch { report.failedAt = step; console.error('Public verification stopped at ' + step + '. Private credentials withheld; no email sent.'); process.exitCode = 1; }
fs.writeFileSync('artifacts/qa/five-user-public-https.json', JSON.stringify(report, null, 2));
