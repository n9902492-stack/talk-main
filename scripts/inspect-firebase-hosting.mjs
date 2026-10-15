import { loadEnv } from 'vite';
import { projectRoot } from './hosting-preflight.mjs';

// Read-only GET requests to public Hosting/Firebase configuration endpoints.
// Never calls accounts:sendVerificationCode, signInWithPhoneNumber, or deploy.
const env = loadEnv('production', projectRoot, 'VITE_');
const site = 'https://talk-fc3dc.web.app';
if (!env.VITE_FIREBASE_API_KEY) {
  console.error('Public Firebase web configuration is missing. No external request was made.');
  process.exitCode = 1;
} else {
  const endpoints = [
    ['hosting', site],
    ['firebase-project', `https://identitytoolkit.googleapis.com/v1/projects?key=${encodeURIComponent(env.VITE_FIREBASE_API_KEY)}`],
    ['recaptcha', `https://identitytoolkit.googleapis.com/v1/recaptchaParams?key=${encodeURIComponent(env.VITE_FIREBASE_API_KEY)}`],
  ];
  for (const [check, url] of endpoints) {
    try {
      const response = await fetch(url, { headers: { Origin: site, Referer: site + '/' }, signal: AbortSignal.timeout(15000) });
      const result = { check, status: response.status };
      if (check === 'hosting') {
        const html = await response.text();
        result.talkPageDetected = response.ok && /<title>Talk\b/i.test(html) && html.includes('id="root"');
        if (!result.talkPageDetected) process.exitCode = 1;
      }
      if (check !== 'hosting') {
        const data = await response.json();
        if (check === 'firebase-project') result.hostingDomainAuthorized = data.authorizedDomains?.includes('talk-fc3dc.web.app') === true;
        if (check === 'recaptcha') result.siteKeyAvailable = typeof data.recaptchaSiteKey === 'string' && data.recaptchaSiteKey.length > 0;
        if (check === 'firebase-project' && !result.hostingDomainAuthorized || check === 'recaptcha' && !result.siteKeyAvailable) process.exitCode = 1;
      }
      console.log(JSON.stringify(result));
      if (!response.ok) process.exitCode = 1;
    } catch {
      console.error(JSON.stringify({ check, error: 'network_unavailable', detailsWithheld: true }));
      process.exitCode = 1;
    }
  }
  console.log('Read-only inspection complete. No deployment, verification request, or SMS attempted.');
}
