import { localChrome } from '../scripts/browser-options.mjs';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import express from 'express';
import { chromium } from '@playwright/test';
import { createAuthApp } from '../backend/src/auth.mjs';

// Virtual HTTPS Hosting transport -> real local Talk API/SQLite. The proxy
// forwards ONLY __session, matching Hosting's documented cookie restriction.
// No external network, real Google account, SMTP delivery or SMS is used.
const publicOrigin = 'https://talk-fc3dc.web.app';
const delivered = [];
const app = express();
const auth = createAuthApp({ clientId: 'talk-fixture.apps.googleusercontent.com', origins: [publicOrigin],
  secureCookies: true, cookieMode: 'hosting', cookieSecret: randomBytes(32).toString('base64url'),
  verifyCredential: async value => JSON.parse(value), emailConfigured: true,
  sendVerification: async mail => { delivered.push(mail); },
});
app.use(auth); app.use(express.static(path.resolve('frontend/dist')));
app.get('*', (_req, res) => res.sendFile(path.resolve('frontend/dist/index.html')));
const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
const localOrigin = `http://127.0.0.1:${server.address().port}`;
let browser; let step = 'start Hosting cookie browser harness';
try {
  browser = await chromium.launch({ ...localChrome(), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => Object.defineProperty(window, 'PasswordCredential', { configurable: true, value: undefined }));
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === publicOrigin) {
      const headers = { ...request.headers() }; delete headers.host;
      headers.cookie = (headers.cookie || '').split(';').map(item => item.trim()).filter(item => item.startsWith('__session=')).join('; ');
      const response = await fetch(localOrigin + url.pathname + url.search, { method: request.method(), headers, body: request.postDataBuffer() || undefined });
      const outgoing = Object.fromEntries(response.headers); delete outgoing['content-encoding']; delete outgoing['content-length'];
      const cookies = response.headers.getSetCookie();
      if (cookies.length) { assert.equal(cookies.length, 1); assert.match(cookies[0], /^__session=/); outgoing['set-cookie'] = cookies[0]; }
      return route.fulfill({ status: response.status, headers: outgoing, body: Buffer.from(await response.arrayBuffer()) });
    }
    if (url.href === 'https://accounts.google.com/gsi/client') return route.fulfill({ contentType: 'text/javascript', body: `
      let config;
      window.google={accounts:{id:{initialize(value){config=value},disableAutoSelect(){},renderButton(host,options){
        const button=document.createElement('button');button.type='button';button.textContent='Continue with Google';
        button.onclick=()=>{const seconds=Math.floor(Date.now()/1000);config.callback({state:options.state,credential:JSON.stringify({
          iss:'https://accounts.google.com',aud:config.client_id,sub:'hosting-google-fixture',name:'Hosting Google Fixture',
          email:'hosting-google@example.com',email_verified:true,iat:seconds,exp:seconds+3600,nonce:config.nonce
        })})};host.appendChild(button)
      }}}};` });
    return route.abort();
  });
  const page = await context.newPage();
  const session = () => page.evaluate(async () => (await fetch('/api/auth/session')).json());
  step = 'email signup across concurrent session/config requests';
  await page.goto(publicOrigin + '/sign-up');
  await page.getByRole('textbox', { name: 'Full name', exact: true }).fill('Hosting Email Fixture');
  await page.getByRole('textbox', { name: 'Email address', exact: true }).fill('hosting-email@example.com');
  await page.getByLabel('Password', { exact: true }).fill('hosting-browser-fixture-password');
  await page.getByLabel('Confirm password', { exact: true }).fill('hosting-browser-fixture-password');
  await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
  await page.waitForURL('**/verify-email');
  assert.equal((await session()).user, null);
  for (let i = 0; i < 6; i++) await page.getByRole('textbox', { name: `Verification digit ${i + 1}`, exact: true }).fill(delivered.at(-1).code[i]);
  await page.getByRole('button', { name: 'Verify Email', exact: true }).click();
  await page.waitForURL('**/dashboard'); await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  const first = (await session()).user.id;
  const cookies = await context.cookies();
  assert(cookies.some(cookie => cookie.name === '__session' && cookie.httpOnly && cookie.secure && cookie.sameSite === 'Lax'));
  assert(!cookies.some(cookie => cookie.name.startsWith('talk_')));
  step = 'Hosting session survives refresh, logout and password login';
  await page.reload(); await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Sign out', exact: true }).first().click(); await page.waitForURL('**/sign-in');
  assert.equal((await session()).user, null);
  await page.getByRole('textbox', { name: 'Email address', exact: true }).fill('hosting-email@example.com');
  await page.getByLabel('Password', { exact: true }).fill('hosting-browser-fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.waitForURL('**/dashboard');
  assert.equal((await session()).user.id, first);
  await page.getByRole('button', { name: 'Sign out', exact: true }).first().click(); await page.waitForURL('**/sign-in');
  step = 'Google callback and confirmation share the Hosting cookie envelope';
  await page.locator('.google-signin-host').getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await page.waitForURL('**/confirm-sign-in');
  assert.equal((await session()).requiresConfirmation, true);
  await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.waitForURL('**/dashboard');
  assert.equal((await session()).user.provider, 'google');
  await page.getByRole('button', { name: 'Sign out', exact: true }).first().click(); await page.waitForURL('**/sign-in');
  await page.goto(publicOrigin + '/dashboard'); await page.waitForURL('**/sign-in');
  console.log('PASS Hosting-compatible browser signup/email OTP/password login/Google confirmation, secure single cookie, refresh/logout and dashboard guard. HTTPS proxy, Google verifier and SMTP were fixtures; Talk API/SQLite/browser cookies were real. No external email or SMS sent.');
} catch {
  console.error(`FAIL Hosting cookie browser flow at: ${step}. Credentials and tokens withheld.`); process.exitCode = 1;
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); auth.locals.closeAuthDatabase();
}
