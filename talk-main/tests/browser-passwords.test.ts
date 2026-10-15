import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { clearPendingPassword, offerToSavePassword, saveVerifiedPassword, stagePasswordForVerification } from '../src/lib/browserPasswords';
import type { AuthUser } from '../src/lib/auth';

// All values here are disposable fixtures. Assertions deliberately compare
// credentials as booleans, so a failing test never prints a password object.
const email = 'password-fixture@example.com';
const firstPassword = 'fixture-password-one';
const secondPassword = 'fixture-password-two';
const challengeToken = 'fixture-verification-challenge';
const user: AuthUser = { id: 'email_fixture', name: 'Password fixture', email, provider: 'email', hasPassword: true, emailVerified: true };
type NativeCredential = { id: string; password: string; name?: string; type: string };
type ScheduledTimer = { callback: () => void; delay: number };

let windowDescriptor: PropertyDescriptor | undefined;
let navigatorDescriptor: PropertyDescriptor | undefined;
let originalDateNow: typeof Date.now;
let browserWindow: Record<string, unknown>;
let browserNavigator: { credentials?: { store: (credential: NativeCredential) => unknown } };
let stored: NativeCredential[];
let timers: Map<number, ScheduledTimer>;
let nextTimer: number;

class FixturePasswordCredential implements NativeCredential {
  readonly type = 'password';
  readonly id: string;
  readonly password: string;
  readonly name?: string;
  constructor(value: { id: string; password: string; name?: string }) {
    this.id = value.id; this.password = value.password; this.name = value.name;
  }
}

function context(purpose: 'signup' | 'login' | 'link' = 'signup', token = challengeToken, address = email) {
  return {
    csrfToken: token,
    verification: { email: address, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), resendAt: new Date(Date.now() + 60_000).toISOString(), purpose },
  };
}

function assertStored(expectedPassword: string, expectedEmail = email) {
  assert.equal(stored.length, 1, 'One browser save request should be made.');
  assert.equal(stored[0].type === 'password', true, 'The browser should receive a password credential.');
  assert.equal(stored[0].id === expectedEmail, true, 'The browser credential should belong to the verified email.');
  assert.equal(stored[0].password === expectedPassword, true, 'The browser credential should use the authenticated password.');
}

beforeEach(() => {
  clearPendingPassword();
  windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  originalDateNow = Date.now;
  stored = []; timers = new Map(); nextTimer = 0;
  browserWindow = {
    isSecureContext: true,
    PasswordCredential: FixturePasswordCredential,
    setTimeout(callback: () => void, delay: number) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id: number) { timers.delete(id); },
  };
  browserNavigator = { credentials: { store(credential) { stored.push(credential); return Promise.resolve(credential); } } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browserWindow });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: browserNavigator });
  clearPendingPassword();
});

afterEach(() => {
  clearPendingPassword(); Date.now = originalDateNow;
  if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
  else Reflect.deleteProperty(globalThis, 'window');
  if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
  else Reflect.deleteProperty(globalThis, 'navigator');
  stored.length = 0;
});

test('verified email login offers the matching credential immediately', () => {
  offerToSavePassword(`  ${email.toUpperCase()}  `, firstPassword, user);
  assertStored(firstPassword);
});

test('direct saving rejects unverified, passwordless, Google-only, and mismatched profiles', () => {
  offerToSavePassword(email, firstPassword, { ...user, emailVerified: false });
  offerToSavePassword(email, firstPassword, { ...user, hasPassword: false });
  offerToSavePassword(email, firstPassword, { ...user, provider: 'google' });
  offerToSavePassword(email, firstPassword, { ...user, email: 'other-fixture@example.com' });
  assert.equal(stored.length, 0, 'An unrelated or unverified profile must not produce a browser save request.');
});

test('signup defers saving until successful verification and consumes the credential once', () => {
  stagePasswordForVerification(email, firstPassword, context(), 'signup');
  assert.equal(stored.length, 0, 'Sending a verification email is not successful authentication.');
  saveVerifiedPassword(user, challengeToken);
  assertStored(firstPassword);
  saveVerifiedPassword(user, challengeToken);
  assert.equal(stored.length, 1, 'A completed verification must not offer the same pending credential twice.');
  assert.equal(timers.size, 0, 'Consumed credentials must release their expiry timer.');
});

test('resumed unverified login stages only a login challenge', () => {
  stagePasswordForVerification(email, firstPassword, context('login'), 'login');
  assert.equal(stored.length, 0);
  saveVerifiedPassword(user, challengeToken);
  assertStored(firstPassword);
});

test('resuming the same signup challenge preserves its originally staged password', () => {
  stagePasswordForVerification(email, firstPassword, context('signup'), 'signup');
  stagePasswordForVerification(email, secondPassword, context('signup'), 'login');
  saveVerifiedPassword(user, challengeToken);
  assertStored(firstPassword);
});

test('login cannot invent a password candidate for an existing signup challenge', () => {
  stagePasswordForVerification(email, secondPassword, context('signup'), 'login');
  saveVerifiedPassword(user, challengeToken);
  assert.equal(stored.length, 0, 'The login password may differ from the signup challenge staged on the server.');
});

test('a changed signup challenge clears a candidate left from the previous challenge', () => {
  stagePasswordForVerification(email, firstPassword, context('signup'), 'signup');
  stagePasswordForVerification(email, secondPassword, context('signup', 'different-fixture-challenge'), 'login');
  saveVerifiedPassword(user, challengeToken);
  saveVerifiedPassword(user, 'different-fixture-challenge');
  assert.equal(stored.length, 0, 'Cross-tab replacement must never save a stale password.');
});

test('explicit password linking saves only after OTP success even with a Google session', () => {
  stagePasswordForVerification(email, firstPassword, context('link'), 'link');
  assert.equal(stored.length, 0);
  saveVerifiedPassword({ ...user, provider: 'google' }, challengeToken);
  assertStored(firstPassword);
});

test('verification requires the original challenge token and clears a mismatched candidate', () => {
  stagePasswordForVerification(email, firstPassword, context(), 'signup');
  saveVerifiedPassword(user, 'different-fixture-challenge');
  saveVerifiedPassword(user, challengeToken);
  assert.equal(stored.length, 0, 'A verified user alone does not prove which pending password was accepted.');
});

test('verification rejects a different email and discards the old candidate', () => {
  stagePasswordForVerification(email, firstPassword, context(), 'signup');
  saveVerifiedPassword({ ...user, email: 'other-fixture@example.com' }, challengeToken);
  saveVerifiedPassword(user, challengeToken);
  assert.equal(stored.length, 0, 'An OTP success for another account must not save this password.');
});

test('verification rejects profiles whose password or email is not verified', () => {
  stagePasswordForVerification(email, firstPassword, context(), 'signup');
  saveVerifiedPassword({ ...user, emailVerified: false }, challengeToken);
  assert.equal(stored.length, 0);
  stagePasswordForVerification(email, firstPassword, context(), 'signup');
  saveVerifiedPassword({ ...user, hasPassword: false }, challengeToken);
  assert.equal(stored.length, 0);
});

test('staging requires matching email, purpose, and a nonempty challenge token', () => {
  stagePasswordForVerification(email, firstPassword, context('signup', ''), 'signup');
  saveVerifiedPassword(user, challengeToken);
  stagePasswordForVerification(email, firstPassword, context('signup', challengeToken, 'other-fixture@example.com'), 'signup');
  saveVerifiedPassword(user, challengeToken);
  stagePasswordForVerification(email, firstPassword, context('link'), 'signup');
  saveVerifiedPassword(user, challengeToken);
  assert.equal(stored.length, 0, 'Invalid pending context must not create a save candidate.');
});

test('clearing pending credentials prevents saving and releases the timer', () => {
  stagePasswordForVerification(email, firstPassword, context(), 'signup');
  clearPendingPassword();
  saveVerifiedPassword(user, challengeToken);
  assert.equal(stored.length, 0);
  assert.equal(timers.size, 0, 'Cancellation must release retained credential and timer references.');
});

test('the pending credential lifetime is capped at ten minutes', () => {
  stagePasswordForVerification(email, firstPassword, context(), 'signup');
  assert.equal(timers.size, 1, 'Only one pending credential may be retained.');
  const timer = [...timers.values()][0];
  assert.equal(timer.delay > 0 && timer.delay <= 10 * 60_000, true, 'A resend must not extend password retention beyond ten minutes.');
  timer.callback();
  saveVerifiedPassword(user, challengeToken);
  assert.equal(stored.length, 0, 'Expired pending credentials must not be saved.');
});

test('a suspended timer cannot allow saving beyond the local deadline', () => {
  const start = Date.now();
  Date.now = () => start;
  stagePasswordForVerification(email, firstPassword, context(), 'signup');
  Date.now = () => start + 10 * 60_000 + 1;
  saveVerifiedPassword(user, challengeToken);
  assert.equal(stored.length, 0, 'Background-tab timer throttling must not extend credential lifetime.');
});

test('new staging replaces the previous pending credential without retaining extra timers', () => {
  stagePasswordForVerification(email, firstPassword, context(), 'signup');
  stagePasswordForVerification(email, secondPassword, context('signup', 'new-fixture-challenge'), 'signup');
  assert.equal(timers.size, 1);
  saveVerifiedPassword(user, 'new-fixture-challenge');
  assertStored(secondPassword);
});

test('unsupported and insecure browsers gracefully skip password-manager requests', () => {
  Reflect.deleteProperty(browserWindow, 'PasswordCredential');
  assert.doesNotThrow(() => offerToSavePassword(email, firstPassword, user));
  stagePasswordForVerification(email, firstPassword, context(), 'signup');
  browserWindow.PasswordCredential = FixturePasswordCredential;
  saveVerifiedPassword(user, challengeToken);
  assert.equal(stored.length, 0, 'Unsupported browsers must not retain an application password fallback.');
  browserWindow.isSecureContext = false;
  assert.doesNotThrow(() => offerToSavePassword(email, firstPassword, user));
  assert.equal(stored.length, 0);
  browserWindow.isSecureContext = true;
  browserNavigator.credentials = undefined;
  assert.doesNotThrow(() => offerToSavePassword(email, firstPassword, user));
});

test('constructor and synchronous store failures never escape into authentication', () => {
  browserWindow.PasswordCredential = class { constructor() { throw new Error('fixture constructor refused'); } };
  assert.doesNotThrow(() => offerToSavePassword(email, firstPassword, user));
  browserWindow.PasswordCredential = FixturePasswordCredential;
  browserNavigator.credentials!.store = () => { throw new Error('fixture browser refused'); };
  assert.doesNotThrow(() => offerToSavePassword(email, firstPassword, user));
  stagePasswordForVerification(email, firstPassword, context(), 'signup');
  assert.doesNotThrow(() => saveVerifiedPassword(user, challengeToken));
  assert.equal(timers.size, 0, 'The candidate must be consumed even when native saving fails.');
});

test('rejected browser save promises are handled without an unhandled rejection', async () => {
  browserNavigator.credentials!.store = () => Promise.reject(new Error('fixture browser refused'));
  assert.doesNotThrow(() => offerToSavePassword(email, firstPassword, user));
  stagePasswordForVerification(email, firstPassword, context(), 'signup');
  assert.doesNotThrow(() => saveVerifiedPassword(user, challengeToken));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(timers.size, 0);
});

test('a browser save request waiting for user choice returns control immediately', () => {
  browserNavigator.credentials!.store = credential => { stored.push(credential); return new Promise(() => {}); };
  const direct = offerToSavePassword(email, firstPassword, user);
  assert.equal(direct, undefined, 'Dashboard navigation must not wait for a password-manager decision.');
  assertStored(firstPassword);
  stored.length = 0;
  stagePasswordForVerification(email, secondPassword, context(), 'signup');
  const verified = saveVerifiedPassword(user, challengeToken);
  assert.equal(verified, undefined, 'OTP completion must not wait for a password-manager decision.');
  assertStored(secondPassword);
  assert.equal(timers.size, 0);
});
