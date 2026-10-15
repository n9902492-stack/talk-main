import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import express from 'express';
import { chromium } from '@playwright/test';
import { createAuthApp } from '../server/auth.mjs';

// Real built frontend, auth API, cookies and database. The Google SDK/token
// verifier are isolated fixtures; this does not sign into a Google account.
const app = express();
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const auth = createAuthApp({
  clientId: 'talk-test.apps.googleusercontent.com', origins: [origin],
  verifyCredential: async credential => JSON.parse(credential),
});
app.use(auth);
app.use(express.static(path.resolve('dist')));
app.get('*', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
let browser;
let step = 'launch';
const errors = [];
try {
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
  // Google sign-in must never create or store an email/password credential.
  // Native password storage is isolated; only event counts are retained.
  await context.addInitScript(() => {
    window.__talkPasswordManagerCreates = 0;
    window.__talkPasswordManagerStores = 0;
    Object.defineProperty(window, 'PasswordCredential', { configurable: true, value: class {
      constructor() { window.__talkPasswordManagerCreates++; }
    } });
    Object.defineProperty(navigator.credentials, 'store', { configurable: true, value: () => {
      window.__talkPasswordManagerStores++;
      return Promise.resolve(null);
    } });
  });
  await context.route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'text/javascript', body: `
    let configuration;
    window.google = {accounts:{id:{
      initialize(config) { configuration = config; },
      disableAutoSelect() {},
      renderButton(host, options) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = 'Continue with Google';
        button.addEventListener('click', () => {
          const seconds = Math.floor(Date.now()/1000);
          configuration.callback({state:options.state, credential:JSON.stringify({
            iss:'https://accounts.google.com', aud:configuration.client_id,
            sub:'google-browser-fixture', name:'Talk Google Member',
            email:'google-browser@example.com', email_verified:true,
            iat:seconds, exp:seconds+3600, nonce:configuration.nonce
          })});
        });
        host.appendChild(button);
      }
    }}};
  ` }));
  const page = await context.newPage();
  page.on('pageerror', () => errors.push('pageerror'));
  const session = () => page.evaluate(async () => (await fetch('/api/auth/session', { credentials: 'same-origin' })).json());
  const assertNoPasswordSave = async () => assert.deepEqual(await page.evaluate(() => ({ creates: window.__talkPasswordManagerCreates, stores: window.__talkPasswordManagerStores })), { creates: 0, stores: 0 }, 'Google authentication must not invoke password saving');

  step = 'Google callback starts pending review';
  await page.goto(`${origin}/sign-in`);
  await page.locator('.google-signin-host').getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await page.waitForURL('**/confirm-sign-in');
  await page.getByRole('button', { name: 'Continue', exact: true }).waitFor();
  assert.equal((await session()).requiresConfirmation, true);
  await assertNoPasswordSave();
  assert.equal(await page.locator('.signin-confirmation-profile dt').first().innerText(), 'Talk Google Member');
  step = 'pending dashboard remains guarded on refresh';
  await page.goto(`${origin}/dashboard`);
  await page.waitForURL('**/confirm-sign-in');
  await page.getByRole('button', { name: 'Continue', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Overview', exact: true }).count(), 0);
  step = 'Continue confirms the real server session';
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForURL('**/dashboard');
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  assert.equal((await session()).requiresConfirmation, false);
  await assertNoPasswordSave();
  await page.reload();
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  await assertNoPasswordSave();
  assert.equal((await session()).requiresConfirmation, false);

  step = 'returning Google account can review again';
  await page.goto(`${origin}/choose-account`);
  await page.getByRole('link', { name: 'Continue as Talk Google Member', exact: true }).click();
  await page.waitForURL('**/confirm-sign-in');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForURL('**/dashboard');
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();

  step = 'Cancel invalidates a new pending sign-in';
  await page.goto(`${origin}/choose-account`);
  await page.locator('.google-signin-host').getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await page.waitForURL('**/confirm-sign-in');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForURL('**/choose-account');
  assert.equal((await session()).user, null);
  await assertNoPasswordSave();
  await page.goto(`${origin}/dashboard`);
  await page.waitForURL('**/sign-in');
  assert.equal(errors.length, 0);
  console.log('PASS Google confirmation real-API browser flow: pending review, dashboard guard, Continue, refresh, returning-account review, Cancel revocation and no password-manager calls. Google SDK/verifier and native password storage were fixtures; no Google account or SMTP used.');
} catch {
  console.error(`FAIL Google confirmation real-API browser flow at: ${step}. Credentials and tokens are withheld.`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  auth.locals.closeAuthDatabase();
}
