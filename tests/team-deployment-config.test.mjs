import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createMeetingService } from '../backend/src/meetings.mjs';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const service = read('deployment/cloudrun.service.yaml');
const inlineEnv = Object.fromEntries([...service.matchAll(/- \{ name: ([A-Z_]+), value: (?:"([^"]*)"|([^ }]+)) \}/g)]
  .map(([, name, quoted, unquoted]) => [name, quoted ?? unquoted]));
const credentialFixture = {
  LIVEKIT_API_KEY: 'isolated-team-config-test-key',
  LIVEKIT_API_SECRET: 'isolated-team-config-test-secret-32-characters',
};

test('Cloud Build upload includes every frontend catalog needed by the backend image without including frontend configuration', () => {
  const cloudAllow = new Set(read('.gcloudignore').split(/\r?\n/).filter(line => line.startsWith('!')));
  const dockerAllow = new Set(read('.dockerignore').split(/\r?\n/).filter(line => line.startsWith('!')));
  const dockerfile = read('backend/Dockerfile');
  for (const file of ['reactionCatalog.js', 'avatarCatalog.js']) {
    assert(dockerfile.includes(`frontend/src/lib/${file}`));
    for (const allow of [cloudAllow, dockerAllow]) {
      for (const entry of ['!frontend/', '!frontend/src/', '!frontend/src/lib/', `!frontend/src/lib/${file}`]) assert(allow.has(entry), `Missing upload allowlist entry: ${entry}`);
      assert(!allow.has('!frontend/**'));
      assert(!allow.has('!frontend/src/**'));
      assert(!allow.has('!.env.local'));
    }
  }
});

test('small-team Cloud Run template caps resource and database fanout while preserving long-lived signaling', () => {
  assert.match(service, /autoscaling\.knative\.dev\/minScale: "0"/);
  assert.match(service, /autoscaling\.knative\.dev\/maxScale: "1"/);
  assert.match(service, /timeoutSeconds: 3600/);
  assert.match(service, /containerConcurrency: 20/);
  assert.equal(inlineEnv.PGPOOL_MAX, '5');
  assert.equal(inlineEnv.RECORDING_PROVIDER, 'disabled');
  assert.equal(inlineEnv.AUTH_DB_DRIVER, 'postgres');
  assert.equal(inlineEnv.AUTH_COOKIE_MODE, 'hosting');
});

test('LiveKit administrative credentials reference pinned backend secrets only', () => {
  for (const [name, secret] of [['LIVEKIT_API_KEY', 'talk-livekit-api-key'], ['LIVEKIT_API_SECRET', 'talk-livekit-api-secret']]) {
    assert.match(service, new RegExp(`- name: ${name}\\s+valueFrom: \\{ secretKeyRef: \\{ name: ${secret}, key: "1" \\} \\}`));
    assert.equal(inlineEnv[name], undefined);
  }
  assert(!/VITE_LIVEKIT_API_(?:KEY|SECRET)/.test(service));
});

test('unreviewed Cloud Run meeting URL placeholders fail closed even when secrets are supplied', () => {
  assert(inlineEnv.LIVEKIT_URL?.startsWith('REPLACE_WITH_'));
  assert(inlineEnv.MEETING_SIGNAL_URL?.startsWith('REPLACE_WITH_'));
  const pending = createMeetingService({ ...inlineEnv, ...credentialFixture });
  assert.equal(pending.configured, false);
  assert.equal(pending.admin, null);
  assert.equal(pending.upstreamUrl, null);
});

test('production requires both an approved TLS media origin and a direct TLS Talk signaling endpoint', () => {
  const approved = { NODE_ENV: 'production', ...credentialFixture,
    LIVEKIT_URL: 'wss://approved-project.livekit.cloud',
    MEETING_SIGNAL_URL: 'wss://approved-backend.run.app/api/auth/meeting-signal' };
  assert.equal(createMeetingService(approved).configured, true);
  for (const changes of [
    { LIVEKIT_URL: '' }, { LIVEKIT_API_KEY: '' }, { LIVEKIT_API_SECRET: '' }, { MEETING_SIGNAL_URL: '' },
    { LIVEKIT_URL: 'ws://127.0.0.1:7880' },
    { MEETING_SIGNAL_URL: 'ws://127.0.0.1:3001/api/auth/meeting-signal' },
    { MEETING_SIGNAL_URL: 'wss://approved-backend.run.app/api/auth/meeting-signal?access_token=fixture' },
  ]) assert.equal(createMeetingService({ ...approved, ...changes }).configured, false);
});
