import assert from 'node:assert/strict';
import test from 'node:test';
import { createVerificationMailer, EmailDeliveryError } from '../backend/src/mailer.mjs';

const env = {
  SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '587', SMTP_USER: 'sender@example.com',
  SMTP_PASSWORD: 'abcd efgh ijkl mnop', SMTP_FROM: 'Talk <sender@example.com>',
};
const request = { to: 'member@example.com', code: '001234', expiresAt: new Date('2026-10-14T13:50:00Z') };

function fixture(options = {}) {
  const state = { created: 0, verified: 0, messages: [] };
  const mailer = createVerificationMailer(options.env || env, {
    createTransport(configuration) {
      state.created += 1;
      state.configuration = configuration;
      if (options.factoryError) throw options.factoryError;
      return {
        async sendMail(message) {
          state.messages.push(message);
          if (options.sendError) throw options.sendError;
          return options.result || { accepted: [request.to], rejected: [], pending: [] };
        },
        async verify() {
          state.verified += 1;
          if (options.verifyError) throw options.verifyError;
          return options.verifyResult === undefined ? true : options.verifyResult;
        },
      };
    },
  });
  return { state, mailer };
}

test('uses port 587 with mandatory STARTTLS, validated TLS and no SMTP logging or content access', async () => {
  const { mailer, state } = fixture();
  assert.equal(mailer.configured, true);
  assert.equal(state.created, 0, 'does not connect during application startup');
  await mailer.sendVerification(request);
  assert.deepEqual(state.configuration, {
    host: 'smtp.gmail.com', port: 587, secure: false, requireTLS: true, ignoreTLS: false,
    opportunisticTLS: false, auth: { user: 'sender@example.com', pass: 'abcdefghijklmnop' },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 25_000, dnsTimeout: 15_000,
    logger: false, debug: false, transactionLog: false, disableFileAccess: true, disableUrlAccess: true,
    maxRecipients: 1,
  });
});

test('sends a Talk-branded HTML and plain-text email with six digits, one-use and exact IST expiry', async () => {
  const { mailer, state } = fixture();
  await mailer.sendVerification(request);
  const message = state.messages[0];
  assert.deepEqual(message.from, { name: 'Talk', address: 'sender@example.com' });
  assert.deepEqual(message.to, { address: request.to });
  assert.equal(message.subject, 'Your Talk verification code');
  assert.equal(message.subject.includes(request.code), false, 'code is not exposed in email notifications');
  for (const content of [message.html, message.text]) {
    assert.match(content, /Talk/);
    assert.match(content, /001234/);
    assert.match(content, /5 minutes/);
    assert.doesNotMatch(content, /10 minutes/);
    assert.match(content, /14 Oct 2026, 19:20 IST/);
    assert.match(content, /only once/);
    assert.match(content, /Never share this code/);
    assert.match(content, /ignore this email/);
    assert.equal(content.includes('abcdefghijklmnop'), false);
    assert.equal(content.includes('sender@example.com'), false);
    assert.equal(content.includes('member@example.com'), false);
  }
  assert.match(message.html, /max-width:480px/);
  assert.match(message.html, /#E8F1FF/);
  assert.equal(/(?:src=|<script|<iframe|<img|https?:\/\/)/i.test(message.html), false);
  assert.equal(message.disableFileAccess, true);
  assert.equal(message.disableUrlAccess, true);
  assert.equal('attachments' in message, false);
});

test('accepts ISO expiry strings and single addresses containing a plus tag', async () => {
  const { mailer, state } = fixture({ result: { accepted: ['MEMBER+SIGNUP@EXAMPLE.COM'], rejected: [] } });
  await mailer.sendVerification({ ...request, to: ' member+signup@example.com ', expiresAt: request.expiresAt.toISOString() });
  assert.equal(state.messages[0].to.address, 'member+signup@example.com');
});

test('defaults host and port, supports a simple sender and preserves non-Gmail password spaces', async () => {
  const defaults = fixture({ env: { SMTP_USER: env.SMTP_USER, SMTP_PASSWORD: env.SMTP_PASSWORD, SMTP_FROM: env.SMTP_USER } });
  await defaults.mailer.sendVerification(request);
  assert.equal(defaults.state.configuration.host, 'smtp.gmail.com');
  assert.equal(defaults.state.configuration.port, 587);
  assert.deepEqual(defaults.state.messages[0].from, { name: 'Talk', address: env.SMTP_USER });
  const alternate = fixture({ env: { ...env, SMTP_HOST: 'smtp.example.com', SMTP_PASSWORD: 'spaces in password' } });
  await alternate.mailer.sendVerification(request);
  assert.equal(alternate.state.configuration.auth.pass, 'spaces in password');
});

test('missing credentials and unsafe or non-587 configurations do not create a transport', async () => {
  const configurations = [
    {}, { ...env, SMTP_USER: '' }, { ...env, SMTP_PASSWORD: '' }, { ...env, SMTP_FROM: '' },
    { ...env, SMTP_PASSWORD: 'your-app-password' }, { ...env, SMTP_FROM: '<your-email>' },
    { ...env, SMTP_PORT: '465' }, { ...env, SMTP_PORT: '587garbage' },
    { ...env, SMTP_HOST: 'smtp.gmail.com\r\nmalicious' }, { ...env, SMTP_HOST: 'https://smtp.gmail.com' },
    { ...env, SMTP_USER: 'sender@example.com\nBcc: victim@example.com' },
    { ...env, SMTP_FROM: 'Talk <sender@example.com>\r\nBcc: victim@example.com' },
    { ...env, SMTP_FROM: 'Talk <sender@example.com>, attacker@example.com' },
  ];
  for (const configuration of configurations) {
    const { mailer, state } = fixture({ env: configuration });
    assert.equal(mailer.configured, false);
    await assert.rejects(mailer.sendVerification(request), error => error instanceof EmailDeliveryError && error.code === 'EMAIL_NOT_CONFIGURED');
    await assert.rejects(mailer.verifyConnection(), error => error instanceof EmailDeliveryError && error.code === 'EMAIL_NOT_CONFIGURED');
    assert.equal(state.created, 0);
    assert.equal(state.messages.length, 0);
  }
});

test('rejects recipient injection, multiple recipients, invalid codes and invalid expiry before transport creation', async () => {
  const invalidRequests = [
    { ...request, to: 'member@example.com\r\nBcc: other@example.com' },
    { ...request, to: 'member@example.com,other@example.com' },
    { ...request, to: 'Name <member@example.com>' },
    { ...request, to: 'a..b@example.com' }, { ...request, to: 'user@-example.com' },
    { ...request, to: 'user@localhost' }, { ...request, to: 'user @example.com' },
    { ...request, to: 'a'.repeat(65) + '@example.com' },
    { ...request, code: 123456 }, { ...request, code: '12345' },
    { ...request, code: '123456<script>' }, { ...request, code: '123456\r\n' },
    { ...request, expiresAt: new Date('invalid') }, { ...request, expiresAt: 'not a date' },
    { ...request, expiresAt: 123 }, { ...request, expiresAt: '2026-10-14Twrong' },
  ];
  for (const invalidRequest of invalidRequests) {
    const { mailer, state } = fixture();
    await assert.rejects(mailer.sendVerification(invalidRequest), TypeError);
    assert.equal(state.created, 0);
    assert.equal(state.messages.length, 0);
  }
});

test('sanitizes SMTP failures and never retains their credentials, codes, protocol response or causes', async () => {
  const sensitiveError = Object.assign(new Error('SMTP auth=secret-password code=001234 recipient=member@example.com'), {
    response: '535 password secret-password', code: 'EAUTH', cause: new Error('password'),
  });
  for (const options of [{ sendError: sensitiveError }, { factoryError: sensitiveError }, { verifyError: sensitiveError }]) {
    const { mailer } = fixture(options);
    const operation = options.verifyError ? mailer.verifyConnection() : mailer.sendVerification(request);
    await assert.rejects(operation, error => {
      assert.ok(error instanceof EmailDeliveryError);
      assert.equal(error.code, 'EMAIL_DELIVERY_FAILED');
      assert.equal(error.diagnosticCategory, 'authentication');
      assert.equal(error.message, "We couldn't send a verification email. Please try again later.");
      assert.equal('response' in error, false);
      assert.equal('cause' in error, false);
      assert.equal(/secret-password|001234|member@example/.test(`${error.stack} ${JSON.stringify(error)}`), false);
      return true;
    });
  }
});

test('SMTP diagnostics use only fixed categories without changing public errors or preserving upstream details', async () => {
  const cases = [
    ['EAUTH', 'authentication'],
    ['EDNS', 'dns'], ['ENOTFOUND', 'dns'], ['EAI_AGAIN', 'dns'],
    ['ETIMEDOUT', 'timeout'],
    ['ECONNECTION', 'connection'], ['ECONNREFUSED', 'connection'], ['ECONNRESET', 'connection'],
    ['ENETUNREACH', 'connection'], ['EHOSTUNREACH', 'connection'], ['ESOCKET', 'connection'],
    ['ETLS', 'tls'], ['CERT_HAS_EXPIRED', 'tls'], ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls'],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'tls'], ['SELF_SIGNED_CERT_IN_CHAIN', 'tls'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls'], ['EENVELOPE', 'recipient_rejected'],
    ['password-secret recipient@example.com code=987654', 'unknown'], ['arbitrary-transport-error', 'unknown'],
    [undefined, 'unknown'], [535, 'unknown'],
  ];
  for (const [code, category] of cases) {
    const upstream = Object.assign(new Error('password-secret recipient@example.com code=987654'), {
      code, response: 'private SMTP response', diagnosticCategory: 'private SMTP diagnostic',
      cause: new Error('password-secret'),
    });
    for (const operation of ['send', 'verify']) {
      const { mailer } = fixture(operation === 'send' ? { sendError: upstream } : { verifyError: upstream });
      await assert.rejects(operation === 'send' ? mailer.sendVerification(request) : mailer.verifyConnection(), error => {
        assert.equal(error.code, 'EMAIL_DELIVERY_FAILED');
        assert.equal(error.message, "We couldn't send a verification email. Please try again later.");
        assert.equal(error.diagnosticCategory, category);
        assert.equal('cause' in error, false);
        assert.equal('response' in error, false);
        assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`, /password-secret|recipient@example|987654|private SMTP/);
        return true;
      });
    }
  }
  const unknown = new EmailDeliveryError('private SMTP code', 'private SMTP diagnostic');
  assert.equal(unknown.code, 'EMAIL_DELIVERY_FAILED');
  assert.equal(unknown.diagnosticCategory, 'unknown');
  assert.throws(() => { unknown.diagnosticCategory = 'private SMTP diagnostic'; }, TypeError);
  assert.equal(unknown.diagnosticCategory, 'unknown');
  const notConfigured = new EmailDeliveryError('EMAIL_NOT_CONFIGURED');
  assert.equal(notConfigured.code, 'EMAIL_NOT_CONFIGURED');
  assert.equal(notConfigured.diagnosticCategory, 'configuration');
});

test('requires explicit SMTP acceptance for the recipient and rejects rejected or pending results', async () => {
  for (const result of [
    {}, { accepted: [], response: '250 accepted' }, { accepted: ['other@example.com'] },
    { accepted: [request.to], rejected: [request.to] }, { accepted: [request.to], pending: [request.to] },
  ]) {
    const { mailer } = fixture({ result });
    await assert.rejects(mailer.sendVerification(request), error => {
      assert.ok(error instanceof EmailDeliveryError);
      assert.equal(error.code, 'EMAIL_DELIVERY_FAILED');
      assert.equal(error.diagnosticCategory, result.accepted?.includes(request.to) && result.pending?.length ? 'unknown' : 'recipient_rejected');
      return true;
    });
  }
});

test('connection verification authenticates without sending any email and reuses the transport', async () => {
  const { mailer, state } = fixture();
  assert.equal(await mailer.verifyConnection(), undefined);
  assert.equal(state.created, 1);
  assert.equal(state.verified, 1);
  assert.equal(state.messages.length, 0);
  await mailer.sendVerification(request);
  assert.equal(state.created, 1);
  assert.equal(state.messages.length, 1);
  const failed = fixture({ verifyResult: false });
  await assert.rejects(failed.mailer.verifyConnection(), EmailDeliveryError);
});
