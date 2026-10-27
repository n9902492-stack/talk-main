import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { schedulingHarness } from './helpers/scheduling.mjs';
import { openAuthDatabase } from '../backend/src/database.mjs';
import { secret } from '../backend/src/scheduling/service.mjs';
import { createEmailLinks } from '../backend/src/scheduling/email-links.mjs';
import { createSchedulingJobs } from '../backend/src/scheduling/jobs.mjs';
import {SchedulingDeliveryError} from '../backend/src/scheduling/delivery-diagnostics.mjs';

const fixedNow = Date.parse('2026-10-26T00:00:00Z');
const start = Date.parse('2026-10-27T10:00:00Z');
const stableLinks = () => createEmailLinks({ baseUrl: 'http://localhost:3001', secret: Buffer.alloc(32, 7).toString('base64url') });
const credentialFrom = message => new URL(message.text.match(/View booking and join: (\S+)/)[1]).hash.slice(1);

async function setup(t, { database } = {}) {
  const h = await schedulingHarness({ database });
  h.advance(fixedNow - h.now());
  h.transport.links = stableLinks();
  if (t) t.after(h.close);
  const host = await h.account(`email-host-${randomUUID()}`);
  const saved = await host.request('scheduling/profile', {
    slug: `email-host-${randomUUID()}`, timezone: 'Asia/Kolkata', settings: { notice: 0 },
    windows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: 0, end: 1440 })),
  });
  assert.equal(saved.status, 200);
  const created = await host.request('scheduling/events', { title: 'Synthetic email appointment', slug: 'consult', duration: 30, capacity: 1, questions: [] });
  assert.equal(created.status, 201);
  const guest = h.client();
  async function request(route, body) {
    const form = (await guest.request('scheduling/form')).body.formToken;
    return guest.request(`scheduling/${route}`, body, { 'X-Scheduling-Token': form });
  }
  const body = { start, name: 'Fictional Invitee', email: 'invitee@example.invalid', timezone: 'America/New_York', credential: secret(), answers: {} };
  const result = await request(`events/${created.body.event.id}/book`, body);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return { h, host, guest, request, body, event: created.body.event, booking: result.body.booking };
}

test('both recipients get private confirmation links; emailed guest link proves email and waits for admission', async t => {
  const { h, host, guest, request, body, booking, event } = await setup(t);
  await h.app.locals.schedulingJobs.tick();
  assert.equal(h.outbox.length, 2);
  const invitee = h.outbox.find(message => message.to === body.email);
  const owner = h.outbox.find(message => message.to !== body.email);
  assert.ok(invitee);
  assert.ok(owner);
  assert.match(invitee.subject, /Booking confirmed/);
  assert.match(owner.text, /Open host meeting:/);
  assert.match(owner.text, new RegExp(booking.meetingId));
  assert.ok(!owner.text.includes('booking-confirmation'));assert.equal(new URL(owner.text.match(/Open host meeting: (\S+)/)[1]).hash,'');
  assert.match(invitee.text, /Asia\/Kolkata/);
  assert.match(invitee.text, /America\/New_York/);
  const emailedCredential = credentialFrom(invitee);
  assert.notEqual(emailedCredential, body.credential);
  assert.equal((await request(`booking/${booking.id}/detail`, { credential: emailedCredential })).status, 200);
  const second = await request(`events/${event.id}/book`, { ...body, start: start + 3_600_000, credential: secret() });
  assert.equal(second.status, 201);
  await h.app.locals.schedulingJobs.tick();
  const otherInvitee = h.outbox.filter(message => message.to === body.email)[1];
  assert.notEqual(credentialFrom(otherInvitee), emailedCredential);
  assert.equal((await request(`booking/${second.body.booking.id}/detail`, { credential: emailedCredential })).status, 404);
  h.advance(start - h.now() - 14 * 60_000);
  assert.equal((await request(`booking/${booking.id}/code`, { credential: emailedCredential })).status, 200);
  assert.equal(h.codes.length, 1);
  const redeemed = await request(`booking/${booking.id}/redeem`, { credential: emailedCredential, code: h.codes[0].code });
  assert.equal(redeemed.status, 200);
  guest.setCsrf(redeemed.body.csrfToken);
  const waiting = await guest.request(`scheduling/guest/meetings/${booking.meetingId}/token`, { displayName: body.name });
  assert.equal(waiting.status, 202);
  assert.equal(waiting.body.joinState, 'waiting');
  assert.equal(waiting.body.token, undefined);
  assert.equal((await guest.request('scheduling/dashboard')).status, 401);
  assert.equal(h.raw.prepare('SELECT COUNT(*) AS count FROM accounts').get().count, 1);
  assert.ok(host.id);
});

test('durable jobs send meeting-day reminders in each recipient timezone and shared15-minute reminders', async t => {
  const { h, booking } = await setup(t);
  const jobs = h.raw.prepare('SELECT * FROM scheduling_jobs WHERE booking_id=? ORDER BY kind').all(booking.id);
  assert.equal(jobs.length, 6);
  for (const recipient of ['host', 'invitee']) {
    const day = jobs.find(job => job.kind === `reminder_day:${recipient}`);
    const fifteen = jobs.find(job => job.kind === `reminder_15:${recipient}`);
    assert.equal(day.due_at, Date.parse(recipient === 'host' ? '2026-10-27T03:30:00Z' : '2026-10-27T04:00:00Z'));
    assert.equal(day.expires_at, start - 15 * 60_000);
    assert.equal(fifteen.due_at, start - 15 * 60_000);
    assert.equal(fifteen.expires_at, start);
  }
  await h.app.locals.schedulingJobs.tick();
  assert.equal(h.outbox.length, 2);
  h.advance(Date.parse('2026-10-27T03:30:00Z') - h.now() - 1);
  await h.app.locals.schedulingJobs.tick();
  assert.equal(h.outbox.length, 2);
  h.advance(1);
  await h.app.locals.schedulingJobs.tick();
  assert.equal(h.outbox.filter(message => message.subject.includes('Meeting today')).length, 1);
  assert.equal(h.outbox.length, 3);
  assert.notEqual(h.outbox.at(-1).to, 'invitee@example.invalid');
  h.advance(Date.parse('2026-10-27T04:00:00Z') - h.now());
  await h.app.locals.schedulingJobs.tick();
  assert.equal(h.outbox.filter(message => message.subject.includes('Meeting today')).length, 2);
  assert.equal(h.outbox.at(-1).to, 'invitee@example.invalid');
  h.advance(start - 15 * 60_000 - h.now());
  await h.app.locals.schedulingJobs.tick();
  assert.equal(h.outbox.filter(message => message.subject.includes('Meeting reminder')).length, 2);
  await h.app.locals.schedulingJobs.tick();
  assert.equal(h.outbox.length, 6);
});

test('rescheduling and email-link cancellation revoke old jobs and notify both roles with updated ICS', async t => {
  const { h, request, booking } = await setup(t);
  await h.app.locals.schedulingJobs.tick();
  const oldCredential = credentialFrom(h.outbox.find(message => message.to === 'invitee@example.invalid'));
  const moved = await request(`booking/${booking.id}/change`, { action: 'reschedule', version: 1, credential: oldCredential, newCredential: secret(), start: start + 86_400_000 });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(moved.body.booking.version, 2);
  assert.equal((await request(`booking/${booking.id}/detail`, { credential: oldCredential })).status, 404);
  assert.equal(h.raw.prepare("SELECT COUNT(*) AS count FROM scheduling_jobs WHERE booking_id=? AND booking_version=1 AND status IN ('queued','sending')").get(booking.id).count, 0);
  await h.app.locals.schedulingJobs.tick();
  const movedMessages = h.outbox.filter(message => message.subject.includes('Booking rescheduled'));
  assert.equal(movedMessages.length, 2);
  for (const message of movedMessages) assert.match(message.calendar, /SEQUENCE:2/);
  const nextCredential = credentialFrom(movedMessages.find(message => message.to === 'invitee@example.invalid'));
  const cancelled = await request(`booking/${booking.id}/change`, { action: 'cancel', version: 2, credential: nextCredential });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.booking.status, 'cancelled');
  assert.equal((await request(`booking/${booking.id}/detail`, { credential: nextCredential })).status, 404);
  assert.equal(h.raw.prepare("SELECT COUNT(*) AS count FROM scheduling_jobs WHERE booking_id=? AND status='queued' AND kind NOT LIKE 'cancellation:%'").get(booking.id).count, 0);
  await h.app.locals.schedulingJobs.tick();
  const cancelledMessages = h.outbox.filter(message => message.subject.includes('Booking cancelled'));
  assert.equal(cancelledMessages.length, 2);
  for (const message of cancelledMessages) {
    assert.match(message.calendar, /METHOD:CANCEL/);
    assert.match(message.calendar, /STATUS:CANCELLED/);
    assert.ok(!message.html.includes('href='));
  }
  h.advance(start + 2 * 86_400_000 - h.now());
  await h.app.locals.schedulingJobs.tick();
  assert.equal(h.outbox.length, 6);
});

test('SQLite reopen recovers stale leases, preserves signed links and never resends completed jobs', async t => {
  const folder = mkdtempSync(path.resolve('artifacts/qa/scheduling-email-restart-'));
  const filename = path.join(folder, 'test.sqlite');
  let raw = openAuthDatabase(filename);
  let fixture = await setup(null, { database: raw });
  let h = fixture.h;
  t.after(async () => { if (h) await h.close(); if (raw) raw.close(); });
  const booking = fixture.booking;
  const expectedLink = h.transport.links.inviteeUrl({ ...booking, version: 1, meeting_id: booking.meetingId });
  raw.prepare("UPDATE scheduling_jobs SET status='sending',worker_id='stopped-process',lease_until=0,attempts=1 WHERE booking_id=? AND kind='confirmation:invitee'").run(booking.id);
  await h.close(); h = null; raw.close(); raw = null;
  raw = openAuthDatabase(filename);
  h = await schedulingHarness({ database: raw });
  h.advance(fixedNow - h.now());
  h.transport.links = stableLinks();
  await h.app.locals.schedulingJobs.tick();
  assert.equal(h.outbox.length, 1);
  assert.equal(h.outbox.some(message => message.to === 'invitee@example.invalid'),false);
  assert.equal(raw.prepare("SELECT attempts FROM scheduling_jobs WHERE booking_id=? AND kind='confirmation:invitee'").get(booking.id).attempts, 1);
  assert.equal(raw.prepare("SELECT delivery_outcome FROM scheduling_jobs WHERE booking_id=? AND kind='confirmation:invitee'").get(booking.id).delivery_outcome,'UNKNOWN_AMBIGUOUS');
  const service=h.app.locals.scheduling;assert.equal((await service.db.withContext(()=>service.detail(booking.id,new URL(expectedLink).hash.slice(1)))).booking.id,booking.id);
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM scheduling_jobs WHERE booking_id=? AND status='sent'").get(booking.id).count, 1);
  await h.app.locals.schedulingJobs.tick();
  assert.equal(h.outbox.length, 1);
  h.advance(Date.parse('2026-10-27T03:30:00Z') - h.now());
  await h.app.locals.schedulingJobs.tick();
  assert.equal(h.outbox.length, 2);
  assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM scheduling_bookings').get().count, 1);
});

test('independent workers claim durable jobs without duplicate mock deliveries', async t => {
  const { h } = await setup(t);
  const captured = [];
  let releaseFirst;
  const gate = new Promise(resolve => { releaseFirst = resolve; });
  let reportFirst;
  const firstStarted = new Promise(resolve => { reportFirst = resolve; });
  h.transport.send = async message => {
    captured.push(message);
    if (captured.length === 1) { reportFirst(); await gate; }
    return {accepted:true,smtpCode:250};
  };
  const other = createSchedulingJobs(h.app.locals.scheduling);
  const firstRun = h.app.locals.schedulingJobs.tick();
  await firstStarted;
  try { await other.tick(); } finally { releaseFirst(); }
  await firstRun;
  assert.equal(captured.length, 2);
  assert.equal(new Set(captured.map(message => message.jobId)).size, 2);
  assert.equal(h.raw.prepare("SELECT COUNT(*) AS count FROM scheduling_jobs WHERE status='sent'").get().count, 2);
});

test('failed SMTP attempts persist across SQLite reopen and retry without exposing delivery errors', async t => {
  const folder = mkdtempSync(path.resolve('artifacts/qa/scheduling-email-retry-'));
  const filename = path.join(folder, 'test.sqlite');
  let raw = openAuthDatabase(filename);
  let fixture = await setup(null, { database: raw });
  let h = fixture.h;
  t.after(async () => { if (h) await h.close(); if (raw) raw.close(); });
  let failed = false;
  h.transport.send = async message => {
    if (!failed) { failed = true; throw new SchedulingDeliveryError({outcome:'CONFIRMED_NOT_SUBMITTED',phase:'TIMED_OUT',errorCategory:'timeout',retryable:true}); }
    h.outbox.push(message);
    return {accepted:true,smtpCode:250};
  };
  await h.app.locals.schedulingJobs.tick();
  assert.equal(h.outbox.length, 1);
  const retry = raw.prepare("SELECT * FROM scheduling_jobs WHERE status='queued' AND error_code='delivery_failed'").get();
  assert.ok(retry);
  assert.equal(retry.attempts, 1);
  assert.ok(!JSON.stringify(retry).includes('Private SMTP'));
  await h.close(); h = null; raw.close(); raw = null;
  raw = openAuthDatabase(filename);
  h = await schedulingHarness({ database: raw });
  h.advance(fixedNow + 61_000 - h.now());
  h.transport.links = stableLinks();
  await h.app.locals.schedulingJobs.tick();
  assert.equal(h.outbox.length, 1);
  assert.equal(h.outbox[0].jobId, retry.id);
  assert.equal(raw.prepare('SELECT status,attempts FROM scheduling_jobs WHERE id=?').get(retry.id).status, 'sent');
  assert.equal(raw.prepare('SELECT status,attempts FROM scheduling_jobs WHERE id=?').get(retry.id).attempts, 2);
});

test('expired reminders are cancelled rather than sent after the appointment starts', async t => {
  const { h, booking } = await setup(t);
  await h.app.locals.schedulingJobs.tick();
  h.advance(start - h.now());
  await h.app.locals.schedulingJobs.tick();
  assert.equal(h.outbox.length, 2);
  const reminders = h.raw.prepare("SELECT status,error_code FROM scheduling_jobs WHERE booking_id=? AND kind LIKE 'reminder_%'").all(booking.id);
  assert.equal(reminders.length, 4);
  for (const reminder of reminders) {
    assert.equal(reminder.status, 'cancelled');
    assert.equal(reminder.error_code, 'obsolete_or_expired');
  }
});

test('legacy queued confirmation and reminder jobs are replaced by role-specific jobs once', async t => {
  const { h, booking } = await setup(t);
  h.raw.prepare('DELETE FROM scheduling_jobs WHERE booking_id=?').run(booking.id);
  for (const kind of ['confirmation', 'reminder']) {
    h.raw.prepare("INSERT INTO scheduling_jobs(id,booking_id,booking_version,kind,due_at,status) VALUES (?,?,?,?,?,'queued')")
      .run(randomUUID(), booking.id, 1, kind, h.now());
  }
  await h.app.locals.schedulingJobs.tick();
  const legacy = h.raw.prepare("SELECT kind,status,error_code FROM scheduling_jobs WHERE booking_id=? AND kind IN ('confirmation','reminder')").all(booking.id);
  assert.equal(legacy.length, 2);
  for (const old of legacy) {
    assert.equal(old.status, 'cancelled');
    assert.equal(old.error_code, 'legacy_replaced');
  }
  assert.equal(h.raw.prepare("SELECT COUNT(*) AS count FROM scheduling_jobs WHERE booking_id=? AND kind LIKE '%:%'").get(booking.id).count, 6);
  assert.equal(h.outbox.length, 2);
  assert.equal(h.outbox.filter(message => message.to === 'invitee@example.invalid').length, 1);
  assert.equal(h.outbox.filter(message => message.to !== 'invitee@example.invalid').length, 1);
  await h.app.locals.schedulingJobs.tick();
  assert.equal(h.outbox.length, 2);
});

test('previously sent legacy mail history is preserved while missing host mail and future reminders recover', async t => {
  const { h, booking } = await setup(t);
  h.raw.prepare('DELETE FROM scheduling_jobs WHERE booking_id=?').run(booking.id);
  for (const kind of ['confirmation', 'reminder']) {
    h.raw.prepare("INSERT INTO scheduling_jobs(id,booking_id,booking_version,kind,due_at,status,attempts) VALUES (?,?,?,?,?,'sent',1)")
      .run(randomUUID(), booking.id, 1, kind, h.now());
  }
  await h.app.locals.schedulingJobs.tick();
  assert.equal(h.outbox.length, 1);
  assert.notEqual(h.outbox[0].to, 'invitee@example.invalid');
  assert.match(h.outbox[0].subject, /Booking confirmed/);
  assert.equal(h.raw.prepare("SELECT COUNT(*) AS count FROM scheduling_jobs WHERE booking_id=? AND kind IN ('confirmation','reminder') AND status='sent'").get(booking.id).count, 2);
  assert.equal(h.raw.prepare("SELECT COUNT(*) AS count FROM scheduling_jobs WHERE booking_id=? AND kind LIKE 'reminder_%:%' AND status='queued'").get(booking.id).count, 4);
  assert.equal(h.raw.prepare("SELECT COUNT(*) AS count FROM scheduling_jobs WHERE booking_id=? AND kind='confirmation:invitee'").get(booking.id).count, 0);
  assert.equal(h.raw.prepare("SELECT COUNT(*) AS count FROM scheduling_jobs WHERE booking_id=? AND kind='confirmation:host' AND status='sent'").get(booking.id).count, 1);
  await h.app.locals.schedulingJobs.tick();
  assert.equal(h.outbox.length, 1);
  assert.equal(h.raw.prepare("SELECT COUNT(*) AS count FROM scheduling_jobs WHERE booking_id=? AND kind IN ('confirmation','reminder') AND status='sent'").get(booking.id).count, 2);
});
