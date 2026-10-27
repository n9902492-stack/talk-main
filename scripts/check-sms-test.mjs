import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectSmsHosting, canPublishToEmptySite, canCleanUpSmsTest } from './sms-test-hosting-status.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export function checkSmsTest() {
  const directory = path.join(root, 'tools/firebase-sms-test');
  const config = JSON.parse(readFileSync(path.join(directory, 'firebase.json')));
  const errors = [];
  if (Object.keys(config).some(key => key !== 'hosting') || Array.isArray(config.hosting) || config.hosting.site !== 'talk-fc3dc' || config.hosting.public !== 'dist') errors.push('Use only the isolated test Hosting site/output.');
  if (config.hosting.rewrites?.length || config.hosting.redirects?.length) errors.push('The standalone test must have no backend or Talk SPA routing.');
  const run = JSON.parse(readFileSync(path.join(root, 'artifacts/qa/sms-test-run.json')));
  if (!/^[a-f0-9]{32}$/.test(run.id)) errors.push('Invalid test run identifier.');
  const dist = path.join(directory, 'dist');
  if (!existsSync(path.join(dist, `sms-test-${run.id}/index.html`))) errors.push('Build the standalone page first.');
  if (existsSync(path.join(dist, 'index.html'))) errors.push('Do not publish a root homepage over Talk.');
  let bytes = 0;
  const paths = [];
  function walk(folder) {
    for (const item of readdirSync(folder, { withFileTypes: true })) {
      const target = path.join(folder, item.name);
      if (item.isSymbolicLink()) { errors.push('Build symlinks are forbidden.'); continue; }
      if (item.isDirectory()) { walk(target); continue; }
      const content = readFileSync(target);
      paths.push(path.relative(dist, target).replaceAll('\\', '/'));
      bytes += content.length;
      if (/\.env|\.sqlite|service.account|\.map$/.test(item.name) || /SMTP_PASSWORD|FIREBASE_TEST_OTP|FIREBASE_TEST_PHONE_NUMBER|AUTH_COOKIE_SECRET|BEGIN (?:RSA )?PRIVATE KEY/.test(content.toString('utf8'))) errors.push('Private files/markers must not be published.');
    }
  }
  if (existsSync(dist)) walk(dist);
  if (bytes > 2 * 1024 * 1024) errors.push('Standalone test unexpectedly exceeds 2 MiB.');
  return { errors: [...new Set(errors)], bytes, paths, testUrl: `https://talk-fc3dc.web.app/sms-test-${run.id}/` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkSmsTest();
    for (const error of result.errors) console.error(`BLOCKED: ${error}`);
    if (result.errors.length) process.exitCode = 1;
    else {
      if (process.argv.includes('--live-guard')) {
        const live = await inspectSmsHosting();
        if (!canPublishToEmptySite(live)) throw new Error('live_site_not_empty');
        console.log('PASS Read-only release guard: existing live site has no releases. This is not deployment approval.');
      }
      if (process.argv.includes('--cleanup-live-guard')) {
        if (!await canCleanUpSmsTest({ expectedPaths: result.paths })) throw new Error('current_release_is_not_only_this_test');
        console.log('PASS Read-only cleanup guard: live file paths belong only to this prepared test. Cleanup still requires approval.');
      }
      console.log(`PASS Standalone build inspected (${result.bytes} bytes). No deployment or SMS attempted.`);
      console.log('Prepared URL (not deployed): ' + result.testUrl);
    }
  } catch {
    console.error('BLOCKED: Test configuration/build or live release inspection is not ready. Do not deploy over any existing site. Details withheld.');
    process.exitCode = 1;
  }
}
