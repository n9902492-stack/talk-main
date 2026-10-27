import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { schedulingHarness } from './helpers/scheduling.mjs';
import { localChrome } from '../scripts/browser-options.mjs';

// Loopback-only UI checks. External identity, email and calendar requests are blocked.
const h = await schedulingHarness({ frontendBuild: process.env.TALK_TEST_FRONTEND_BUILD || 'artifacts/qa/five-user-build', transportEnabled: false });
const report = { passed: false, checks: [], browserErrors: [], emailsSent: 0, publicExposureChanged: false };
let browser;
try {
  browser = await chromium.launch({ ...localChrome(), headless: true });
  const context = await browser.newContext();
  await context.route('**/*', route => new URL(route.request().url()).origin === h.origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => report.browserErrors.push(error.message));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const route of ['/sign-in', '/sign-up']) {
      await page.goto(h.origin + route);
      await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
      await expect(page.locator('.google-signin')).toHaveAttribute('data-status', 'error', { timeout: 15000 });
      assert.ok(await page.locator('.auth-entry-providers').evaluate(node => node.getBoundingClientRect().width >= 240), 'Provider error and retry must have readable width');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: `artifacts/qa/five-user-${route.slice(1)}-${width}.png`, fullPage: true });
    }
    report.checks.push(`Login and signup render at ${width}px without horizontal overflow`);
  }
  // A local SDK fixture also checks the normal icon layout; no provider login.
  await context.route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'text/javascript', body: `window.google={accounts:{id:{initialize(){},disableAutoSelect(){},renderButton(host){const b=document.createElement('button');b.type='button';b.textContent='G';b.setAttribute('aria-label','Continue with Google');b.style.cssText='width:40px;height:40px';host.replaceChildren(b)}}}};` }));
  await page.goto(h.origin + '/sign-in');
  await expect(page.locator('.google-signin')).toHaveAttribute('data-status', 'ready');
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
  assert.ok(await page.locator('.auth-entry-providers').evaluate(node => node.getBoundingClientRect().width <= 80));
  report.checks.push('Mock ready Google provider retains its compact mobile icon layout; real provider authentication not tested');
  const host = await h.account('LocalNavigationFixture');
  await context.addCookies([...host.jar].map(([name, value]) => ({ name, value, url: h.origin + '/api/auth', httpOnly: true, sameSite: 'Lax' })));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(h.origin + '/dashboard');
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
    for (const [label, heading] of [['Bookings', 'Bookings'], ['Meetings', 'Meetings'], ['Overview', /Welcome back/]]) {
      if (width === 390) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('link', { name: label, exact: true }).click();
      await expect(page.getByRole('heading', { name: heading, exact: typeof heading === 'string' })).toBeVisible();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    report.checks.push(`Actual sidebar navigation opens Bookings, Meetings and Overview at ${width}px`);
  }
  assert.deepEqual(report.browserErrors, []);
  assert.equal(h.outbox.length, 0);
  assert.equal(h.codes.length, 0);
  report.passed = true;
  console.log('PASS local login/signup and actual desktop/mobile sidebar navigation; external requests blocked, no email.');
} catch (error) {
  report.failureDetail = String(error.message).slice(0, 1400);
  console.error('FAIL local page rendering: ' + report.failureDetail);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await h.close();
  fs.writeFileSync('artifacts/qa/five-user-pages-browser.json', JSON.stringify(report, null, 2));
}
