// Public-origin rendering only. No account login, email/OTP or media publication.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { localChrome } from '../scripts/browser-options.mjs';
const launch = JSON.parse(fs.readFileSync('artifacts/qa/five-user-public-launch.json'));
const state = JSON.parse(fs.readFileSync(launch.serverState));
assert.equal(state.status, 'READY'); assert.equal(state.launchId, launch.id);
const report = { passed: false, origin: state.origin, checks: [], browserErrors: [], emailSent: 0, otpSent: 0, realAccountsAuthenticated: 0, publicMedia: 'NOT_TESTED' };
let browser, step = 'browser startup';
try {
  browser = await chromium.launch({ ...localChrome(), headless: true });
  report.browser = { engine: 'Chromium/Chrome', version: browser.version(), platform: 'Local Windows headless automation', realExternalDevice: false, hardwareMediaRequested: false };
  const context = await browser.newContext();
  await context.route('**/*', r => new URL(r.request().url()).origin === state.origin ? r.continue() : r.abort());
  const page = await context.newPage(); page.on('pageerror', e => report.browserErrors.push(e.name));
  for (const width of [1440, 390]) {
    step = 'public sign-in and signup at ' + width;
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const route of ['/sign-in', '/sign-up']) { await page.goto(state.origin + route); await expect(page.getByLabel('Email address', { exact: true })).toBeVisible({ timeout: 20000 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); }
    await page.goto(state.origin + '/sign-in');
    await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
    report.browser.capabilities = await page.evaluate(async () => {
      const query = async name => { try { return (await navigator.permissions.query({ name })).state; } catch { return 'not-queryable'; } };
      const policy = document.permissionsPolicy || document.featurePolicy;
      return { secureContext: isSecureContext, cameraApi: typeof navigator.mediaDevices?.getUserMedia === 'function', screenCaptureApi: typeof navigator.mediaDevices?.getDisplayMedia === 'function', cameraPermission: await query('camera'), microphonePermission: await query('microphone'), cameraPolicyAllowed: policy?.allowsFeature('camera') ?? null, microphonePolicyAllowed: policy?.allowsFeature('microphone') ?? null, screenCapturePolicyAllowed: policy?.allowsFeature('display-capture') ?? null };
    });
    assert.equal(report.browser.capabilities.secureContext, true);
    assert.equal(report.browser.capabilities.cameraApi, true);
    assert.equal(report.browser.capabilities.screenCaptureApi, true);
    await page.screenshot({ path: `artifacts/qa/five-user-public-signin-${width}.png`, fullPage: true });
    report.checks.push('HTTPS login/signup render without overflow at ' + width + 'px');
  }
  step = 'protected workspace routes';
  for (const route of ['/dashboard', '/bookings', '/meetings']) { await page.goto(state.origin + route); await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible(); assert.equal(new URL(page.url()).pathname, '/sign-in'); }
  report.checks.push('Anonymous dashboard, Bookings and Meetings navigate to normal sign-in');
  step = 'private signed confirmation';
  const privateLink = JSON.parse(fs.readFileSync(path.join(launch.directory, 'confirmation-link.private.json'))).joiningUrl;
  await page.goto(privateLink);
  await expect(page.getByRole('heading', { name: 'Talk Five-User Synthetic Booking', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Booking confirmed', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to calendar', exact: true })).toBeVisible();
  assert.equal(new URL(page.url()).hash, '');
  await page.reload(); await expect(page.getByRole('heading', { name: 'Booking confirmed', exact: true })).toBeVisible();
  report.checks.push('Actual signed confirmation renders and survives reload; private credential removed from browser address bar');
  assert.deepEqual(report.browserErrors, []); report.passed = true;
  console.log('PASS public HTTPS desktop/mobile login/signup, protected-route redirects and signed confirmation rendering; no emails or real-account login.');
} catch { report.failedAt = step; console.error('Public browser check stopped at ' + step + '. Private URL and identity withheld.'); process.exitCode = 1; }
finally { await browser?.close(); fs.writeFileSync('artifacts/qa/five-user-public-browser.json', JSON.stringify(report, null, 2)); }
