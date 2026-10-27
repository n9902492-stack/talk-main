import { mkdirSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'tools/firebase-sms-test');
const runFile = path.join(root, 'artifacts/qa/sms-test-run.json');
try {
  mkdirSync(path.dirname(runFile), { recursive: true });
  if (!existsSync(runFile)) writeFileSync(runFile, JSON.stringify({ id: randomBytes(16).toString('hex') }), { flag: 'wx', mode: 0o600 });
  const run = JSON.parse(readFileSync(runFile, 'utf8'));
  if (!/^[a-f0-9]{32}$/.test(run.id)) throw new Error('Invalid run id');
  // The generated output is the only recursive cleanup target. Verify its
  // absolute location before deleting anything on Windows.
  const dist = path.resolve(directory, 'dist');
  if (dist !== path.join(path.resolve(root), 'tools', 'firebase-sms-test', 'dist')) throw new Error('Unsafe build output');
  rmSync(dist, { force: true, recursive: true });
  await build({ configFile: path.join(directory, 'vite.config.mjs') });
  writeFileSync(path.join(dist, '404.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Temporary test</title><p>No page is published at this address.</p></html>');
  writeFileSync(path.join(dist, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  console.log('PASS Standalone Firebase SMS page built locally. No Talk code, backend, cloud resources or SMS used.');
  console.log('Run npm run sms-test:check next. Deployment and sending remain separate approvals.');
} catch {
  console.error('Standalone test build failed. No deployment or SMS attempted. Configuration details withheld.');
  process.exitCode = 1;
}
