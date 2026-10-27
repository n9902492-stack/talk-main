import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const smsTestSite = 'talk-fc3dc';

function token() {
  const sdk = process.env.GCLOUD_SDK_ROOT || path.join(root, 'artifacts/qa/cloud-tools/google-cloud-sdk');
  const options = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, windowsHide: true,
    env: { ...process.env, CLOUDSDK_CONFIG: path.join(root, 'artifacts/qa/gcloud-config'), CLOUDSDK_CORE_DISABLE_PROMPTS: '1', CLOUDSDK_CORE_DISABLE_USAGE_REPORTING: '1' } };
  const value = process.platform === 'win32'
    ? execFileSync(path.join(sdk, 'platform/bundledpython/python.exe'), [path.join(sdk, 'lib/gcloud.py'), 'auth', 'print-access-token', '--quiet'], options).trim()
    : execFileSync('gcloud', ['auth', 'print-access-token', '--quiet'], options).trim();
  if (!value) throw new Error('sign_in_required');
  return value;
}

export function canPublishToEmptySite(snapshot) {
  // Even a 404 public URL can have an existing release. Never infer emptiness
  // from the homepage, or replace an old/deactivated release automatically.
  return snapshot.releasesRead === true && snapshot.liveRead === true &&
    snapshot.releaseCount === 0 && snapshot.moreReleases === false && snapshot.hasLiveRelease === false;
}

export async function inspectSmsHosting({ accessToken, fetcher = fetch } = {}) {
  const auth = accessToken || token();
  async function get(resource) {
    const response = await fetcher(`https://firebasehosting.googleapis.com/v1beta1/sites/${smsTestSite}/${resource}`, {
      method: 'GET', headers: { Authorization: `Bearer ${auth}`, 'x-goog-user-project': smsTestSite },
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    return { status: response.status, data };
  }
  const [releases, live] = await Promise.all([get('channels/live/releases?pageSize=1'), get('channels/live')]);
  const snapshot = {
    site: smsTestSite,
    releasesStatus: releases.status,
    liveStatus: live.status,
    releasesRead: releases.status === 200,
    // A missing live channel plus a successful empty release list is safe;
    // API errors/disabled services never count as an empty site.
    liveRead: live.status === 200 || live.status === 404,
    releaseCount: (releases.data.releases || []).length,
    moreReleases: Boolean(releases.data.nextPageToken),
    hasLiveRelease: Boolean(live.data.release?.version?.name || live.data.release?.name || live.data.release),
    liveVersionName: live.data.release?.version?.name || null,
  };
  snapshot.emptyLiveSiteVerified = canPublishToEmptySite(snapshot);
  return snapshot;
}

export async function canCleanUpSmsTest({ expectedPaths, accessToken, fetcher = fetch }) {
  const auth = accessToken || token();
  const snapshot = await inspectSmsHosting({ accessToken: auth, fetcher });
  const version = snapshot.liveVersionName;
  if (!snapshot.liveRead || !version || !/^(?:projects\/(?:talk-fc3dc|\d+)\/)?sites\/talk-fc3dc\/versions\/[A-Za-z0-9_-]+$/.test(version)) return false;
  async function get(resource) {
    const result = await fetcher(`https://firebasehosting.googleapis.com/v1beta1/${resource}`, {
      method: 'GET', headers: { Authorization: `Bearer ${auth}`, 'x-goog-user-project': smsTestSite }, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!result.ok) throw new Error('metadata_unavailable');
    return result.json();
  }
  const [metadata, files] = await Promise.all([get(version), get(version + '/files?status=ACTIVE&pageSize=1000')]);
  if (metadata.config?.rewrites?.length || metadata.config?.redirects?.length || files.nextPageToken || !files.files?.length) return false;
  const paths = files.files.map(file => (file.path || '').replace(/^\//, ''));
  return paths.length === expectedPaths.length && paths.every(name => expectedPaths.includes(name));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await inspectSmsHosting();
    console.log(JSON.stringify(result));
    if (!result.emptyLiveSiteVerified) {
      console.error('BLOCKED: Live site is not verified empty. Do not publish the standalone test over existing content; use a separately approved preview channel/domain instead.');
      process.exitCode = 1;
    }
    console.log('Read-only Hosting release inspection only. No deployment, API enablement or SMS attempted.');
  } catch {
    console.error('BLOCKED: Could not inspect live Hosting releases. Details withheld. Do not deploy until site contents are verified.');
    process.exitCode = 1;
  }
}
