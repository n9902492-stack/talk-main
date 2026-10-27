import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { accessToken } from './inspect-cloud-readiness.mjs';

const project = 'talk-fc3dc';
const region = 'asia-south1';
const apiLabels = Object.freeze({
  'run.googleapis.com': 'cloudRun', 'sqladmin.googleapis.com': 'cloudSql',
  'artifactregistry.googleapis.com': 'artifactRegistry', 'cloudbuild.googleapis.com': 'cloudBuild',
  'secretmanager.googleapis.com': 'secretManager', 'compute.googleapis.com': 'compute',
  'firebasehosting.googleapis.com': 'firebaseHosting',
});
const list = (data, key) => Array.isArray(data?.[key]) ? data[key] : [];
const count = records => ({ count: records.length });

// This closed list contains metadata/list GETs only. No secret-version access,
// provider updates, service enablement, account records, OTP or deployment APIs.
// Provider names, URLs, labels, environment values and IAM bindings are withheld.
export const teamInfrastructureChecks = Object.freeze([
  { check: 'enabled-services', url: `https://serviceusage.googleapis.com/v1/projects/${project}/services?filter=state%3AENABLED&pageSize=200`,
    records: data => list(data, 'services'), summarize: records => ({
      deploymentApisEnabled: Object.fromEntries(Object.entries(apiLabels).map(([api, label]) => [label,
        records.some(item => item.state === 'ENABLED' && (item.config?.name === api || item.name?.endsWith(`/${api}`)))])),
    }) },
  { check: 'cloud-run-services', url: `https://run.googleapis.com/v2/projects/${project}/locations/${region}/services?pageSize=100`,
    records: data => list(data, 'services'), summarize: records => ({ count: records.length,
      readyCount: records.filter(item => item.terminalCondition?.state === 'CONDITION_SUCCEEDED').length,
      proposedBackendExists: records.some(item => item.name?.endsWith('/services/talk-auth')),
    }) },
  { check: 'postgres-instances', url: `https://sqladmin.googleapis.com/sql/v1beta4/projects/${project}/instances?maxResults=100`,
    records: data => list(data, 'items'), summarize: records => ({ count: records.length,
      postgresCount: records.filter(item => /^POSTGRES_\d+$/.test(item.databaseVersion || '')).length,
      targetRegionPostgresCount: records.filter(item => item.region === region && /^POSTGRES_\d+$/.test(item.databaseVersion || '')).length,
      runnableCount: records.filter(item => item.state === 'RUNNABLE').length,
      proposedDatabaseExists: records.some(item => item.name === 'talk-auth-db'),
    }) },
  { check: 'compute-instances', url: `https://compute.googleapis.com/compute/v1/projects/${project}/aggregated/instances?maxResults=100`,
    records: data => Object.values(data?.items || {}).flatMap(item => list(item, 'instances')),
    summarize: records => ({ count: records.length, runningCount: records.filter(item => item.status === 'RUNNING').length }) },
  { check: 'image-repositories', url: `https://artifactregistry.googleapis.com/v1/projects/${project}/locations/${region}/repositories?pageSize=100`,
    records: data => list(data, 'repositories'), summarize: records => ({ count: records.length,
      dockerRepositoryCount: records.filter(item => item.format === 'DOCKER').length,
      proposedRepositoryExists: records.some(item => item.name?.endsWith('/repositories/talk')),
    }) },
  { check: 'secret-metadata', url: `https://secretmanager.googleapis.com/v1/projects/${project}/secrets?pageSize=100`,
    records: data => list(data, 'secrets'), summarize: count },
  { check: 'hosting-sites', url: `https://firebasehosting.googleapis.com/v1beta1/projects/${project}/sites?pageSize=100`,
    records: data => list(data, 'sites'), summarize: records => ({ count: records.length,
      proposedSiteExists: records.some(item => item.name?.endsWith('/sites/talk-fc3dc')),
    }) },
  { check: 'hosting-releases', url: 'https://firebasehosting.googleapis.com/v1beta1/sites/talk-fc3dc/releases?pageSize=1', maxPages: 1,
    records: data => list(data, 'releases'), summarize: records => ({ releasePresent: records.length > 0 }) },
]);

function errorState(status, data) {
  const disabled = (data?.error?.details || []).some(item => item.reason === 'SERVICE_DISABLED');
  if (status === 404) return 'missing';
  if (status === 403) return disabled ? 'service_disabled' : 'permission_denied';
  if (status === 401) return 'sign_in_required';
  if (status === 429) return 'rate_limited';
  return 'unverified';
}

export async function inspectTeamInfrastructure({ token, fetcher = fetch } = {}) {
  return Promise.all(teamInfrastructureChecks.map(async descriptor => {
    const { check } = descriptor;
    let records = [], pageToken, complete = false;
    try {
      for (let page = 0; page < (descriptor.maxPages || 5); page++) {
        // Pagination can alter only the encoded opaque pageToken on the same
        // fixed URL; provider-supplied URLs and redirects are never followed.
        const url = new URL(descriptor.url);
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const response = await fetcher(url.toString(), { method: 'GET',
          headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': project },
          redirect: 'error', signal: AbortSignal.timeout(15000),
        });
        const data = typeof response.json === 'function' ? await response.json().catch(() => ({})) : {};
        if (!response.ok) return { check, status: response.status, state: errorState(response.status, data) };
        records.push(...descriptor.records(data));
        pageToken = typeof data.nextPageToken === 'string' && data.nextPageToken.length <= 8192 ? data.nextPageToken : '';
        if (!pageToken) { complete = true; break; }
      }
      return { check, status: 200, state: 'verified', complete, ...descriptor.summarize(records) };
    } catch { return { check, state: 'unverified', detailsWithheld: true }; }
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const results = await inspectTeamInfrastructure({ token: accessToken() });
    for (const result of results) console.log(JSON.stringify(result));
    if (results.some(result => result.status !== 200)) process.exitCode = 1;
    console.log('Read-only infrastructure metadata inspection finished. No APIs enabled, credentials read from Secret Manager, resources created, deployment, email or SMS attempted.');
  } catch {
    console.error('NOT VERIFIED: Check local Google Cloud CLI sign-in. Credentials and provider details withheld; no resources changed.');
    process.exitCode = 1;
  }
}
