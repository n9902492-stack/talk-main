import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { checkHosting, projectRoot } from './hosting-preflight.mjs';

// Builds locally only. Firebase CLI and deployment APIs are never invoked.
try {
  execFileSync(process.execPath, [path.join(projectRoot, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'production'], { cwd: projectRoot, stdio: 'inherit' });
  const errors = checkHosting({ frontendOnly: true });
  for (const message of errors) console.error(`NOT READY: ${message}`);
  if (errors.length) process.exitCode = 1;
  else {
    console.log('PASS Production frontend built for Firebase Hosting. Nothing deployed; no SMS sent.');
    console.log('Authentication backend readiness is checked separately by npm run hosting:check.');
  }
} catch {
  console.error('Frontend preparation failed. No deployment or SMS was attempted.');
  process.exitCode = 1;
}
