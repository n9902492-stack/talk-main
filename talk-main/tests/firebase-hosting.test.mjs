import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { backendChecks, inspectBuild, projectRoot, validateHosting } from '../scripts/hosting-preflight.mjs';

const config = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url)));
const aliases = JSON.parse(readFileSync(new URL('../.firebaserc', import.meta.url)));
const env = {
  VITE_FIREBASE_API_KEY: 'fixture-public-key', VITE_FIREBASE_AUTH_DOMAIN: 'talk-fc3dc.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'talk-fc3dc', VITE_FIREBASE_APP_ID: 'fixture-public-app', VITE_FIREBASE_PHONE_TESTING: 'false',
};
const input = () => ({ config: structuredClone(config), aliases: structuredClone(aliases), env: { ...env }, readiness: Object.fromEntries(backendChecks.map(([key]) => [key, false])) });

test('Hosting frontend preparation targets dist, reserves API before SPA and preserves Google popup policy', () => {
  assert.deepEqual(validateHosting(input(), { frontendOnly: true }), []);
});
test('deployment blocks unresolved cloud session/storage/proxy readiness', () => {
  const errors = validateHosting(input());
  assert.equal(errors.length, backendChecks.length);
  for (const [, message] of backendChecks) assert(errors.includes(message));
});
test('real backend routing and explicit completed architecture checks are required to pass preflight', () => {
  const data = input(); data.config.hosting.rewrites[0].run.serviceId = 'talk-auth-fixture';
  for (const [key] of backendChecks) data.readiness[key] = true;
  assert.deepEqual(validateHosting(data), []);
  data.readiness.durableDatabaseVerified = 'true';
  assert(validateHosting(data).some(message => message.includes('durable')));
});
test('API fallback order, accidental whole-repository hosting and unsafe production flags are rejected', () => {
  const data = input();
  data.config.hosting.rewrites.reverse(); data.config.hosting.public = '.'; data.env.VITE_FIREBASE_PHONE_TESTING = 'true';
  const errors = validateHosting(data, { frontendOnly: true });
  assert(errors.some(message => message.includes('before the SPA')));
  assert(errors.some(message => message.includes('only dist')));
  assert(errors.some(message => message.includes('PHONE_TESTING=false')));
});
test('build checks detect private environment/database files and private input markers', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'talk-hosting-check-'));
  try {
    mkdirSync(path.join(temp, 'dist')); writeFileSync(path.join(temp, 'dist/index.html'), '<main>fixture</main>');
    assert.deepEqual(inspectBuild(temp), []);
    writeFileSync(path.join(temp, 'dist/.env.local'), 'fixture-only');
    writeFileSync(path.join(temp, 'dist/unsafe.js'), 'const key="FIREBASE_TEST_OTP";');
    assert.equal(inspectBuild(temp).length, 2);
  } finally {
    assert(path.resolve(temp).startsWith(path.join(path.resolve(os.tmpdir()), 'talk-hosting-check-')));
    rmSync(temp, { recursive: true, force: true });
  }
});

// Compile the actual initialization module in both Vite modes. Only the SDK is
// a local fixture; it has no HTTP client and cannot request an SMS.
async function compiledAuth(dev, flag, hostname) {
  const definitions = { 'import.meta.env.DEV': String(dev), 'import.meta.env.VITE_FIREBASE_PHONE_TESTING': JSON.stringify(flag) };
  for (const key of ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'APP_ID']) definitions[`import.meta.env.VITE_FIREBASE_${key}`] = JSON.stringify('public-fixture');
  for (const key of ['STORAGE_BUCKET', 'MESSAGING_SENDER_ID', 'MEASUREMENT_ID']) definitions[`import.meta.env.VITE_FIREBASE_${key}`] = '""';
  const result = await build({
    entryPoints: [path.join(projectRoot, 'src/lib/firebase.ts')], bundle: true, format: 'esm', write: false, minify: true, define: definitions,
    plugins: [{ name: 'firebase-no-network-fixture', setup(builder) {
      builder.onResolve({ filter: /^firebase\/(app|auth)$/ }, args => ({ path: args.path, namespace: 'firebase-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'firebase-fixture' }, () => ({ contents: `
        export const getApps=()=>[];
        export const initializeApp=(config,name)=>({config,name});
        export const inMemoryPersistence={type:'NONE'};
        export const initializeAuth=(app,options)=>({app,options,settings:{},useDeviceLanguage(){}});
      ` }));
    } }],
  });
  const previous = globalThis.window;
  try {
    globalThis.window = { location: { hostname } };
    const module = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text + `\n//${dev}-${flag}-${hostname}`).toString('base64'));
    const auth = module.getPhoneFirebaseAuth();
    return { testing: module.isPhoneTestMode(), verifierDisabled: auth.settings.appVerificationDisabledForTesting, persistence: auth.options.persistence.type };
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
}
test('production never disables reCAPTCHA even with a true testing flag and loopback hostname', async () => {
  assert.deepEqual(await compiledAuth(false, 'true', 'localhost'), { testing: false, verifierDisabled: false, persistence: 'NONE' });
});
test('production HTTPS host always keeps Firebase app verification enabled', async () => {
  assert.equal((await compiledAuth(false, 'true', 'talk-fc3dc.web.app')).verifierDisabled, false);
});
test('fictional testing remains enabled only in opt-in loopback development', async () => {
  assert.equal((await compiledAuth(true, 'true', 'localhost')).verifierDisabled, true);
  assert.equal((await compiledAuth(true, 'true', '127.0.0.1')).verifierDisabled, true);
  assert.equal((await compiledAuth(true, 'false', 'localhost')).verifierDisabled, false);
  assert.equal((await compiledAuth(true, 'true', 'talk-fc3dc.web.app')).verifierDisabled, false);
});
