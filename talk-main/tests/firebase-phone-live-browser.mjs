import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { chromium } from '@playwright/test';

// Opt-in integration check against Firebase's configured fictional numbers.
// No SDK/token verifier is mocked. Test-only app verification accepts configured
// Firebase test numbers only, so this runner cannot request a real SMS.
// Never record traces, screenshots, request payloads, tokens, phone numbers or OTPs.
const env = parse(readFileSync(new URL('../.env.local', import.meta.url)));
const phone = env.FIREBASE_TEST_PHONE_NUMBER?.trim() || '';
const otp = env.FIREBASE_TEST_OTP?.trim() || '';
const origin = 'http://localhost:3001';
const country = env.FIREBASE_TEST_COUNTRY_CODE?.trim() || (phone.startsWith('+91') ? '+91' : phone.startsWith('+1') ? '+1' : '');
let browser;
let context;
let step = 'validate private local test configuration';
let serviceError = '';
let serverError = '';
let browserError = '';
let resendAt = 0;

function check(condition) { assert(condition, 'Integration check failed; private values withheld.'); }
async function session(page) {
  return page.evaluate(async () => (await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })).json());
}
async function pasteCode(page, code) {
  await page.getByRole('textbox', { name: 'Verification digit 1', exact: true }).evaluate((input, value) => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text', value);
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, code);
}
async function enterPhone(page, source) {
  step = `open ${source === '/sign-up' ? 'signup' : 'signin'} and select phone sign-in`;
  await page.goto(origin + source, { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: 'Continue with Phone Number', exact: true }).click();
  await page.waitForURL('**/phone-sign-in');
  step = 'confirm safe Firebase fictional-number mode before any request';
  await page.getByText('Firebase test phone numbers only. No SMS is sent.', { exact: true }).waitFor();
  check(await page.evaluate(async () => {
    const sdk = await import('/src/lib/firebase.ts');
    return sdk.isPhoneTestMode() && sdk.getPhoneFirebaseAuth().settings.appVerificationDisabledForTesting === true;
  }));
  step = 'load Firebase SDK and prepare the test-number form';
  await page.getByRole('textbox', { name: 'Country code', exact: true }).fill(country);
  await page.getByRole('textbox', { name: 'Mobile number', exact: true }).fill(phone.slice(country.length));
  await page.getByRole('checkbox').check();
  const send = page.getByRole('button', { name: 'Send OTP', exact: true });
  await send.waitFor();
  step = 'load Firebase test reCAPTCHA and request a fictional code';
  await send.click({ timeout: 30000 });
  step = 'Firebase accepts the fictional number and opens verification';
  await page.waitForURL('**/verify-phone', { timeout: 40000 });
  await page.getByRole('textbox', { name: 'Verification digit 1', exact: true }).waitFor();
  step = 'pending Firebase verification has no authenticated Talk user';
  check((await session(page)).user === null);
  step = 'pending Firebase verification has no Talk session cookie';
  check(!(await context.cookies()).some(cookie => cookie.name === 'talk_session'));
  step = 'pending Firebase verification respects the resend cooldown';
  // Firebase network latency may consume the cooldown before this page opens.
  if (resendAt > Date.now()) check(await page.getByRole('button', { name: /^Resend OTP/ }).isDisabled());
}
async function confirm(page) {
  await pasteCode(page, otp);
  await page.getByRole('button', { name: 'Verify OTP', exact: true }).click();
  await page.waitForURL('**/dashboard', { timeout: 40000 });
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  const current = await session(page);
  check(current.user?.provider === 'phone' && current.user.phoneNumber === phone && current.user.hasPhone === true);
  check(current.user.emailVerified === false && current.requiresConfirmation === false);
  const cookie = (await context.cookies()).find(item => item.name === 'talk_session');
  check(cookie?.httpOnly && cookie.sameSite === 'Lax' && cookie.path === '/api/auth');
  check(await page.evaluate(async () => {
    const sdk = await import('/src/lib/firebase.ts');
    const stored = [...Object.keys(localStorage), ...Object.keys(sessionStorage)];
    return !sdk.peekPhoneFirebaseAuth()?.currentUser && !stored.some(key => key.startsWith('firebase:'));
  }));
  return current.user.id;
}

try {
  check(/^\+[1-9]\d{7,14}$/.test(phone) && /^\d{6}$/.test(otp));
  check(country && phone.startsWith(country));
  check(env.VITE_FIREBASE_PHONE_TESTING === 'true');
  step = 'launch isolated browser in fictional-number mode';
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', failure => {
    if (typeof failure.code === 'string' && /^(auth|app)\/[a-z-]{3,60}$/.test(failure.code)) browserError = failure.code;
  });
  page.on('response', async response => {
    // Retain only short machine-readable categories, never raw API errors.
    try {
      const url = new URL(response.url());
      if (url.hostname === 'identitytoolkit.googleapis.com' && response.status() >= 400) {
        const body = await response.json();
        const code = String(body.error?.message || '').split(/[ :]/)[0];
        if (/^[A-Z_]{3,60}$/.test(code)) serviceError = code;
      }
      if (url.origin === origin && url.pathname.startsWith('/api/auth/phone/')) {
        const body = await response.json();
        if (typeof body.challenge?.resendAt === 'string') resendAt = Date.parse(body.challenge.resendAt);
        if (response.status() >= 400 && /^[a-z_]{3,60}$/.test(body.error || '')) serverError = body.error;
      }
    } catch { /* Nothing from the response is logged. */ }
  });

  step = 'Firebase test-number request from signup';
  await enterPhone(page, '/sign-up');
  console.log('PASS Firebase accepted the configured fictional number; verification page and unauthenticated dashboard guard are active. No SMS sent.');
  step = 'incorrect Firebase OTP remains signed out';
  const wrong = String((Number(otp[0]) + 1) % 10) + otp.slice(1);
  await pasteCode(page, wrong);
  await page.getByRole('button', { name: 'Verify OTP', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'That code is incorrect.' }).waitFor({ timeout: 25000 });
  check((await session(page)).user === null);
  console.log('PASS Firebase rejected an incorrect test code; no Talk session was created.');
  serviceError = ''; serverError = '';
  step = 'correct Firebase OTP exchanges for a secure Talk session';
  const firstId = await confirm(page);
  console.log('PASS Correct Firebase test code, real ID-token signature verification, secure Talk session and dashboard.');
  step = 'dashboard refresh preserves the authenticated session';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  check((await session(page)).user.id === firstId);
  step = 'signout revokes the Talk session and guards dashboard';
  await page.getByRole('button', { name: 'Open account menu', exact: true }).click();
  await page.locator('.dashboard-account-menu').getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.waitForURL('**/sign-in');
  step = 'signed-out server session contains no user';
  check((await session(page)).user === null);
  step = 'signout clears the HttpOnly Talk session cookie';
  check(!(await context.cookies()).some(cookie => cookie.name === 'talk_session'));
  step = 'signed-out direct dashboard navigation returns to signin';
  await page.goto(origin + '/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/sign-in');
  console.log('PASS Dashboard refresh and signout; direct dashboard access is blocked after logout.');

  step = 'respect the server resend cooldown before returning login';
  const delay = Math.max(0, resendAt - Date.now() + 1200);
  check(delay <= 62000);
  if (delay > 0) {
    console.log('Waiting for the enforced 60-second resend cooldown before testing returning login.');
    // Short waits let the runner report progress; time is never fast-forwarded.
    const until = Date.now() + delay;
    while (Date.now() < until) await new Promise(resolve => setTimeout(resolve, Math.min(10000, until - Date.now())));
  }
  step = 'returning Firebase phone login';
  await enterPhone(page, '/sign-in');
  check(await confirm(page) === firstId);
  console.log('PASS Returning Firebase phone login restores the same Talk account.');
  step = 'preserve existing email and Google provider availability';
  check(await page.evaluate(async () => {
    const email = await (await fetch('/api/auth/email/config')).json();
    const google = await (await fetch('/api/auth/config')).json();
    return email.configured === true && google.configured === true;
  }));
  console.log('PASS Email OTP and Google sign-in remain configured.');
  console.log('PASS Complete real-Firebase fictional-number signup/login check. No SDK/verifier simulation, SMTP email or real SMS was used.');
} catch (failure) {
  console.error(`FAIL Firebase fictional-number integration at: ${step}. Private test values and tokens withheld.`);
  if (failure?.name === 'TimeoutError') console.error('Browser category: wait_timeout');
  if (typeof failure?.message === 'string' && failure.message.includes('strict mode violation')) console.error('Browser category: ambiguous_test_selector');
  try {
    const text = await context?.pages()[0]?.locator('.auth-email-help[role="status"]').allTextContents();
    const categories = [
      ['Could not contact the SMS service.', 'sms_service_unreachable'],
      ['The security check expired', 'security_check_expired'],
      ['Phone verification could not be completed.', 'sdk_verifier_unavailable'],
      ['SMS sign-in is unavailable', 'firebase_project_configuration'],
      ['Phone verification is not allowed', 'firebase_authorized_domain'],
    ];
    for (const [message, category] of categories) if (text?.some(value => value.includes(message))) console.error(`UI category: ${category}`);
  } catch { /* Keep private page content out of diagnostics. */ }
  if (browserError) console.error(`SDK category: ${browserError}`);
  if (serviceError) console.error(`Firebase category: ${serviceError}`);
  if (serverError) console.error(`Talk category: ${serverError}`);
  process.exitCode = 1;
} finally {
  // End the test session without leaving a browser signed into the account.
  try {
    const page = context?.pages()[0];
    if (page && !page.isClosed()) await page.evaluate(async () => {
      const data = await (await fetch('/api/auth/session')).json();
      if (data.user && data.csrfToken) await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': data.csrfToken }, body: '{}' });
    });
  } catch { /* No secret-bearing cleanup errors are printed. */ }
  await browser?.close();
}
