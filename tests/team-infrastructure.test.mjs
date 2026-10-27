import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectTeamInfrastructure, teamInfrastructureChecks } from '../scripts/inspect-team-infrastructure.mjs';

const privateMarker = 'fixture-private-provider-content';
const body = {
  services: [{ name: 'projects/private-account/services/run.googleapis.com', config: { name: 'run.googleapis.com' }, state: 'ENABLED', uri: privateMarker },
    { name: 'projects/private-account/locations/asia-south1/services/talk-auth', terminalCondition: { state: 'CONDITION_SUCCEEDED' }, template: { containers: [{ env: [{ value: privateMarker }] }] } }],
  items: [{ name: 'talk-auth-db', region: 'asia-south1', databaseVersion: 'POSTGRES_16', state: 'RUNNABLE', ipAddresses: [privateMarker] }],
  repositories: [{ name: 'projects/private-account/locations/asia-south1/repositories/talk', format: 'DOCKER', description: privateMarker }],
  secrets: [{ name: privateMarker, labels: { private: privateMarker } }],
  sites: [{ name: 'projects/private-account/sites/talk-fc3dc', defaultUrl: privateMarker }],
  releases: [{ name: privateMarker, releaseUser: { email: privateMarker } }],
  extraPrivateValue: privateMarker,
};

test('team inventory uses a closed metadata GET list, with no writes or secret access endpoints', async () => {
  const requests = [];
  const results = await inspectTeamInfrastructure({ token: 'fixture-private-token', fetcher: async (url, options) => {
    requests.push({ url, options }); return { ok: true, status: 200, json: async () => body };
  } });
  assert.equal(requests.length, teamInfrastructureChecks.length);
  const allowedUrls = new Set(teamInfrastructureChecks.map(item => new URL(item.url).toString()));
  for (const { url, options } of requests) {
    assert(allowedUrls.has(url));
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['x-goog-user-project'], 'talk-fc3dc');
    assert(!/:access|:enable|:disable|:addVersion|\/versions|sendVerificationCode|\/users|accounts:|setIamPolicy|:deploy/.test(url));
  }
  assert(results.every(result => result.status === 200 && result.state === 'verified' && result.complete));
  const serialized = JSON.stringify(results);
  for (const value of [privateMarker, 'fixture-private-token', 'private-account', 'https://']) assert(!serialized.includes(value));
  const byCheck = Object.fromEntries(results.map(item => [item.check, item]));
  assert.equal(byCheck['enabled-services'].deploymentApisEnabled.cloudRun, true);
  assert.equal(byCheck['enabled-services'].deploymentApisEnabled.cloudSql, false);
  assert.equal(byCheck['cloud-run-services'].proposedBackendExists, true);
  assert.equal(byCheck['postgres-instances'].targetRegionPostgresCount, 1);
  assert.equal(byCheck['secret-metadata'].count, 1);
  assert.equal(byCheck['hosting-releases'].releasePresent, true);
});

test('Compute aggregate inventory counts instances without returning zone keys or addresses', async () => {
  const results = await inspectTeamInfrastructure({ token: 'fixture', fetcher: async () => ({ ok: true, status: 200,
    json: async () => ({ items: { [`zones/${privateMarker}`]: { instances: [{ name: privateMarker, status: 'RUNNING', networkInterfaces: [{ accessConfigs: [{ natIP: privateMarker }] }] }] } } }) }) });
  const compute = results.find(item => item.check === 'compute-instances');
  assert.equal(compute.count, 1); assert.equal(compute.runningCount, 1);
  assert(!JSON.stringify(results).includes(privateMarker));
});

test('disabled API, permission denial and missing resources stay distinct and redact all provider errors', async () => {
  for (const [status, reason, state] of [[403, 'SERVICE_DISABLED', 'service_disabled'], [403, privateMarker, 'permission_denied'],
    [404, privateMarker, 'missing'], [401, privateMarker, 'sign_in_required'], [429, privateMarker, 'rate_limited'], [500, privateMarker, 'unverified']]) {
    const results = await inspectTeamInfrastructure({ token: 'fixture', fetcher: async () => ({ ok: false, status,
      json: async () => ({ error: { message: privateMarker, details: [{ reason, metadata: { private: privateMarker } }] } }) }) });
    assert(results.every(result => result.state === state && result.status === status));
    assert(!JSON.stringify(results).includes(privateMarker));
    assert(results.every(result => !Object.hasOwn(result, 'count')));
  }
});

test('bounded pagination stays on fixed endpoints and never exposes opaque tokens', async () => {
  const urls = [];
  const token = `https://attacker.invalid/${privateMarker}?access_token=private`;
  const results = await inspectTeamInfrastructure({ token: 'fixture', fetcher: async url => {
    urls.push(url); return { ok: true, status: 200, json: async () => ({ ...body, nextPageToken: token }) };
  } });
  for (const raw of urls) {
    const url = new URL(raw), original = teamInfrastructureChecks.find(item => new URL(item.url).origin === url.origin && new URL(item.url).pathname === url.pathname);
    assert(original); assert.notEqual(url.hostname, 'attacker.invalid');
  }
  assert(results.every(result => result.complete === false));
  assert(!JSON.stringify(results).includes(privateMarker));
  assert.equal(urls.filter(url => url.includes('/releases?')).length, 1);
});

test('transport exceptions remain unverified without provider details', async () => {
  const results = await inspectTeamInfrastructure({ token: 'fixture', fetcher: async () => { throw new Error(privateMarker); } });
  assert(results.every(result => result.state === 'unverified' && result.detailsWithheld));
  assert(!JSON.stringify(results).includes(privateMarker));
});
