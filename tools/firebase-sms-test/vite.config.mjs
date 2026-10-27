import { defineConfig, loadEnv } from 'vite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
export default defineConfig(() => {
  const publicEnv = loadEnv('production', root, 'VITE_FIREBASE_');
  const run = JSON.parse(readFileSync(path.join(root, 'artifacts/qa/sms-test-run.json'), 'utf8'));
  if (!/^[a-f0-9]{32}$/.test(run.id)) throw new Error('Invalid SMS test run identifier.');
  const define = { 'import.meta.env.VITE_SMS_TEST_RUN_ID': JSON.stringify(run.id) };
  for (const key of ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'APP_ID']) {
    const name = `VITE_FIREBASE_${key}`;
    if (!publicEnv[name]) throw new Error(`Missing public Firebase setting: ${name}`);
    define[`import.meta.env.${name}`] = JSON.stringify(publicEnv[name]);
  }
  if (publicEnv.VITE_FIREBASE_PROJECT_ID !== 'talk-fc3dc') throw new Error('Wrong Firebase project.');
  return { root: directory, publicDir: false, envDir: false, envPrefix: [], define,
    base: `/sms-test-${run.id}/`, build: { outDir: path.join(directory, 'dist', `sms-test-${run.id}`), emptyOutDir: true, sourcemap: false } };
});
