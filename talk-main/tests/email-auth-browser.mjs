import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import express from 'express';
import { chromium } from '@playwright/test';
import { createAuthApp } from '../server/auth.mjs';

// Real application and authentication API; only outbound SMTP is captured.
// Credentials/codes stay in memory and are never included in output/artifacts.
let clock = Date.now();
let sequence = 100001;
const mail = [];
const app = express();
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const auth = createAuthApp({
  origins: [origin], now: () => clock, generateCode: () => String(sequence++),
  emailConfigured: true, sendVerification: async message => { mail.push(message); },
});
app.use(auth);
app.use(express.static(path.resolve('dist')));
app.get('*', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
let browser;
let step = 'launch';
const errors = [];
const password = 'Talk-browser-fixture-password!';

// Exercise the browser integration without touching Chrome's real password
// vault or asserting a native popup. Record IDs and booleans only, never secrets.
async function installPasswordManager(context, { supported = true } = {}) {
  await context.addInitScript(({ expectedPassword, supported }) => {
    window.__talkPasswordManagerEvents = [];
    window.__talkPasswordManagerReject = false;
    if (!supported) {
      Object.defineProperty(window, 'PasswordCredential', { configurable: true, value: undefined });
      return;
    }
    Object.defineProperty(window, 'PasswordCredential', { configurable: true, value: class {
      constructor(data) {
        this.id = data.id;
        this.type = 'password';
        this.passwordCorrect = data.password === expectedPassword;
      }
    } });
    Object.defineProperty(navigator.credentials, 'store', { configurable: true, value: credential => {
      window.__talkPasswordManagerEvents.push({ id: credential.id, type: credential.type, passwordCorrect: credential.passwordCorrect });
      return window.__talkPasswordManagerReject ? Promise.reject(new Error('Password manager fixture declined')) : Promise.resolve(credential);
    } });
  }, { expectedPassword: password, supported });
}
async function assertPasswordSave(page, count, email) {
  const events = await page.evaluate(() => window.__talkPasswordManagerEvents);
  assert.equal(events.length, count, 'Only successful verified password authentication may offer a browser save');
  if (email) {
    assert(events.every(event => event.id === email && event.type === 'password' && event.passwordCorrect), 'Browser receives the authenticated email and its matching password');
  }
}
async function logout(page) {
  await page.getByRole('button', { name: 'Open account menu', exact: true }).click();
  await page.locator('.dashboard-account-menu').getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.waitForURL('**/sign-in');
}
function otpDigit(page, index = 1) {
  return page.getByRole('textbox', { name: `Verification digit ${index}`, exact: true });
}
async function fillOtp(page, code) {
  for (let index = 0; index < 6; index++) await otpDigit(page, index + 1).fill(code[index] || '');
}
try {
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
  await installPasswordManager(context);
  const page = await context.newPage();
  page.on('pageerror', () => errors.push('pageerror'));
  const signup = async (email, target = page) => {
    await target.goto(`${origin}/sign-up`);
    await target.getByRole('heading', { name: 'Create your account.', exact: true }).waitFor();
    assert.equal(await target.locator('#talk-signup-form').getAttribute('method'), 'post');
    assert.equal(await target.getByLabel('Password', { exact: true }).getAttribute('autocomplete'), 'new-password');
    await target.getByLabel('Full name', { exact: true }).fill('Talk Test Member');
    await target.getByLabel('Email address', { exact: true }).fill(email);
    await target.getByLabel('Password', { exact: true }).fill(password);
    await target.getByLabel('Confirm password', { exact: true }).fill(password);
    await target.getByRole('button', { name: 'Sign Up', exact: true }).click();
    await target.waitForURL('**/verify-email');
    await otpDigit(target).waitFor();
  };
  const login = async (email, target = page, submittedPassword = password) => {
    await target.goto(`${origin}/sign-in`);
    assert.equal(await target.locator('#talk-signin-form').getAttribute('method'), 'post');
    assert.equal(await target.getByLabel('Email address', { exact: true }).getAttribute('autocomplete'), 'username');
    assert.equal(await target.getByLabel('Password', { exact: true }).getAttribute('autocomplete'), 'current-password');
    await target.getByLabel('Email address', { exact: true }).fill(email);
    await target.getByLabel('Password', { exact: true }).fill(submittedPassword);
    await target.getByRole('button', { name: 'Sign in', exact: true }).click();
  };
  step = 'signup and unverified login resume';
  await signup('browser-member@example.com');
  assert.equal(mail.length, 1);
  await assertPasswordSave(page, 0);
  await login('browser-member@example.com');
  await page.waitForURL('**/verify-email');
  await otpDigit(page).waitFor();
  assert.equal(mail.length, 1, 'Resume retains an active challenge rather than sending duplicate mail');
  await assertPasswordSave(page, 0);
  step = 'incorrect code then valid verification';
  await fillOtp(page, '000000');
  await page.getByRole('button', { name: 'Verify Email', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'incorrect' }).waitFor();
  await assertPasswordSave(page, 0);
  await fillOtp(page, mail[0].code);
  await page.getByRole('button', { name: 'Verify Email', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Email Verified Successfully' }).waitFor();
  await page.waitForURL('**/dashboard');
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  assert.equal(await page.locator('.dashboard-preview-badge').innerText(), 'Email verified');
  await assertPasswordSave(page, 0);
  step = 'secure session refresh and logout';
  await page.reload();
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  const cookies = await context.cookies();
  assert(cookies.some(cookie => cookie.name === 'talk_session' && cookie.httpOnly && cookie.sameSite === 'Lax'));
  assert(!(await page.evaluate(() => document.cookie)).includes('talk_session'));
  const storage = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)]);
  assert(!storage.some(value => value.includes(password) || mail.some(message => value.includes(message.code))));
  await logout(page);
  await page.goto(`${origin}/dashboard`);
  await page.waitForURL('**/sign-in');
  step = 'verified email password login';
  await login('browser-member@example.com');
  await page.waitForURL('**/dashboard');
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  await assertPasswordSave(page, 1, 'browser-member@example.com');
  await context.close();

  step = 'resend invalidation against real API';
  const other = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
  await installPasswordManager(other);
  const second = await other.newPage();
  second.on('pageerror', () => errors.push('pageerror'));
  await second.goto(`${origin}/sign-up`);
  await second.getByLabel('Full name', { exact: true }).fill('Talk Test Member');
  await second.getByLabel('Email address', { exact: true }).fill('browser-resend@example.com');
  await second.getByLabel('Password', { exact: true }).fill(password);
  await second.getByLabel('Confirm password', { exact: true }).fill(password);
  await second.getByRole('button', { name: 'Sign Up', exact: true }).click();
  await second.waitForURL('**/verify-email');
  await otpDigit(second).waitFor();
  const previousCode = mail.at(-1).code;
  assert(await second.getByRole('button', { name: /Resend OTP in/ }).isDisabled());
  clock += 60001;
  await second.reload();
  const resend = second.getByRole('button', { name: 'Resend OTP', exact: true });
  await resend.waitFor();
  await resend.click();
  await second.getByRole('status').filter({ hasText: 'A new code' }).waitFor();
  await fillOtp(second, previousCode);
  await second.getByRole('button', { name: 'Verify Email', exact: true }).click();
  await second.getByRole('alert').filter({ hasText: 'incorrect' }).waitFor();
  await fillOtp(second, mail.at(-1).code);
  await second.getByRole('button', { name: 'Verify Email', exact: true }).click();
  await second.waitForURL('**/dashboard');
  await second.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  await assertPasswordSave(second, 0);
  await other.close();

  step = 'same-tab signup saves only after successful verification';
  const fresh = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
  await installPasswordManager(fresh);
  const third = await fresh.newPage();
  third.on('pageerror', () => errors.push('pageerror'));
  await signup('browser-password-save@example.com', third);
  await assertPasswordSave(third, 0);
  await fillOtp(third, '000000');
  await third.getByRole('button', { name: 'Verify Email', exact: true }).click();
  await third.getByRole('alert').filter({ hasText: 'incorrect' }).waitFor();
  await assertPasswordSave(third, 0);
  await fillOtp(third, mail.at(-1).code);
  await third.getByRole('button', { name: 'Verify Email', exact: true }).click();
  await third.waitForURL('**/dashboard');
  await third.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  await assertPasswordSave(third, 1, 'browser-password-save@example.com');

  step = 'incorrect login does not save and declined save does not block login';
  await logout(third);
  await login('browser-password-save@example.com', third, 'Talk-incorrect-fixture-password!');
  await third.getByRole('alert').waitFor();
  await assertPasswordSave(third, 0);
  await third.evaluate(() => { window.__talkPasswordManagerReject = true; });
  await third.getByLabel('Password', { exact: true }).fill(password);
  await third.getByRole('button', { name: 'Sign in', exact: true }).click();
  await third.waitForURL('**/dashboard');
  await third.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  await assertPasswordSave(third, 1, 'browser-password-save@example.com');
  await fresh.close();

  step = 'unsupported password manager does not block login';
  const unsupported = await browser.newContext({ reducedMotion: 'reduce' });
  await installPasswordManager(unsupported, { supported: false });
  const fourth = await unsupported.newPage();
  fourth.on('pageerror', () => errors.push('pageerror'));
  await login('browser-member@example.com', fourth);
  await fourth.waitForURL('**/dashboard');
  await fourth.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  await assertPasswordSave(fourth, 0);
  await unsupported.close();
  assert.equal(errors.length, 0);
  console.log('PASS real frontend + auth API: email verification, sessions, resend invalidation and password-manager integration (verified signup/login, rejected/unsupported stores, no save before verification). SMTP and native password storage were captured; no email sent or native popup asserted.');
} catch {
  console.error(`FAIL email-auth browser integration at: ${step}. Credentials and codes are withheld.`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  auth.locals.closeAuthDatabase();
}
