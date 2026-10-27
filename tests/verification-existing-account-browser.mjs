import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import express from 'express';
import { chromium } from '@playwright/test';
import { localChrome } from '../scripts/browser-options.mjs';
import { createAuthApp } from '../backend/src/auth.mjs';

// Real built UI and backend; isolated in-memory DB and captured SMTP only.
// Never reads private configuration, contacts the public test, or logs secrets.
const frontend = path.resolve(process.env.TALK_RECOVERY_BUILD || 'frontend/dist');
const email = 'existing-verification-fixture@example.test';
const originalPassword = randomBytes(24).toString('base64url');
const replacementPassword = randomBytes(24).toString('base64url');
let clock = Date.now(), browser, step = 'setup';
const delivered = [], checks = {};
const app = express(), server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const auth = createAuthApp({ origins: [origin], now: () => clock,
  emailConfigured: true, sendVerification: async message => { delivered.push(message); } });
app.use(auth); app.use(express.static(frontend));
app.get('*', (_req, res) => res.sendFile(path.join(frontend, 'index.html')));
const check = (name, value) => { checks[name] = !!value; assert.ok(value, name); };
try {
  browser = await chromium.launch({ ...localChrome(), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.addInitScript(() => {
    window.__verificationPasswordSaves = 0;
    Object.defineProperty(window, 'PasswordCredential', { configurable: true, value: class { constructor() {} } });
    Object.defineProperty(navigator.credentials, 'store', { configurable: true, value: async () => { window.__verificationPasswordSaves++; } });
  });
  const post = (route, body, csrf) => context.request.post(origin + '/api/auth/' + route,
    { headers: { Origin: origin, 'X-CSRF-Token': csrf }, data: body });
  const page = await context.newPage();
  step = 'create verified fixture account';
  const config = await (await context.request.get(origin + '/api/auth/config')).json();
  const signup = await post('email/signup', { email, name: 'Fixture Member', password: originalPassword }, config.csrfToken);
  check('fixture_signup', signup.status() === 202);
  const pending = await signup.json();
  const verified = await post('email/verify', { code: delivered.at(-1).code }, pending.csrfToken);
  check('fixture_verification', verified.status() === 200);
  const session = await verified.json();
  check('fixture_logout', (await post('logout', {}, session.csrfToken)).status() === 200);
  clock += 60001;

  step = 'repeat signup through actual UI';
  await page.goto(origin + '/sign-up');
  await page.getByLabel('Full name', { exact: true }).fill('Replacement Fixture');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(replacementPassword);
  await page.getByLabel('Confirm password', { exact: true }).fill(replacementPassword);
  await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
  await page.waitForURL('**/verify-email');
  for (let index = 0; index < 6; index++) await page.getByRole('textbox', { name: `Verification digit ${index + 1}`, exact: true }).fill(delivered.at(-1).code[index]);
  const rejected = page.waitForResponse(response => response.url().endsWith('/api/auth/email/verify') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Verify Email', exact: true }).click();
  check('duplicate_account_protection', (await rejected).status() === 409);
  await page.getByRole('heading', { name: 'Sign in to continue', exact: true }).waitFor();
  check('recovery_link', await page.getByRole('link', { name: 'Go to sign in', exact: true }).count() === 1);
  check('consumed_otp_controls_removed', await page.getByRole('textbox', { name: /^Verification digit/ }).count() === 0
    && await page.getByRole('button', { name: /Resend OTP|Verify Email/ }).count() === 0);
  check('no_false_password_save', await page.evaluate(() => window.__verificationPasswordSaves) === 0);
  check('duplicate_otp_does_not_authenticate', (await (await context.request.get(origin + '/api/auth/session')).json()).user === null);
  check('consumed_challenge_removed', (await (await context.request.get(origin + '/api/auth/email/verification')).json()).verification === null);

  step = 'original password still authenticates';
  await page.getByRole('link', { name: 'Go to sign in', exact: true }).click();
  await page.waitForURL('**/sign-in');
  const fresh = await (await context.request.get(origin + '/api/auth/config')).json();
  check('replacement_password_rejected', (await post('email/login', { email, password: replacementPassword }, fresh.csrfToken)).status() === 401);
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(originalPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/dashboard');
  check('original_password_dashboard', (await (await context.request.get(origin + '/api/auth/session')).json()).user?.emailVerified === true);
  check('no_extra_mail_after_recovery', delivered.length === 2);
} catch {
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await auth.locals.closeAuthDatabase();
  const report = { passed: !process.exitCode, checks, ...(process.exitCode ? { failedStep: step } : {}),
    smtp: 'captured fixture only', privateAccountsChanged: false, publicRuntimeRestarted: false };
  await fs.mkdir('artifacts/qa', { recursive: true });
  await fs.writeFile('artifacts/qa/verification-existing-account-results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
