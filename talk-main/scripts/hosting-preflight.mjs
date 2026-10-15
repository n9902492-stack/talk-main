import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const backendChecks = [
  ['hostingCookieCompatibilityVerified', 'Verify Hosting-compatible session and verification cookies.'],
  ['durableDatabaseVerified', 'Provide durable authentication database storage; Cloud Run local SQLite is temporary.'],
  ['trustedProxyRateLimitsVerified', 'Verify trusted proxy/client-IP handling for rate limits.'],
  ['authRegressionVerified', 'Pass email OTP, Google and phone authentication checks against the deployment adapter.'],
];

// Pure validation: no deploy, network, account mutation or SMS calls.
export function validateHosting({ config, aliases, env, readiness }, { frontendOnly = false } = {}) {
  const errors = [];
  const hosting = config.hosting;
  if (!hosting || Array.isArray(hosting)) return ['Configure one Talk Hosting site.'];
  if (aliases.projects?.default !== 'talk-fc3dc' || hosting.site !== 'talk-fc3dc') errors.push('Select the talk-fc3dc project and Hosting site.');
  if (hosting.public !== 'dist') errors.push('Hosting must publish only dist, never the repository or environment files.');
  if (!hosting.ignore?.includes('**/.*')) errors.push('Exclude dotfiles from Hosting uploads.');
  if (!hosting.predeploy?.includes('npm run hosting:check')) errors.push('Keep the deployment readiness predeploy hook.');
  const rewrites = hosting.rewrites || [];
  const apiIndex = rewrites.findIndex(rule => rule.source === '/api{,/**}' && rule.run);
  const spaIndex = rewrites.findIndex(rule => rule.source === '**' && rule.destination === '/index.html');
  if (apiIndex < 0 || spaIndex < 0 || apiIndex >= spaIndex) errors.push('Route /api to the backend before the SPA fallback.');
  if (!hosting.headers?.some(rule => rule.source === '**' && rule.headers?.some(item => item.key === 'Cross-Origin-Opener-Policy' && item.value === 'same-origin-allow-popups'))) errors.push('Preserve the Google popup-compatible opener policy.');
  for (const key of ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID']) {
    if (!env[key]?.trim()) errors.push(`Missing public build setting: ${key}.`);
  }
  if (env.VITE_FIREBASE_PROJECT_ID !== 'talk-fc3dc') errors.push('The frontend Firebase project must be talk-fc3dc.');
  if (env.VITE_FIREBASE_PHONE_TESTING !== 'false') errors.push('Set VITE_FIREBASE_PHONE_TESTING=false for the production build.');
  if (!frontendOnly) {
    const backend = rewrites[apiIndex]?.run;
    if (!backend?.serviceId || backend.serviceId.includes('not-configured') || !backend.region) errors.push('Select an actual deployed Talk authentication backend; the Cloud Run service is a placeholder.');
    for (const [key, message] of backendChecks) if (readiness?.[key] !== true) errors.push(message);
  }
  return errors;
}

export function inspectBuild(root = projectRoot) {
  const errors = [];
  const dist = path.join(root, 'dist');
  if (!existsSync(path.join(dist, 'index.html'))) return ['Build the frontend before deployment.'];
  const privateNames = /FIREBASE_TEST_PHONE_NUMBER|FIREBASE_TEST_OTP|SMTP_PASSWORD|PGPASSWORD|AUTH_COOKIE_SECRET|BEGIN (?:RSA )?PRIVATE KEY/;
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) { errors.push('Do not publish symlinks in dist.'); continue; }
      const target = path.join(directory, entry.name);
      if (entry.name.startsWith('.env') || entry.name.endsWith('.sqlite') || entry.name === 'service-account.json') errors.push('Private configuration/database files must not be present in dist.');
      else if (entry.isDirectory()) walk(target);
      else if (/\.(js|css|html|json)$/.test(entry.name) && privateNames.test(readFileSync(target, 'utf8'))) errors.push('The build contains private configuration markers; inspect it before release.');
    }
  };
  walk(dist);
  return [...new Set(errors)];
}

export function readHostingInputs(root = projectRoot) {
  const json = name => JSON.parse(readFileSync(path.join(root, name), 'utf8'));
  return {
    config: json('firebase.json'), aliases: json('.firebaserc'),
    // Only public build settings are inspected. Private test/SMTP values never
    // appear in this script's return data or output.
    env: loadEnv('production', root, 'VITE_'),
    readiness: json('deployment/hosting-readiness.json'),
  };
}

export function checkHosting({ frontendOnly = false } = {}) {
  try { return [...validateHosting(readHostingInputs(), { frontendOnly }), ...inspectBuild()]; }
  catch { return ['Could not read the Hosting configuration or production build. No deployment was attempted.']; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const frontendOnly = process.argv.includes('--frontend-only');
  const errors = checkHosting({ frontendOnly });
  for (const message of errors) console.error(`NOT READY: ${message}`);
  if (errors.length) process.exitCode = 1;
  else console.log(frontendOnly ? 'PASS Firebase Hosting frontend preparation. No deployment or SMS attempted.' : 'PASS Hosting configuration checks. This is not proof of a live deployment or SMS delivery.');
}
