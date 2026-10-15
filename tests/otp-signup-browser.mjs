import { localChrome } from '../scripts/browser-options.mjs';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { chromium } from '@playwright/test';
import { createAuthApp } from '../backend/src/auth.mjs';

// Real built frontend, authentication API, cookies and SQLite. SMTP is an
// in-memory delivery fixture: nothing is sent, logged or stored in artifacts.
const password = 'Talk-OTP-browser-fixture-password!';
const harnesses = [];
const errors = [];
let browser;
let step = 'launch';

async function harness({ configured = true, failFirstDeliveries = 0 } = {}) {
  let clock = Date.now();
  let sequence = 200001;
  let attempts = 0;
  const mail = [];
  const app = express();
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const auth = createAuthApp({
    clientId: 'talk-otp-test.apps.googleusercontent.com', origins: [origin],
    now: () => clock, generateCode: () => String(sequence++),
    emailConfigured: configured,
    sendVerification: async message => {
      attempts++;
      if (attempts <= failFirstDeliveries) throw new Error('Isolated delivery fixture failure');
      mail.push(message);
    },
  });
  app.use(auth);
  app.use(express.static(path.resolve('frontend/dist')));
  app.get('*', (_req, res) => res.sendFile(path.resolve('frontend/dist/index.html')));
  const fixture = {
    origin, mail, attempts: () => attempts, advance: amount => { clock += amount; },
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      auth.locals.closeAuthDatabase();
    },
  };
  harnesses.push(fixture);
  return fixture;
}

async function contextFor(fixture) {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
  // This test does not touch Chrome's password vault or contact Google. The
  // shared Google sign-in control still renders through an isolated SDK.
  await context.addInitScript(() => {
    Object.defineProperty(window, 'PasswordCredential', { configurable: true, value: undefined });
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === fixture.origin) return route.continue();
    if (url.href === 'https://accounts.google.com/gsi/client') return route.fulfill({
      contentType: 'text/javascript', body: `
        window.google = { accounts: { id: {
          initialize() {}, disableAutoSelect() {},
          renderButton(host) {
            const button = document.createElement('button');
            button.type = 'button'; button.textContent = 'Continue with Google';
            host.appendChild(button);
          }
        } } };
      `,
    });
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', () => errors.push('pageerror'));
  return { context, page };
}

async function signup(page, fixture, email) {
  await page.goto(`${fixture.origin}/sign-up`);
  await page.getByRole('heading', { name: 'Create your account.', exact: true }).waitFor();
  await page.getByLabel('Full name', { exact: true }).fill('Talk OTP Test Member');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
}

function otpDigit(page, index = 1) {
  return page.getByRole('textbox', { name: `Verification digit ${index}`, exact: true });
}

async function fillOtp(page, code) {
  for (let index = 0; index < 6; index++) await otpDigit(page, index + 1).fill(code[index] || '');
}

async function pasteOtp(page, code, index = 1) {
  await otpDigit(page, index).focus();
  await otpDigit(page, index).evaluate((input, value) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text', value);
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, code);
}

async function otpValues(page) {
  return page.getByRole('textbox', { name: /^Verification digit [1-6]$/ }).evaluateAll(inputs => inputs.map(input => input.value));
}

async function focusedDigit(page, index) {
  assert(await otpDigit(page, index).evaluate(input => document.activeElement === input), 'OTP keyboard navigation must focus the intended digit');
}

async function verification(page) {
  return page.evaluate(async () => (await fetch('/api/auth/email/verification', { credentials: 'same-origin', cache: 'no-store' })).json());
}

async function assertFiveMinuteCode(page) {
  const pending = await verification(page);
  assert.equal(Date.parse(pending.verification.expiresAt) - Date.parse(pending.serverTime), 5 * 60 * 1000, 'Backend issues a five-minute OTP');
  assert.equal(Date.parse(pending.verification.resendAt) - Date.parse(pending.serverTime), 60 * 1000, 'Backend enforces a sixty-second resend cooldown');
}

async function session(page) {
  return page.evaluate(async () => (await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })).json());
}

async function assertNoSession(page, context) {
  assert.equal((await session(page)).user, null, 'Signup and unverified OTP attempts must not create a session');
  assert(!(await context.cookies()).some(cookie => cookie.name === 'talk_session'), 'No authentication cookie exists before successful verification');
}

try {
  browser = await chromium.launch({ ...localChrome(), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const delivery = await harness({ failFirstDeliveries: 2 });
  const { context, page } = await contextFor(delivery);

  step = 'delivery failure opens OTP recovery automatically';
  await signup(page, delivery, 'otp-delivery-recovery@example.com');
  await page.waitForURL('**/verify-email');
  await page.getByRole('heading', { name: 'Verify Your Email', exact: true }).waitFor();
  await page.getByRole('alert').filter({ hasText: 'could not deliver' }).waitFor();
  const field = otpDigit(page);
  assert.equal(await page.getByRole('group', { name: 'Verification code', exact: true }).count(), 1, 'Six OTP inputs have a shared accessible group label');
  assert.equal(await page.getByRole('textbox', { name: /^Verification digit [1-6]$/ }).count(), 6);
  assert(await field.isDisabled(), 'Failed delivery must disable code submission');
  assert(await page.getByRole('button', { name: 'Verify Email', exact: true }).isDisabled());
  assert(await page.getByRole('button', { name: /Resend OTP in/ }).isDisabled(), 'Recovery must honor the resend cooldown');
  assert.equal(delivery.attempts(), 1);
  assert.equal(delivery.mail.length, 0, 'The failed delivery has not sent usable mail');
  await assertNoSession(page, context);

  step = 'failed resend refreshes cooldown and expiry without false success';
  delivery.advance(60001);
  await page.reload();
  await page.getByRole('button', { name: 'Resend OTP', exact: true }).click();
  await page.getByRole('button', { name: /Resend OTP in/ }).waitFor();
  assert(await field.isDisabled(), 'Another failed delivery must keep code entry disabled');
  assert(await page.getByRole('button', { name: /Resend OTP in/ }).isDisabled());
  assert.equal(await page.getByRole('status').filter({ hasText: 'A new code' }).count(), 0, 'Failed delivery must not claim that usable mail was sent');
  assert.equal(delivery.attempts(), 2);
  assert.equal(delivery.mail.length, 0);
  await assertFiveMinuteCode(page);
  await assertNoSession(page, context);

  step = 'resend recovery sends usable code without granting a session';
  delivery.advance(60001);
  await page.reload();
  await page.getByRole('button', { name: 'Resend OTP', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'A new code' }).waitFor();
  assert.equal(delivery.attempts(), 3);
  assert.equal(delivery.mail.length, 1);
  assert(await field.isEnabled());
  await assertFiveMinuteCode(page);
  await assertNoSession(page, context);

  step = 'incorrect OTP stays locked out and valid OTP signs in';
  await fillOtp(page, '000000');
  await page.getByRole('button', { name: 'Verify Email', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'incorrect' }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/verify-email');
  await assertNoSession(page, context);
  await pasteOtp(page, delivery.mail.at(-1).code);
  await page.getByRole('button', { name: 'Verify Email', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Email Verified Successfully' }).waitFor();
  await page.waitForURL('**/dashboard');
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  assert.equal((await session(page)).user.emailVerified, true);
  const cookies = await context.cookies();
  assert(cookies.some(cookie => cookie.name === 'talk_session' && cookie.httpOnly && cookie.sameSite === 'Lax'));
  assert(!(await page.evaluate(() => document.cookie)).includes('talk_session'));
  await page.reload();
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  await context.close();

  step = 'successful signup opens OTP and refresh retains pending verification';
  const happy = await contextFor(delivery);
  await signup(happy.page, delivery, 'otp-successful-signup@example.com');
  await happy.page.waitForURL('**/verify-email');
  await otpDigit(happy.page).waitFor();
  assert(await otpDigit(happy.page).isEnabled());
  await focusedDigit(happy.page, 1);
  assert.equal(await happy.page.getByText("We've sent a 6-digit verification code to your email.", { exact: true }).count(), 1);
  assert.equal(await happy.page.getByText('otp-successful-signup@example.com', { exact: true }).count(), 1);
  await assertFiveMinuteCode(happy.page);
  await assertNoSession(happy.page, happy.context);
  const sentCount = delivery.mail.length;
  await happy.page.reload();
  await otpDigit(happy.page).waitFor();
  assert(await otpDigit(happy.page).isEnabled());
  assert.equal(delivery.mail.length, sentCount, 'Refreshing an OTP page must not send duplicate email');
  await assertNoSession(happy.page, happy.context);
  assert((await happy.context.cookies()).some(cookie => cookie.name === 'talk_email_verification' && cookie.httpOnly));
  const storage = await happy.page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)]);
  assert(!storage.some(value => value.includes(password) || delivery.mail.some(message => value.includes(message.code))), 'Credentials and codes must stay out of application browser storage');

  step = 'unverified account cannot open dashboard and password login resumes OTP';
  await happy.page.goto(`${delivery.origin}/dashboard`);
  await happy.page.waitForURL('**/sign-in');
  await assertNoSession(happy.page, happy.context);
  await happy.page.getByLabel('Email address', { exact: true }).fill('otp-successful-signup@example.com');
  await happy.page.getByLabel('Password', { exact: true }).fill(password);
  await happy.page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await happy.page.waitForURL('**/verify-email');
  await otpDigit(happy.page).waitFor();
  assert.equal(delivery.mail.length, sentCount, 'Resuming a valid OTP must not send duplicate email');
  await assertNoSession(happy.page, happy.context);

  step = 'six-box autofocus, digit advance, backspace and arrow navigation';
  await focusedDigit(happy.page, 1);
  await otpDigit(happy.page).pressSequentially('1');
  await focusedDigit(happy.page, 2);
  await otpDigit(happy.page, 2).pressSequentially('2');
  await focusedDigit(happy.page, 3);
  await otpDigit(happy.page, 3).press('Backspace');
  await focusedDigit(happy.page, 2);
  assert.equal(await otpDigit(happy.page, 2).inputValue(), '', 'Backspace on an empty digit clears and focuses the previous input');
  await otpDigit(happy.page, 2).press('ArrowLeft');
  await focusedDigit(happy.page, 1);
  await otpDigit(happy.page, 1).press('ArrowRight');
  await focusedDigit(happy.page, 2);
  await otpDigit(happy.page, 2).pressSequentially('3');
  await focusedDigit(happy.page, 3);
  await otpDigit(happy.page, 3).pressSequentially('x');
  assert.equal(await otpDigit(happy.page, 3).inputValue(), '', 'OTP inputs reject non-digit characters');

  step = 'paste all six digits from first and middle input';
  await pasteOtp(happy.page, '123456');
  assert.deepEqual(await otpValues(happy.page), ['1', '2', '3', '4', '5', '6']);
  await focusedDigit(happy.page, 6);
  await pasteOtp(happy.page, '654321', 3);
  assert.deepEqual(await otpValues(happy.page), ['6', '5', '4', '3', '2', '1'], 'Full OTP pasting replaces the whole code even from a middle input');
  await focusedDigit(happy.page, 6);
  await fillOtp(happy.page, '');

  step = 'blank OTP screen screenshots on desktop and mobile';
  const artifacts = path.resolve('artifacts/qa');
  await fs.mkdir(artifacts, { recursive: true });
  assert.deepEqual(await otpValues(happy.page), ['', '', '', '', '', '']);
  await happy.page.screenshot({ path: path.join(artifacts, 'signup-otp-desktop.png'), fullPage: true });
  await happy.page.setViewportSize({ width: 390, height: 844 });
  assert.deepEqual(await otpValues(happy.page), ['', '', '', '', '', '']);
  assert(await happy.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile OTP screen must not overflow horizontally');
  await happy.page.screenshot({ path: path.join(artifacts, 'signup-otp-mobile.png'), fullPage: true });
  await happy.page.setViewportSize({ width: 320, height: 800 });
  assert(await happy.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Narrow OTP screen must not overflow horizontally');
  await happy.page.screenshot({ path: path.join(artifacts, 'signup-otp-narrow.png'), fullPage: true });

  step = 'five-minute expiry rejects the previous code on the backend';
  const expiredCode = delivery.mail.at(-1).code;
  delivery.advance(5 * 60 * 1000 + 1);
  await fillOtp(happy.page, expiredCode);
  await happy.page.getByRole('button', { name: 'Verify Email', exact: true }).click();
  await happy.page.getByRole('alert').filter({ hasText: 'expired' }).waitFor();
  await assertNoSession(happy.page, happy.context);
  await happy.page.reload();
  await happy.page.getByText('Code expired. Request a new code below.', { exact: true }).waitFor();
  assert(await otpDigit(happy.page).isDisabled());
  assert(await happy.page.getByRole('button', { name: 'Verify Email', exact: true }).isDisabled());

  step = 'resend refreshes the five-minute deadline and invalidates the old code';
  await happy.page.getByRole('button', { name: 'Resend OTP', exact: true }).click();
  await happy.page.getByRole('status').filter({ hasText: 'A new code' }).waitFor();
  await assertFiveMinuteCode(happy.page);
  assert(await happy.page.getByRole('button', { name: /Resend OTP in/ }).isDisabled());
  await fillOtp(happy.page, expiredCode);
  await happy.page.getByRole('button', { name: 'Verify Email', exact: true }).click();
  await happy.page.getByRole('alert').filter({ hasText: 'incorrect' }).waitFor();
  await assertNoSession(happy.page, happy.context);
  await pasteOtp(happy.page, delivery.mail.at(-1).code, 4);
  await happy.page.getByRole('button', { name: 'Verify Email', exact: true }).click();
  await happy.page.getByRole('status').filter({ hasText: 'Email Verified Successfully' }).waitFor();
  await happy.page.waitForURL('**/dashboard');
  await happy.page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  assert.equal((await session(happy.page)).user.emailVerified, true);
  await happy.context.close();

  step = 'back to signup invalidates the pending OTP without creating a session';
  const cancelled = await contextFor(delivery);
  await signup(cancelled.page, delivery, 'otp-cancelled-signup@example.com');
  await cancelled.page.waitForURL('**/verify-email');
  await otpDigit(cancelled.page).waitFor();
  const back = cancelled.page.getByRole('link', { name: 'Back to Sign Up', exact: true });
  assert.equal(await back.getAttribute('href'), '/sign-up');
  await back.click();
  await cancelled.page.waitForURL('**/sign-up');
  assert.equal((await verification(cancelled.page)).verification, null, 'Leaving via the signup link invalidates the pending verification challenge');
  await assertNoSession(cancelled.page, cancelled.context);
  await cancelled.context.close();

  step = 'missing mail configuration remains on signup with no pending OTP';
  const unavailable = await harness({ configured: false });
  const missing = await contextFor(unavailable);
  await signup(missing.page, unavailable, 'otp-unconfigured@example.com');
  await missing.page.getByRole('alert').filter({ hasText: 'unavailable' }).waitFor();
  assert.equal(new URL(missing.page.url()).pathname, '/sign-up');
  assert.equal(await otpDigit(missing.page).count(), 0);
  assert.equal(unavailable.attempts(), 0, 'Missing configuration must not invoke SMTP');
  const pending = await missing.page.evaluate(async () => (await fetch('/api/auth/email/verification', { credentials: 'same-origin', cache: 'no-store' })).json());
  assert.equal(pending.verification, null);
  await assertNoSession(missing.page, missing.context);
  await missing.context.close();

  assert.equal(errors.length, 0, 'Authentication pages must not raise browser exceptions');
  console.log('PASS signup OTP browser flow: automatic OTP page, six-input focus/keyboard/paste, five-minute expiry, cooldown/resend invalidation, dashboard guard, delivery-error recovery, success announcement/session, pending refresh, signup cancellation, configuration error and desktop/390px/320px blank-code screenshots. Real frontend/API/SQLite/cookies; SMTP and Google SDK were fixtures. No email sent or native password storage used.');
} catch {
  console.error(`FAIL signup OTP browser flow at: ${step}. Credentials and codes are withheld.`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const fixture of harnesses) await fixture.close();
}
