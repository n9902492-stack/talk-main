import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { createEmailLinks } from '../backend/src/scheduling/email-links.mjs';
import { schedulingTransport } from '../backend/src/scheduling/transport.mjs';

const secret = randomBytes(32).toString('base64url');
const booking = {
  id: 'synthetic-booking', version: 1, status: 'confirmed',
  ends_at: Date.parse('2026-10-26T15:00:00Z'), meeting_id: 'synthetic-meeting',
};
const environment = {
  SCHEDULING_EMAIL_ENABLED: 'true', SCHEDULING_PUBLIC_URL: 'https://talk.example',
  SCHEDULING_EMAIL_LINK_SECRET: secret, SMTP_HOST: 'smtp.example.invalid',
  SMTP_USER: 'sender@example.invalid', SMTP_PASSWORD: ' synthetic app password ',
  SMTP_FROM: 'Talk <sender@example.invalid>',
};
const configuredVerifier = () => ({ configured: true, sendVerification: async () => ({ ok: true }) });
const mail = {
  jobId: 'synthetic-job-host', to: 'recipient@example.invalid', subject: 'Talk booking confirmed',
  text: 'Synthetic plaintext booking confirmation.',
  html: '<p>Synthetic HTML booking confirmation.</p>',
  calendar: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:synthetic-booking@talk.local\r\nSUMMARY:Synthetic booking\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
};

test('email credentials are stable across restart instances and scoped to booking/version', () => {
  const first = createEmailLinks({ baseUrl: 'https://talk.example', secret });
  const restarted = createEmailLinks({ baseUrl: 'https://talk.example', secret });
  const invitee = first.inviteeUrl(booking);
  const value = new URL(invitee).hash.slice(1);
  assert.equal(invitee, restarted.inviteeUrl(booking));
  assert.equal(new URL(invitee).pathname, '/booking-confirmation');
  assert.equal(new URL(invitee).searchParams.get('id'), booking.id);
  assert.equal(first.verify(booking, value, booking.ends_at), true);
  assert.equal(restarted.verify(booking, value, booking.ends_at), true);
  assert.equal(first.verify({ ...booking, id: 'another-booking' }, value, booking.ends_at), false);
  assert.equal(first.verify({ ...booking, version: 2 }, value, booking.ends_at), false);
  assert.equal(createEmailLinks({ baseUrl: 'https://talk.example', secret: randomBytes(32).toString('base64url') }).verify(booking, value, booking.ends_at), false);
  assert.notEqual(first.inviteeUrl({ ...booking, version: 2 }), invitee);
  assert.equal(new URL(first.hostUrl(booking)).pathname, '/device-test');
  assert.equal(new URL(first.hostUrl(booking)).searchParams.get('room'), booking.meeting_id);
  assert.equal(new URL(first.hostUrl(booking)).hash, '');
});

test('email credentials fail closed after cancellation, expiry, alteration, or malformed input', () => {
  const links = createEmailLinks({ baseUrl: 'http://127.0.0.1:3001', secret });
  const value = new URL(links.inviteeUrl(booking)).hash.slice(1);
  assert.equal(links.verify({ ...booking, status: 'cancelled' }, value, booking.ends_at), false);
  assert.equal(links.verify(booking, value, booking.ends_at + 3_600_001), false);
  for (const invalid of [null, undefined, '', `${value}x`, value.slice(1), '!'.repeat(43), `${value[0] === 'A' ? 'B' : 'A'}${value.slice(1)}`]) {
    assert.equal(links.verify(booking, invalid, booking.ends_at), false);
  }
});

test('email origin and signing-key validation reject unsafe or ambiguous configuration', () => {
  for (const baseUrl of ['not a URL', 'http://public.example', 'https://user:pass@talk.example', 'https://talk.example/path', 'https://talk.example/?key=x', 'https://talk.example/#x', 'javascript:alert(1)']) {
    assert.throws(() => createEmailLinks({ baseUrl, secret }), /Scheduling email/);
  }
  for (const weak of [undefined, '', 'short', 'a'.repeat(42), 'a'.repeat(44), '!'.repeat(43)]) {
    assert.throws(() => createEmailLinks({ baseUrl: 'https://talk.example', secret: weak }), /32-byte/);
  }
  for (const baseUrl of ['https://talk.example', 'http://localhost:3001', 'http://127.0.0.1:3001', 'http://[::1]:3001']) {
    assert.ok(createEmailLinks({ baseUrl, secret }));
  }
});

test('disabled delivery never instantiates SMTP or verification transports', () => {
  const unexpected = () => { throw new Error('Disabled transport was instantiated.'); };
  for (const env of [{}, { SCHEDULING_EMAIL_ENABLED: 'false' }, { SCHEDULING_EMAIL_ENABLED: false }]) {
    assert.equal(schedulingTransport(env, { createTransport: unexpected, verificationMailer: unexpected }), null);
  }
  assert.throws(() => schedulingTransport({ ...environment, SCHEDULING_EMAIL_LINK_SECRET: '' }, { createTransport: unexpected, verificationMailer: unexpected }), /32-byte/);
  assert.throws(() => schedulingTransport(environment, { createTransport: unexpected, verificationMailer: () => ({ configured: false }) }), /valid existing SMTP/);
});

test('mock SMTP compiles text, HTML and ICS MIME with fixed Message-ID and safe TLS settings', async () => {
  let options;
  const messages = [];
  const compiler = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
  const transport = schedulingTransport(environment, {
    verificationMailer: configuredVerifier,
    createTransport(configuration) {
      options = configuration;
      return { async sendMail(message) {
        const result = await compiler.sendMail(message);
        messages.push(result.message.toString('utf8'));
        return { accepted: [mail.to], rejected: [],response:'250 Mock final acceptance' };
      } };
    },
  });
  await transport.send(mail);
  await transport.send(mail);
  assert.equal(messages.length, 2);
  for (const raw of messages) {
    assert.match(raw, /Message-ID: <synthetic-job-host@talk\.local>/);
    assert.match(raw, /Content-Type: multipart\/mixed/);
    assert.match(raw, /Content-Type: text\/plain; charset=utf-8/);
    assert.match(raw, /Synthetic plaintext booking confirmation\./);
    assert.match(raw, /Content-Type: text\/html; charset=utf-8/);
    assert.match(raw, /Synthetic HTML booking confirmation\./);
    assert.match(raw, /Content-Type: text\/calendar; name=talk-booking\.ics/);
    assert.match(raw, /Content-Disposition: attachment; filename=talk-booking\.ics/);
    const calendarPart = raw.match(/Content-Type: text\/calendar;[^]*?\r\n\r\n([^]*?)\r\n--/);
    assert.ok(calendarPart);
    assert.equal(Buffer.from(calendarPart[1].replace(/\s/g, ''), 'base64').toString('utf8'), mail.calendar);
  }
  assert.equal(options.port, 587);
  assert.equal(options.secure, false);
  assert.equal(options.requireTLS, true);
  assert.deepEqual(options.tls, { minVersion: 'TLSv1.2', rejectUnauthorized: true });
  assert.equal(options.auth.pass, 'synthetic app password');
  assert.equal(typeof options.logger.info,'function');assert.equal(options.transactionLog,true);
  assert.equal(options.debug, false);
  assert.equal(options.disableFileAccess, true);
  assert.equal(options.disableUrlAccess, true);
  assert.ok(options.connectionTimeout <= 15_000);
  assert.ok(options.socketTimeout <= 25_000);
  compiler.close();
});

test('transport delegates code email to existing verifier without network access', async () => {
  const received = [];
  const transport = schedulingTransport(environment, {
    verificationMailer: () => ({ configured: true, sendVerification: async value => { received.push(value); return { accepted: true }; } }),
    createTransport: () => ({ sendMail: async () => { throw new Error('Not a booking notification.'); } }),
  });
  const syntheticCode = { email: 'guest@example.invalid', code: '123456', purpose: 'scheduling' };
  assert.deepEqual(await transport.sendCode(syntheticCode), { accepted: true });
  assert.deepEqual(received, [syntheticCode]);
});

test('SMTP failures and rejected recipients expose only a sanitized delivery error', async () => {
  for (const sendMail of [
    async () => { throw new Error('Sensitive SMTP details must never escape.'); },
    async () => ({ accepted: [], rejected: [] }),
    async () => ({ accepted: [mail.to], rejected: ['other@example.invalid'] }),
  ]) {
    const transport = schedulingTransport(environment, { verificationMailer: configuredVerifier, createTransport: () => ({ sendMail }) });
    await assert.rejects(transport.send(mail), error => error.message === 'Scheduling email delivery failed.');
  }
});
