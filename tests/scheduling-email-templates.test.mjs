import test from 'node:test';
import assert from 'node:assert/strict';
import { plannedReminders } from '../backend/src/scheduling/email-schedule.mjs';
import { renderSchedulingEmail } from '../backend/src/scheduling/email-templates.mjs';

const time = value => Date.parse(value);
const booking = {
  id: 'booking-test', name: 'Fictional Guest', email: 'guest@example.invalid',
  timezone: 'Asia/Kolkata', starts_at: time('2026-10-26T14:00:00Z'),
  ends_at: time('2026-10-26T14:30:00Z'), title: 'Design review', version: 1,
  answers: { confidential: 'MUST NEVER LEAK' },
};
const host = { name: 'Fictional Host', email: 'host@example.invalid', timezone: 'UTC' };
const urls = { inviteeUrl: 'https://talk.example/booking/confirmation/booking-test#private-guest-link', hostUrl: 'https://talk.example/meeting/host-only' };

test('confirmation and reminder templates distinguish recipients and keep role-specific links', () => {
  for (const kind of ['confirmation', 'rescheduled', 'reminder_day', 'reminder_15']) {
    const guestMail = renderSchedulingEmail({ kind, recipient: 'invitee', b: booking, host, ...urls });
    const hostMail = renderSchedulingEmail({ kind, recipient: 'host', b: booking, host, ...urls });
    assert.match(guestMail.text, /Hi Fictional Guest/);
    assert.match(hostMail.text, /Hi Fictional Host/);
    assert.ok(guestMail.text.includes(urls.inviteeUrl));
    assert.ok(!guestMail.text.includes(urls.hostUrl));
    assert.ok(hostMail.text.includes(urls.hostUrl));
    assert.ok(!hostMail.text.includes(urls.inviteeUrl));
    assert.match(guestMail.text, /Asia\/Kolkata/);
    assert.match(guestMail.text, /UTC/);
    assert.match(guestMail.text, /Duration: 30 minutes/);
    assert.match(hostMail.text, /Duration: 30 minutes/);
    assert.match(guestMail.text, /Add to calendar: Open the attached talk-booking\.ics/);
    assert.match(hostMail.text, /Add to calendar: Open the attached talk-booking\.ics/);
    assert.ok(!JSON.stringify(guestMail).includes('MUST NEVER LEAK'));
    assert.match(hostMail.text, /Sign in with your existing Talk host account/);
    assert.match(guestMail.text, /verify your email/);
  }
});

test('reschedule and cancellation links keep guest credentials scoped and host actions authenticated', () => {
  for (const recipient of ['invitee', 'host']) {
    const rendered = renderSchedulingEmail({ kind: 'confirmation', recipient, b: booking, host, ...urls });
    for (const [label, action] of [['Reschedule meeting', 'reschedule'], ['Cancel booking', 'cancel']]) {
      const raw = rendered.text.match(new RegExp(`${label}: (\\S+)`))[1];
      const url = new URL(raw);
      assert.equal(url.origin, 'https://talk.example');
      assert.equal(url.searchParams.get('action'), action);
      if (recipient === 'invitee') {
        assert.equal(url.pathname, new URL(urls.inviteeUrl).pathname);
        assert.equal(url.hash, new URL(urls.inviteeUrl).hash);
      } else {
        assert.equal(url.pathname, '/bookings');
        assert.equal(url.searchParams.get('booking'), booking.id);
        assert.equal(url.hash, '#booking-booking-test');
        assert.ok(!raw.includes('private-guest-link'));
      }
      assert.ok(rendered.html.includes(`>${label}</a>`));
    }
  }
});

test('cancellation template has no live invitation or join CTA', () => {
  for (const recipient of ['host', 'invitee']) {
    const result = renderSchedulingEmail({ kind: 'cancellation', recipient, b: booking, host, ...urls });
    assert.match(result.subject, /cancelled/);
    assert.ok(!result.html.includes('href='));
    assert.ok(!result.text.includes(urls.inviteeUrl));
    assert.match(result.text, /No further reminders/);
    assert.match(result.text, /Calendar update: Open the attached talk-booking\.ics/);
    assert.ok(!result.text.includes('Reschedule meeting:'));
    assert.ok(!result.text.includes('Cancel booking:'));
  }
});

test('template escapes user-controlled HTML and blocks unsafe link schemes', () => {
  const result = renderSchedulingEmail({ kind: 'confirmation', recipient: 'invitee', b: { ...booking, name: '<img src=x onerror=alert(1)>', title: '<script>evil</script>\r\nBCC: attacker' }, host, ...urls });
  assert.ok(!result.html.includes('<img'));
  assert.ok(!result.html.includes('<script>'));
  assert.match(result.html, /&lt;script&gt;/);
  assert.ok(!result.subject.includes('\n'));
  assert.throws(() => renderSchedulingEmail({ kind: 'confirmation', recipient: 'invitee', b: booking, host, ...urls, inviteeUrl: 'javascript:alert(1)' }), /valid application link/);
  assert.throws(() => renderSchedulingEmail({ kind: 'confirmation', recipient: 'other', b: booking, host, ...urls }), /Unknown/);
  assert.throws(() => renderSchedulingEmail({ kind: 'confirmation', recipient: 'invitee', b: { ...booking, ends_at: booking.starts_at }, host, ...urls }), /valid meeting times/);
});

test('UTC reminders are meeting-day09:00 and15minutes before, each with expiry', () => {
  assert.deepEqual(plannedReminders(booking.starts_at, 'UTC', time('2026-10-25T10:00:00Z')), [
    { kind: 'reminder_day', dueAt: time('2026-10-26T09:00:00Z'), expiresAt: time('2026-10-26T13:45:00Z') },
    { kind: 'reminder_15', dueAt: time('2026-10-26T13:45:00Z'), expiresAt: booking.starts_at },
  ]);
});

test('India host-local09:00 respects half-hour offset; early meetings use midnight', () => {
  const start = time('2026-10-26T14:00:00Z');
  const now = time('2026-10-25T10:00:00Z');
  assert.equal(plannedReminders(start, 'Asia/Kolkata', now)[0].dueAt, time('2026-10-26T03:30:00Z'));
  const early = time('2026-10-26T02:00:00Z');
  assert.equal(plannedReminders(early, 'Asia/Kolkata', now)[0].dueAt, time('2026-10-25T18:30:00Z'));
});

test('DST transition dates use local wall time rather than fixed24-hour offsets', () => {
  const now = time('2026-03-06T00:00:00Z');
  assert.equal(plannedReminders(time('2026-03-08T17:00:00Z'), 'America/New_York', now)[0].dueAt, time('2026-03-08T13:00:00Z'));
  assert.equal(plannedReminders(time('2026-11-01T18:00:00Z'), 'America/New_York', now)[0].dueAt, time('2026-11-01T14:00:00Z'));
});

test('real instants on either side of DST gap/fold receive unambiguous UTC reminders', () => {
  const now = time('2026-01-01T00:00:00Z');
  for (const value of ['2026-03-08T06:30:00Z', '2026-03-08T07:30:00Z', '2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z']) {
    const start = time(value);
    const result = plannedReminders(start, 'America/New_York', now);
    assert.equal(result[1].dueAt, start - 15 * 60_000);
    assert.ok(result[0].dueAt < start);
  }
  assert.equal(plannedReminders(time('2026-11-01T05:30:00Z'), 'America/New_York', now)[0].dueAt, time('2026-11-01T04:00:00Z'));
  assert.equal(plannedReminders(time('2026-11-01T06:30:00Z'), 'America/New_York', now)[0].dueAt, time('2026-11-01T04:00:00Z'));
});

test('short-notice and overdue reminders avoid a duplicate burst or after-start delivery', () => {
  const start = booking.starts_at;
  assert.deepEqual(plannedReminders(start, 'UTC', start), []);
  assert.deepEqual(plannedReminders(start, 'UTC', start + 1), []);
  assert.deepEqual(plannedReminders(start, 'UTC', start - 5 * 60_000), [
    { kind: 'reminder_15', dueAt: start - 5 * 60_000, expiresAt: start },
  ]);
  assert.equal(plannedReminders(start, 'UTC', start - 20 * 60_000).length, 1);
  const due = plannedReminders(start, 'UTC', start - 31 * 60_000);
  assert.equal(due.length, 2);
  assert.equal(due[0].dueAt, start - 31 * 60_000);
  assert.ok(due[0].expiresAt <= due[1].dueAt);
  assert.throws(() => plannedReminders(start, 'Not/A_Timezone', start - 1), RangeError);
});
