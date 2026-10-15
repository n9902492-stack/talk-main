import { localChrome } from '../scripts/browser-options.mjs';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { chromium } from '@playwright/test';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createServer } from 'vite';
import { createAuthApp } from '../backend/src/auth.mjs';

// Only this isolated test server substitutes Firebase modules. The application
// has no test bypass, and no test phone, code, token or credentials are logged.
// Talk's HTTP authentication API, SQLite database and session cookies are real.
const projectId = 'talk-phone-browser-fixture';
const testPhone = '+919000000001';
const fixtureCode = '123456';
const sdkSource = `
  const state = window.__talkPhoneFixture ||= {
    mode: 'success', sends: 0, verifies: 0, signOuts: 0, sequence: 0,
    recaptchas: 0, clearedRecaptchas: 0, activePhone: null
  };
  const apps = [];
  export const getApps = () => apps;
  export function initializeApp(options, name) {
    const app = { options, name: name || '[DEFAULT]' }; apps.push(app); return app;
  }
  export const inMemoryPersistence = { type: 'NONE' };
  export function initializeAuth(app, options) {
    if (options.persistence !== inMemoryPersistence) throw new Error('Expected memory-only Firebase persistence');
    const auth = { app, currentUser: null, settings: {}, useDeviceLanguage() {} }; state.auth = auth; return auth;
  }
  export async function signOut(auth) { state.signOuts++; auth.currentUser = null; }
  export class RecaptchaVerifier {
    constructor(auth, host, parameters) {
      this.auth = auth; this.host = typeof host === 'string' ? document.getElementById(host) : host;
      this.parameters = parameters; this.button = null; state.recaptchas++;
    }
    async render() {
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = 'Complete test security check';
      button.addEventListener('click', () => {
        button.disabled = true; this.parameters.callback?.('isolated-recaptcha-fixture');
      });
      this.host.appendChild(button); this.button = button;
      return state.recaptchas;
    }
    clear() { state.clearedRecaptchas++; this.button?.remove(); }
    async verify() { return 'isolated-recaptcha-fixture'; }
  }
  const failure = (code) => Object.assign(new Error('Isolated Firebase fixture failure'), { code });
  export async function signInWithPhoneNumber(auth, phoneNumber) {
    state.sends++;
    if (state.mode === 'send-error') throw failure('auth/quota-exceeded');
    if (state.mode === 'invalid-phone') throw failure('auth/invalid-phone-number');
    state.activePhone = phoneNumber;
    const sequence = ++state.sequence;
    return {
      verificationId: 'isolated-verification-' + sequence,
      async confirm(code) {
        state.verifies++;
        if (state.mode === 'expired-otp') throw failure('auth/code-expired');
        if (state.mode === 'invalid-otp' || code !== '${fixtureCode}') throw failure('auth/invalid-verification-code');
        const authTime = Math.floor(Date.now() / 1000);
        const user = { phoneNumber, async getIdToken() {
          const seconds = Math.floor(Date.now() / 1000);
          return JSON.stringify({
            uid: 'phone-browser-member', sub: 'phone-browser-member',
            aud: '${projectId}', iss: 'https://securetoken.google.com/${projectId}',
            phone_number: phoneNumber, auth_time: authTime,
            iat: seconds, exp: seconds + 3600,
            firebase: { sign_in_provider: 'phone' }, fixtureSequence: sequence
          });
        } };
        auth.currentUser = user; return { user };
      }
    };
  }
`;

function fixturePlugin() {
  const moduleId = '\0talk-isolated-firebase-fixture';
  return {
    name: 'talk-phone-browser-isolated-firebase', enforce: 'pre',
    resolveId(id) { if (id === 'firebase/app' || id === 'firebase/auth') return moduleId; },
    load(id) { if (id === moduleId) return sdkSource; },
  };
}

let browser;
let fixture;
let step = 'initialize isolated Firebase browser harness';
const errors = [];

async function harness() {
  let clock = Date.now();
  let rejectProof = false;
  let proofCalls = 0;
  const app = express();
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const auth = createAuthApp({
    clientId: 'talk-phone-test.apps.googleusercontent.com', origins: [origin],
    now: () => clock, firebaseProjectId: projectId, phoneConfigured: true,
    verifyFirebaseToken: async value => {
      proofCalls++;
      if (rejectProof) throw new Error('Isolated token verification rejection');
      return JSON.parse(value);
    },
    emailConfigured: true, sendVerification: async () => {},
  });
  app.use(auth);
  const definitions = {
    VITE_FIREBASE_API_KEY: 'isolated-public-fixture-key',
    VITE_FIREBASE_AUTH_DOMAIN: `${projectId}.firebaseapp.com`,
    VITE_FIREBASE_PROJECT_ID: projectId,
    VITE_FIREBASE_STORAGE_BUCKET: `${projectId}.firebasestorage.app`,
    VITE_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
    VITE_FIREBASE_APP_ID: '1:1234567890:web:isolated-phone-fixture',
    VITE_FIREBASE_PHONE_TESTING: 'false',
  };
  const vite = await createServer({
    configFile: false, root: path.resolve('frontend'), appType: 'spa',
    plugins: [fixturePlugin(), react(), tailwindcss()],
    define: Object.fromEntries(Object.entries(definitions).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
    optimizeDeps: { exclude: ['firebase/app', 'firebase/auth'] },
    server: { middlewareMode: true, hmr: false, watch: null },
    logLevel: 'error',
  });
  app.use(vite.middlewares);
  return {
    origin,
    now: () => clock,
    advance: amount => { clock += amount; },
    rejectProof: value => { rejectProof = value; },
    proofCalls: () => proofCalls,
    async close() {
      await vite.close();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      auth.locals.closeAuthDatabase();
    },
  };
}

async function contextFor(width = 1440) {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width, height: 1000 } });
  await context.addInitScript(() => {
    Object.defineProperty(window, 'PasswordCredential', { configurable: true, value: undefined });
  });
  // Never contact Google, Firebase, reCAPTCHA, fonts or a real SMS provider.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === fixture.origin) return route.continue();
    if (url.href === 'https://accounts.google.com/gsi/client') return route.fulfill({ contentType: 'text/javascript', body: `
      window.google = { accounts: { id: {
        initialize() {}, disableAutoSelect() {},
        renderButton(host) { const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Continue with Google'; host.appendChild(button); }
      } } };
    ` });
    return route.abort();
  });
  const page = await context.newPage();
  await page.clock.install({ time: new Date(fixture.now()) });
  page.on('pageerror', () => errors.push('pageerror'));
  return { context, page };
}

const digit = (page, index = 1) => page.getByRole('textbox', { name: `Verification digit ${index}`, exact: true });
const digits = page => page.getByRole('textbox', { name: /^Verification digit [1-6]$/ });
async function pasteCode(page, code = fixtureCode) {
  await digit(page).focus();
  await digit(page).evaluate((input, value) => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text', value);
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, code);
}
async function session(page) { return page.evaluate(async () => (await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })).json()); }
async function assertGuest(page, context) {
  assert.equal((await session(page)).user, null, 'Firebase UI proof cannot bypass Talk server verification');
  assert(!(await context.cookies()).some(cookie => cookie.name === 'talk_session'), 'A pending phone challenge must not create a Talk session');
}
async function sdkState(page, mode) {
  return page.evaluate(value => {
    if (value) window.__talkPhoneFixture.mode = value;
    const { sends, verifies, signOuts, recaptchas, clearedRecaptchas } = window.__talkPhoneFixture;
    return { sends, verifies, signOuts, recaptchas, clearedRecaptchas };
  }, mode);
}
async function enterPhone(page, source = '/phone-sign-in') {
  await page.goto(`${fixture.origin}${source}`);
  await page.getByLabel('Mobile number', { exact: true }).waitFor();
  const country = page.getByLabel('Country code', { exact: true });
  assert((await country.inputValue()).includes('91'), 'India must be the default country code');
  await page.getByLabel('Mobile number', { exact: true }).fill(testPhone.slice(3));
  await page.getByRole('checkbox').check();
  const securityCheck = page.getByRole('button', { name: 'Complete test security check', exact: true });
  if (await securityCheck.count()) await securityCheck.click();
}
async function sendCode(page) {
  await page.getByRole('button', { name: 'Send OTP', exact: true }).click();
  await page.waitForURL('**/verify-phone');
  await digit(page).waitFor();
}
async function captureResponsive(page, name) {
  await fs.mkdir(path.resolve('artifacts/qa'), { recursive: true });
  for (const [label, width] of [['desktop', 1440], ['mobile390', 390], ['mobile320', 320]]) {
    await page.setViewportSize({ width, height: 1000 });
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    assert(fits, 'Phone authentication must fit desktop and narrow mobile screens');
    await page.screenshot({ path: path.resolve(`artifacts/qa/${name}-${label}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

try {
  fixture = await harness();
  browser = await chromium.launch({ ...localChrome(), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const { context, page } = await contextFor();

  step = 'phone option on existing signup and signin pages';
  for (const route of ['/sign-up', '/sign-in']) {
    await page.goto(`${fixture.origin}${route}`);
    const phone = page.getByRole('link', { name: 'Continue with Phone Number', exact: true });
    await phone.waitFor();
    assert.equal(await phone.getAttribute('href'), '/phone-sign-in');
    assert.equal(await page.locator('.google-signin-host').count(), 1, 'Existing Google control remains available');
  }

  step = 'default country, SMS consent, captcha and pending phone signup';
  await page.goto(`${fixture.origin}/phone-sign-in`);
  await page.getByRole('button', { name: 'Complete test security check', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__talkPhoneFixture.auth.settings.appVerificationDisabledForTesting), false, 'Normal authentication must keep Firebase app verification enabled');
  await captureResponsive(page, 'phone-entry');
  await enterPhone(page);
  assert.equal((await sdkState(page)).sends, 0);
  await sendCode(page);
  assert.equal(await digits(page).count(), 6);
  assert(await digit(page).evaluate(input => document.activeElement === input), 'The first OTP box receives focus');
  assert(await page.getByRole('button', { name: /Resend OTP in/ }).isDisabled(), 'The sixty-second resend cooldown is visible');
  await assertGuest(page, context);
  await captureResponsive(page, 'verify-phone');

  step = 'OTP keyboard movement and paste';
  await digit(page).fill('1');
  assert(await digit(page, 2).evaluate(input => document.activeElement === input), 'A digit advances focus');
  await digit(page, 2).press('ArrowLeft');
  assert(await digit(page).evaluate(input => document.activeElement === input));
  await pasteCode(page);
  assert.deepEqual(await digits(page).evaluateAll(inputs => inputs.map(input => input.value)), fixtureCode.split(''));

  step = 'incorrect OTP cannot establish a Talk session';
  await sdkState(page, 'invalid-otp');
  await page.getByRole('button', { name: 'Verify OTP', exact: true }).click();
  await page.getByRole('alert').waitFor();
  await assertGuest(page, context);

  step = 'expired OTP remains signed out';
  await sdkState(page, 'expired-otp');
  await pasteCode(page);
  await page.getByRole('button', { name: 'Verify OTP', exact: true }).click();
  await page.getByRole('alert').waitFor();
  await assertGuest(page, context);

  step = 'change number invalidates the pending challenge';
  await page.getByRole('button', { name: 'Change Number', exact: true }).click();
  await page.waitForURL('**/phone-sign-in');
  const pending = await page.evaluate(async () => (await fetch('/api/auth/phone/challenge', { credentials: 'same-origin', cache: 'no-store' })).json());
  assert.equal(pending.challenge, null);
  await assertGuest(page, context);
  await context.close();

  step = 'delivery error remains recoverable without a session';
  fixture.advance(60001);
  const failed = await contextFor(390);
  await enterPhone(failed.page);
  await sdkState(failed.page, 'send-error');
  await failed.page.getByRole('button', { name: 'Send OTP', exact: true }).click();
  await failed.page.getByRole('alert').waitFor();
  assert.equal((await sdkState(failed.page)).sends, 1, 'Delivery-error recovery must exercise Firebase rather than a backend cooldown');
  assert.equal(new URL(failed.page.url()).pathname, '/phone-sign-in');
  await assertGuest(failed.page, failed.context);
  await failed.context.close();

  // Start the happy path after the real backend cooldown. Its clock and the
  // test browser clock advance together; this never changes production time.
  fixture.advance(60001);
  step = 'SMS resend has cooldown and creates a fresh Firebase confirmation';
  const happy = await contextFor();
  await enterPhone(happy.page);
  await sendCode(happy.page);
  fixture.advance(60001);
  await happy.page.clock.fastForward(60001);
  await happy.page.getByRole('button', { name: 'Resend OTP', exact: true }).click();
  await happy.page.getByRole('button', { name: /Resend OTP in/ }).waitFor();
  assert.equal((await sdkState(happy.page)).sends, 2, 'Resend requests a new SMS through the SDK fixture');
  await assertGuest(happy.page, happy.context);

  step = 'Firebase success with rejected backend proof cannot authenticate';
  fixture.rejectProof(true);
  await pasteCode(happy.page);
  await happy.page.getByRole('button', { name: 'Verify OTP', exact: true }).click();
  await happy.page.getByRole('alert').waitFor();
  assert(fixture.proofCalls() > 0, 'The frontend submits the Firebase proof to Talk');
  await assertGuest(happy.page, happy.context);

  step = 'verified backend proof creates the secure Talk session and dashboard';
  fixture.rejectProof(false);
  await happy.page.getByRole('button', { name: 'Complete sign-in', exact: true }).click();
  await happy.page.getByText('Phone Verified Successfully', { exact: true }).waitFor();
  await happy.page.clock.fastForward(2000);
  await happy.page.waitForURL('**/dashboard');
  await happy.page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  const authenticated = await session(happy.page);
  assert.equal(authenticated.user.provider, 'phone');
  assert.equal(authenticated.user.phoneNumber, testPhone);
  assert.equal(authenticated.requiresConfirmation, false);
  assert.equal(authenticated.user.emailVerified, false, 'A verified phone does not prove an email address');
  const cookie = (await happy.context.cookies()).find(item => item.name === 'talk_session');
  assert(cookie?.httpOnly && cookie.sameSite === 'Lax', 'Phone authentication reuses the HttpOnly Talk session');
  assert((await sdkState(happy.page)).signOuts > 0, 'Temporary Firebase credentials are cleared after exchange');
  await happy.page.reload();
  await happy.page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  assert.equal((await session(happy.page)).user.provider, 'phone');

  step = 'logout removes session and dashboard remains guarded';
  await happy.page.getByRole('button', { name: 'Sign out', exact: true }).first().click();
  await happy.page.waitForURL('**/sign-in');
  await assertGuest(happy.page, happy.context);
  await happy.page.goto(`${fixture.origin}/dashboard`);
  await happy.page.waitForURL('**/sign-in');
  await happy.context.close();

  assert.equal(errors.length, 0, 'Authentication pages must not raise browser exceptions');
  console.log('PASS Firebase phone browser flow: existing login/signup phone entry, India default, normal app-verification setting, consent/reCAPTCHA fixture, six-box focus/keyboard/paste, wrong/expired OTP, change-number cancellation, SMS-error recovery, resend cooldown, backend-proof guard, secure phone session, refresh/logout and dashboard guard; blank OTP/phone-entry desktop, 390px and 320px screenshots. Talk API/SQLite/cookies are real; Firebase SDK, tokens, reCAPTCHA and SMS were isolated fixtures. No real SMS was sent.');
} catch {
  console.error(`FAIL Firebase phone browser flow at: ${step}. Phone numbers, codes, tokens and credentials are withheld.`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await fixture?.close();
}
