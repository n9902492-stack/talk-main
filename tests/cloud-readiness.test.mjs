import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checks, inspectCloud, summarizePhoneConfig } from '../scripts/inspect-cloud-readiness.mjs';

const number = '+12025550199'; // Reserved fictional NANP range; never submitted to Firebase.
// Inspection never uses a code. A non-code sentinel tests redaction without
// embedding a potentially configured six-digit development credential.
const codeSentinel = 'fixture-code-private';
const data = () => ({ signIn: { phoneNumber: { enabled: true, testPhoneNumbers: { [number]: codeSentinel } } },
  authorizedDomains: ['talk-fc3dc.web.app'], smsRegionConfig: { allowlistOnly: { allowedRegions: ['IN'] } } });

test('phone inspection distinguishes fictional numbers without exposing numbers or fixed codes', () => {
  const result = summarizePhoneConfig(data(), number);
  assert.equal(result.personalNumberIsFictional, true);
  assert.equal(result.indiaAllowed, true);
  assert.equal(result.phoneProviderEnabled, true);
  assert.equal(summarizePhoneConfig(data(), '+919000000002').personalNumberIsFictional, false);
  assert.equal(summarizePhoneConfig(data()).personalNumberIsFictional, null);
  assert(!JSON.stringify(result).includes(number));
  assert(!JSON.stringify(result).includes(codeSentinel));
});

test('SMS region inspection handles allowlist, denylist and unknown policy conservatively', () => {
  assert.equal(summarizePhoneConfig({ smsRegionConfig: { allowlistOnly: {} } }).indiaAllowed, false);
  assert.equal(summarizePhoneConfig({ smsRegionConfig: { allowByDefault: { disallowedRegions: ['IN'] } } }).indiaAllowed, false);
  assert.equal(summarizePhoneConfig({ smsRegionConfig: { allowByDefault: {} } }).indiaAllowed, true);
  assert.equal(summarizePhoneConfig({}).indiaAllowed, null);
});

test('cloud inspection performs fixed metadata GETs only and never returns credentials or provider payloads', async () => {
  const requests = [];
  const results = await inspectCloud({ token: 'fixture-token-private', personalNumber: number, fetcher: async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ ...data(), privateField: 'fixture-secret-private' }) };
  } });
  assert.equal(requests.length, checks.length);
  for (const { url, options } of requests) {
    assert.equal(options.method, 'GET');
    assert.equal(options.headers['x-goog-user-project'], new URL(url).hostname === 'cloudbilling.googleapis.com' ? undefined : 'talk-fc3dc');
    assert.equal(options.redirect, 'error');
    assert(!/sendVerificationCode|:access|:enable|accounts:|\/users/.test(url));
  }
  const serialized = JSON.stringify(results);
  for (const privateValue of ['fixture-token-private', 'fixture-secret-private', number, codeSentinel]) assert(!serialized.includes(privateValue));
});

test('permission/network errors remain unverified, never claim missing resources or leak raw errors', async () => {
  const denied = await inspectCloud({ token: 'fixture', fetcher: async () => ({ ok: false, status: 403 }) });
  assert(denied.every(result => result.state === 'unverified'));
  const missing = await inspectCloud({ token: 'fixture', fetcher: async () => ({ ok: false, status: 404 }) });
  assert(missing.every(result => result.state === 'missing'));
  const failed = await inspectCloud({ token: 'fixture', fetcher: async () => { throw new Error('private-provider-payload'); } });
  assert(failed.every(result => result.state === 'unverified'));
  assert(!JSON.stringify(failed).includes('private-provider-payload'));
  const disabled = await inspectCloud({ token: 'fixture', fetcher: async () => ({ ok: false, status: 403,
    json: async () => ({ error: { message: 'private-provider-payload', details: [{ reason: 'SERVICE_DISABLED', metadata: { private: number } }] } }) }) });
  assert(disabled.every(result => result.state === 'unverified' && result.reasons[0] === 'SERVICE_DISABLED'));
  assert(!JSON.stringify(disabled).includes('private-provider-payload'));
  assert(!JSON.stringify(disabled).includes(number));
});
