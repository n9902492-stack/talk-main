import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const root = fileURLToPath(new URL('../', import.meta.url));
const project = 'talk-fc3dc';
const region = 'asia-south1';
const configDirectory = path.join(root, 'artifacts/qa/gcloud-config');

export function summarizePhoneConfig(data, personalNumber = '') {
  const phone = data.signIn?.phoneNumber || {};
  const policy = data.smsRegionConfig;
  const number = personalNumber.replace(/[\s()-]/g, '');
  const validNumber = /^\+[1-9]\d{7,14}$/.test(number);
  return {
    phoneProviderEnabled: phone.enabled === true,
    hostingDomainAuthorized: data.authorizedDomains?.includes('talk-fc3dc.web.app') === true,
    indiaAllowed: policy?.allowlistOnly ? (policy.allowlistOnly.allowedRegions || []).includes('IN')
      : policy?.allowByDefault ? !(policy.allowByDefault.disallowedRegions || []).includes('IN') : null,
    fictionalNumbersConfigured: Object.keys(phone.testPhoneNumbers || {}).length > 0,
    personalNumberProvided: validNumber,
    personalNumberIsFictional: validNumber ? Object.hasOwn(phone.testPhoneNumbers || {}, number) : null,
  };
}

// This fixed allowlist contains metadata GETs only, never secret payloads,
// account records, API enablement, provisioning, email or SMS endpoints.
export const checks = [
  ['project', `https://cloudresourcemanager.googleapis.com/v1/projects/${project}`, data => ({ active: data.lifecycleState === 'ACTIVE' })],
  ['billing', `https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`, data => ({ billingEnabled: data.billingEnabled === true })],
  ['phone', `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`, summarizePhoneConfig],
  ['backend', `https://run.googleapis.com/v2/projects/${project}/locations/${region}/services/talk-auth`, data => ({ exists: true, ready: data.terminalCondition?.state === 'CONDITION_SUCCEEDED' })],
  ['database', `https://sqladmin.googleapis.com/sql/v1beta4/projects/${project}/instances/talk-auth-db`, data => ({
    exists: true, runnable: data.state === 'RUNNABLE', correctRegion: data.region === region,
    backupsEnabled: data.settings?.backupConfiguration?.enabled === true,
    pointInTimeRecoveryEnabled: data.settings?.backupConfiguration?.pointInTimeRecoveryEnabled === true,
    deletionProtectionEnabled: data.settings?.deletionProtectionEnabled === true,
    connectorsRequired: data.settings?.connectorEnforcement === 'REQUIRED',
  })],
  ['image-repository', `https://artifactregistry.googleapis.com/v1/projects/${project}/locations/${region}/repositories/talk`, () => ({ exists: true })],
];

export async function inspectCloud({ token, personalNumber = '', fetcher = fetch }) {
  return Promise.all(checks.map(async ([check, url, summarize]) => {
    try {
      const response = await fetcher(url, {
        // Project product APIs need the target quota project with user OAuth.
        // Billing metadata supports the CLI's default consumer and does not
        // require enabling Cloud Billing API inside the application project.
        method: 'GET', headers: { Authorization: `Bearer ${token}`, ...(check === 'billing' ? {} : { 'x-goog-user-project': project }) },
        redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        const error = typeof response.json === 'function' ? await response.json().catch(() => ({})) : {};
        const reasons = (error.error?.details || []).map(item => item.reason).filter(reason => /^[A-Z_]+$/.test(reason || ''));
        return { check, status: response.status, state: response.status === 404 ? 'missing' : 'unverified', ...(reasons.length ? { reasons: [...new Set(reasons)] } : {}) };
      }
      return { check, status: response.status, ...summarize(await response.json(), personalNumber) };
    } catch { return { check, state: 'unverified', detailsWithheld: true }; }
  }));
}

export function accessToken() {
  const sdk = process.env.GCLOUD_SDK_ROOT || path.join(root, 'artifacts/qa/cloud-tools/google-cloud-sdk');
  const python = path.join(sdk, 'platform/bundledpython/python.exe');
  const script = path.join(sdk, 'lib/gcloud.py');
  const options = { cwd: root, env: { ...process.env, CLOUDSDK_CONFIG: configDirectory, CLOUDSDK_CORE_DISABLE_PROMPTS: '1', CLOUDSDK_CORE_DISABLE_USAGE_REPORTING: '1' },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, windowsHide: true };
  // Invoke bundled Python directly on Windows; no shell interpolation of tokens.
  if (process.platform === 'win32') {
    if (!existsSync(python) || !existsSync(script)) throw new Error('cli_unavailable');
    const token = execFileSync(python, [script, 'auth', 'print-access-token', '--quiet'], options).trim();
    if (!token) throw new Error('sign_in_required');
    return token;
  }
  const token = execFileSync('gcloud', ['auth', 'print-access-token', '--quiet'], options).trim();
  if (!token) throw new Error('sign_in_required');
  return token;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const localFile = path.join(root, '.env.local');
    const local = existsSync(localFile) ? parse(readFileSync(localFile)) : {};
    const results = await inspectCloud({ token: accessToken(), personalNumber: local.REAL_SMS_PHONE_NUMBER || '' });
    for (const result of results) console.log(JSON.stringify(result));
    // Merely observing metadata cannot certify cloud cookies, SMTP, IAM,
    // proxy boundaries or real SMS receipt. Never update hosting-readiness.json.
    if (results.some(result => result.status !== 200)) process.exitCode = 1;
    console.log('Read-only metadata inspection finished. Credit balance, quota, OAuth origins and hosted authentication still need review. No deployment, secret upload, email or SMS attempted.');
  } catch {
    console.error('NOT VERIFIED: Google Cloud CLI sign-in is required. Run the local cloud sign-in command in deployment/APPROVAL.md. No resources changed or SMS sent.');
    process.exitCode = 1;
  }
}
