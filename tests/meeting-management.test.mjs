import {sqliteMigrationCount} from './helpers/migration-count.mjs';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { SignalResponse } from '@livekit/protocol';
import { createAuthApp } from '../backend/src/auth.mjs';
import { openAuthDatabase } from '../backend/src/database.mjs';
import { asyncDatabase } from '../backend/src/async-database.mjs';
import { createMeetingManagement } from '../backend/src/meeting-management.mjs';
import { createMeetingService } from '../backend/src/meetings.mjs';
import { scrubSignal } from '../backend/src/meeting-gateway.mjs';

async function harness({ databasePath = ':memory:' } = {}) {
  let now = Date.now(), failing = false; const database = openAuthDatabase(databasePath);
  const peers = [], calls = [];
  const service = createMeetingService({ NODE_ENV: 'development', LIVEKIT_URL: 'ws://127.0.0.1:7880', LIVEKIT_API_KEY: 'unit-test-key', LIVEKIT_API_SECRET: 'unit-test-private-key-at-least-32-chars' });
  service.admin = {
    listParticipants: async () => peers,
    sendData: async () => {},
    updateParticipant: async (_room, identity, options) => { if (failing) throw new Error('Isolated media outage'); calls.push({ action: 'permissions', identity, ...options }); peers.find(peer => peer.identity === identity).permission = options.permission; },
    removeParticipant: async (_room, identity) => { calls.push({ action: 'remove', identity }); peers.splice(peers.findIndex(peer => peer.identity === identity), 1); },
    deleteRoom: async () => { calls.push({ action: 'end' }); peers.length = 0; },
  };
  const origin = 'http://localhost:3001';
  const app = createAuthApp({ clientId: 'moderation-test.apps.googleusercontent.com', origins: [origin], database, now: () => now, meetings: service, verifyCredential: async value => JSON.parse(value) });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/auth/`;
  const adapter = asyncDatabase(database), manager = createMeetingManagement({ db: adapter, service, now: () => now });
  async function account(name) {
    const jar = new Map(); let csrf = '';
    const request = async (route, body, extraHeaders = {}) => {
      const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
        headers: { Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; '), ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }), ...extraHeaders },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      for (const cookie of response.headers.getSetCookie()) { const [key, value] = cookie.split(';')[0].split('='); if (/Max-Age=0/.test(cookie)) jar.delete(key); else jar.set(key, value); }
      return { status: response.status, body: await response.json() };
    };
    const config = (await request('config')).body; csrf = config.csrfToken;
    const seconds = Math.floor(now / 1000);
    const signed = await request('google', { credential: JSON.stringify({ iss: 'https://accounts.google.com', aud: 'moderation-test.apps.googleusercontent.com', sub: name, name, email: `${name}@example.test`, email_verified: true, nonce: config.nonce, iat: seconds, exp: seconds + 3600 }) });
    assert.equal(signed.status, 200); csrf = signed.body.csrfToken;
    assert.equal((await request('google/confirm', {})).status, 200);
    return { request, create: (approvalRequired = true) => request('meetings/talk-workshop/create', { approvalRequired }), join: () => request('meetings/talk-workshop/token', { displayName: name }), state: () => request('meetings/talk-workshop/state'),
      action: (action, target, extra = {}) => request('meetings/talk-workshop/actions', { action, ...(target ? { target } : {}), ...extra }), id: signed.body.user.id };
  }
  return { account, database, service, peers, calls, manager, authorize: ticket => adapter.withContext(() => manager.authorizeTicket(ticket)), reconcile: () => adapter.withContext(() => manager.reconcile()), failEnforcement: value => { failing = value; }, advance: ms => { now += ms; },
    connect: result => peers.push({ identity: result.body.identity, name: 'Fixture', permission: { canPublish: true, canSubscribe: true, canPublishData: true, canPublishSources: [1, 2, 3, 4] } }),
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); app.locals.closeAuthDatabase(); database.close(); } };
}

test('all 24 catalog reactions are backend-authorized and expire from the meeting snapshot',async t=>{
  const h=await harness();t.after(h.close);const host=await h.account('ReactionCatalog');await host.create(false);h.connect(await host.join());
  const {reactionChoices}=await import('../backend/src/meeting-management.mjs');
  for(let i=0;i<reactionChoices.length;i++){
    if(i && i%5===0)h.advance(10001);
    assert.equal((await host.action('reaction',undefined,{emoji:reactionChoices[i]})).status,200);
    assert.ok((await host.state()).body.reactions.some(item=>item.emoji===reactionChoices[i]));
  }
  h.advance(6001);assert.deepEqual((await host.state()).body.reactions,[]);
});

test('creator ownership is explicit, atomic and tied to the Talk account; frontend/metadata cannot grant roles', async t => {
  const h = await harness(); t.after(h.close); const host = await h.account('Creator'), other = await h.account('Other');
  assert.equal((await host.join()).body.joinState, 'not_created');
  assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_meetings').get().n, 0);
  assert.equal((await host.create()).status, 201); assert.equal((await other.create()).status, 409);
  const row = h.database.prepare('SELECT * FROM talk_meetings').get(); assert.equal(row.owner_account_id, host.id);
  assert.equal((await other.action('lock', undefined, { role: 'host', roomAdmin: true })).status, 403);
  assert.equal((await host.state()).body.role, 'host');
  assert.equal((await other.state()).body.role, 'member');
  assert.equal((await other.request('meetings/unknown/token', { displayName: 'Other', room: row.room_name, identity: 'host' })).status, 404);
});

test('waiting users have no ticket or participant/reaction information; admit, deny and Admit All are authoritative', async t => {
  const h = await harness(); t.after(h.close); const host = await h.account('Creator'), a = await h.account('A'), b = await h.account('B'); await host.create();
  h.connect(await host.join());
  const waiting = await a.join(); assert.equal(waiting.status, 202); assert.equal(waiting.body.token, undefined);
  const privateState = (await a.state()).body; assert.deepEqual(privateState.members, []); assert.deepEqual(privateState.pending, []); assert.deepEqual(privateState.reactions, []);
  assert.equal((await a.action('reaction', undefined, { emoji: '👍' })).status, 403);
  assert.equal((await host.action('deny', a.id)).status, 200); assert.equal((await a.join()).status, 403);
  assert.equal((await host.action('reauthorize', a.id)).status, 200);
  await b.join(); assert.equal((await host.action('admit_all')).status, 200);
  assert.equal((await a.join()).status, 200); assert.equal((await b.join()).status, 200);
  assert.equal((await host.action('deny', a.id)).status, 409);
});

test('waiting-room admission remains authoritative during a participant lookup outage and recovers live membership', async t => {
  const h = await harness(); t.after(h.close);
  const host = await h.account('OutageHost'), cohost = await h.account('OutageCohost');
  const accepted = await h.account('OutageAccepted'), denied = await h.account('OutageDenied');
  await host.create(false); h.connect(await host.join()); h.connect(await cohost.join());
  assert.equal((await host.action('cohost_add', cohost.id)).status, 200);
  assert.equal((await host.action('approval_on')).status, 200);
  for (const person of [accepted, denied]) {
    const join = await person.join();
    assert.equal(join.status, 202); assert.equal(join.body.joinState, 'waiting');
    assert.equal(join.body.token, undefined); assert.equal(join.body.serverUrl, undefined);
  }
  const originalLookup = h.service.admin.listParticipants;
  h.service.admin.listParticipants = async () => { throw new Error('Isolated participant lookup outage'); };
  for (const moderator of [host, cohost]) {
    const snapshot = await moderator.state();
    assert.equal(snapshot.status, 200); assert.equal(snapshot.body.participantSync, 'unavailable');
    assert.deepEqual(snapshot.body.members, []);
    assert.deepEqual(snapshot.body.pending.filter(person => person.admission === 'pending').map(person => person.accountId).sort(), [accepted.id, denied.id].sort());
  }
  const privateState = await accepted.state();
  assert.equal(privateState.status, 200); assert.equal(privateState.body.admission, 'pending');
  for (const key of ['members', 'pending', 'reactions']) assert.deepEqual(privateState.body[key], []);
  assert.equal(privateState.body.token, undefined);
  assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM talk_meeting_connections WHERE account_id IN (?,?)').get(accepted.id, denied.id).n, 0);
  assert.equal((await accepted.action('admit', denied.id)).status, 403);
  assert.equal((await accepted.action('admit_all')).status, 403);
  assert.equal((await host.action('admit', accepted.id)).status, 200);
  assert.equal((await host.action('deny', denied.id)).status, 200);
  const admittedState = await accepted.state();
  assert.equal(admittedState.status, 200); assert.equal(admittedState.body.admission, 'admitted');
  assert.equal(admittedState.body.participantSync, 'unavailable');
  const ticket = await accepted.join(); assert.equal(ticket.status, 200); assert.ok(await h.authorize(ticket.body.token));
  assert.equal((await denied.join()).status, 403);
  const deniedState = (await denied.state()).body;
  assert.equal(deniedState.admission, 'denied');
  for (const key of ['members', 'pending', 'reactions']) assert.deepEqual(deniedState[key], []);
  h.connect(ticket); h.service.admin.listParticipants = originalLookup;
  const recovered = await host.state();
  assert.equal(recovered.status, 200); assert.equal(recovered.body.participantSync, 'live');
  assert.deepEqual(recovered.body.members.map(person => person.accountId).sort(), [host.id, cohost.id, accepted.id].sort());
  assert.equal(recovered.body.pending.some(person => person.accountId === accepted.id), false);
  assert.equal(recovered.body.pending.find(person => person.accountId === denied.id).admission, 'denied');
});

test('a stalled media lookup cannot hide or indefinitely delay host and co-host waiting-room requests', async t => {
  const h = await harness(); t.after(h.close);
  const host = await h.account('StallHost'), cohost = await h.account('StallCohost'), guest = await h.account('StallGuest');
  await host.create(false); h.connect(await host.join()); h.connect(await cohost.join());
  await host.action('cohost_add', cohost.id); await host.action('approval_on');
  assert.equal((await guest.join()).status, 202);
  const originalLookup = h.service.admin.listParticipants;
  h.service.admin.listParticipants = () => new Promise(() => {});
  const started = performance.now(); let deadline;
  let snapshots;
  try {
    snapshots = await Promise.race([
      Promise.all([host.state(), cohost.state(), guest.state()]),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Waiting-room snapshot exceeded the 4-second safety deadline')), 4000); }),
    ]);
  } finally { clearTimeout(deadline); }
  assert.ok(performance.now() - started < 4000);
  for (const snapshot of snapshots.slice(0, 2)) {
    assert.equal(snapshot.status, 200); assert.equal(snapshot.body.participantSync, 'unavailable');
    assert.equal(snapshot.body.pending.find(person => person.accountId === guest.id).admission, 'pending');
  }
  const privateState = snapshots[2]; assert.equal(privateState.status, 200);
  for (const key of ['members', 'pending', 'reactions']) assert.deepEqual(privateState.body[key], []);
  assert.equal(privateState.body.token, undefined);
  assert.equal((await guest.action('admit', guest.id)).status, 403);
  assert.equal((await cohost.action('admit', guest.id)).status, 200);
  const admitted = await guest.join(); assert.equal(admitted.status, 200);
  h.service.admin.listParticipants = originalLookup; h.connect(admitted);
  const recovered = await guest.state();
  assert.equal(recovered.status, 200); assert.equal(recovered.body.admission, 'admitted');
  assert.equal(recovered.body.participantSync, 'live');
  assert.equal(recovered.body.members.some(person => person.accountId === guest.id), true);
});

test('co-host scope, protected creator, publishing restrictions and revocation persist in the database', async t => {
  const h = await harness(); t.after(h.close); const host = await h.account('Creator'), cohost = await h.account('Cohost'), member = await h.account('Member'); await host.create(false);
  const ownerJoin = await host.join(), coJoin = await cohost.join(), memberJoin = await member.join(); h.connect(ownerJoin); h.connect(coJoin); h.connect(memberJoin);
  assert.equal((await member.action('cohost_add', member.id)).status, 403);
  assert.equal((await host.action('cohost_add', cohost.id)).status, 200); assert.equal((await cohost.state()).body.role, 'cohost');
  for (const action of ['cohost_add', 'cohost_remove', 'lock', 'unlock', 'end', 'approval_off', 'reauthorize']) assert.equal((await cohost.action(action, member.id)).status, 403);
  assert.equal((await cohost.action('remove', host.id)).status, 403);
  assert.equal((await cohost.action('restrict_audio', member.id)).status, 200);
  const restriction = h.calls.find(call => call.action === 'permissions'); assert.equal(restriction.permission.canPublishSources.includes(2), false); assert.equal(restriction.permission.canPublishSources.includes(4), false);
  assert.equal((await member.state()).body.canAudio, false);
  assert.equal((await cohost.action('restore_audio', member.id)).status, 200);
  assert.equal(h.calls.some(call => 'muted' in call && call.muted === false), false);
  assert.equal((await cohost.action('request_mute', member.id)).status, 200);
  assert.ok((await member.state()).body.muteRequestedAt > 0);
  assert.equal((await host.action('cohost_remove', cohost.id)).status, 200);
  assert.equal((await cohost.action('remove', member.id)).status, 403);
});

test('removed tickets and fresh joins are blocked, locking allows only already-admitted reconnects, and session expiry revokes admission', async t => {
  const h = await harness(); t.after(h.close); const host = await h.account('Creator'), member = await h.account('Member'), newcomer = await h.account('New'); await host.create(false);
  const ticket = await member.join(); h.connect(ticket); assert.ok(await h.authorize(ticket.body.token));
  assert.equal((await host.action('lock')).status, 200); assert.equal((await newcomer.join()).status, 423);
  assert.equal((await member.join()).status, 200);
  assert.equal((await host.action('remove', member.id)).status, 200);
  assert.equal(await h.authorize(ticket.body.token), null); assert.equal((await member.join()).status, 403);
  const stored = h.database.prepare('SELECT ticket_hash FROM talk_meeting_connections WHERE identity=?').get(ticket.body.identity);
  assert.equal(stored.ticket_hash, createHash('sha256').update(ticket.body.token).digest('hex')); assert.notEqual(stored.ticket_hash, ticket.body.token);
  await host.action('reauthorize', member.id); await host.action('admit', member.id);
  const next = await member.join(); assert.equal(next.status, 200); assert.notEqual(next.body.token, ticket.body.token);
  assert.equal(await h.authorize(ticket.body.token), null); assert.ok(await h.authorize(next.body.token));
  h.advance(9 * 3600000); assert.equal(await h.authorize(next.body.token), null);
});

test('raised hands retain order, hosts lower them, reaction whitelist/rates and CSRF are enforced', async t => {
  const h = await harness(); t.after(h.close); const host = await h.account('Creator'), a = await h.account('A'), b = await h.account('B'); await host.create(false);
  h.connect(await a.join()); h.connect(await b.join());
  assert.equal((await a.action('raise_hand')).status, 200); h.advance(5); await b.action('raise_hand');
  let state = (await host.state()).body; assert.ok(state.members.find(m => m.accountId === a.id).handAt < state.members.find(m => m.accountId === b.id).handAt);
  assert.equal((await a.action('lower_hand', b.id)).status, 403); assert.equal((await host.action('raise_hand', b.id)).status, 403);
  await host.action('lower_hand', a.id); assert.equal((await a.state()).body.handAt, null);
  assert.equal((await a.action('reaction', undefined, { emoji: '<img>' })).status, 400);
  for (let index = 0; index < 4; index++) assert.equal((await a.action('reaction', undefined, { emoji: '👍' })).status, 200);
  assert.equal((await a.action('reaction', undefined, { emoji: '👍' })).status, 429);
  assert.equal((await a.request('meetings/talk-workshop/actions', { action: 'lower_hand' }, { 'X-CSRF-Token': 'bad' })).status, 403);
  assert.equal((await host.request('meetings/talk-workshop/actions', { action: 'lock' }, { Origin: 'https://attacker.test' })).status, 403);
  h.advance(10001); assert.equal((await a.action('reaction', undefined, { emoji: '🎉' })).status, 200);
  assert.ok(h.database.prepare('SELECT COUNT(*) AS n FROM talk_meeting_events').get().n > 5);
});

test('leave revokes only the connection; end revokes every ticket and permanently closes the meeting link', async t => {
  const h = await harness(); t.after(h.close); const host = await h.account('Creator'), member = await h.account('Member'); await host.create(false);
  const own = await host.join(), other = await member.join(); h.connect(own); h.connect(other);
  assert.equal((await host.action('leave', undefined, { identity: own.body.identity })).status, 200);
  assert.equal(await h.authorize(own.body.token), null); assert.ok(await h.authorize(other.body.token));
  assert.equal((await host.state()).body.role, 'host');
  assert.equal((await host.action('end')).status, 200);
  assert.equal(await h.authorize(other.body.token), null); assert.equal((await member.join()).status, 410); assert.equal((await host.join()).status, 410);
  assert.equal((await host.create()).status, 409);
  assert.equal((await member.state()).body.status, 'ended');
});

test('gateway replaces binary/JSON refreshed JWTs with tickets and fails closed on unsupported room migration', () => {
  const packet = new SignalResponse({ message: { case: 'refreshToken', value: 'never-expose-this-jwt' } });
  assert.equal(SignalResponse.fromBinary(scrubSignal(packet.toBinary(), true, 'ticket')).message.value, 'ticket');
  assert.equal(SignalResponse.fromJsonString(scrubSignal(Buffer.from(packet.toJsonString()), false, 'ticket')).message.value, 'ticket');
  assert.throws(() => scrubSignal(Buffer.from('malformed'), false, 'ticket'));
  const moved = new SignalResponse({ message: { case: 'roomMoved', value: { token: 'never-expose' } } });
  assert.throws(() => scrubSignal(moved.toBinary(), true, 'ticket'));
});

test('parallel meeting creation selects exactly one owner and never replaces the creator', async t => {
  const h = await harness(); t.after(h.close); const a = await h.account('A'), b = await h.account('B');
  const results = await Promise.all([a.create(), b.create()]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  const winner = results[0].status === 201 ? a : b;
  assert.equal(h.database.prepare('SELECT owner_account_id FROM talk_meetings').get().owner_account_id, winner.id);
});

test('a failed media operation reports pending enforcement, preserves restrictions and reconciles after recovery', async t => {
  const h = await harness(); t.after(h.close); const host = await h.account('Creator'), member = await h.account('Member'); await host.create(false);
  const ticket = await member.join(); h.connect(ticket); h.failEnforcement(true);
  const pending = await host.action('restrict_audio', member.id);
  assert.equal(pending.status, 503); assert.equal(pending.body.error, 'enforcement_pending');
  assert.equal((await member.state()).body.canAudio, false);
  assert.equal((await h.authorize(ticket.body.token)).own.can_audio, 0);
  h.failEnforcement(false); await h.reconcile();
  assert.equal(h.peers[0].permission.canPublishSources.includes(2), false);
});

test('ownership, co-host role, restrictions, lock, tickets and audit survive a real SQLite close/reopen', async t => {
  const root = path.resolve('artifacts/qa'); mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(path.join(root, 'meeting-durable-'));
  assert.ok(path.resolve(directory).startsWith(root + path.sep));
  let h;
  t.after(async () => { if (h) await h.close(); rmSync(directory, { recursive: true, force: true }); });
  const databasePath = path.join(directory, 'meeting.sqlite');
  h = await harness({ databasePath }); const owner = await h.account('Creator'), cohost = await h.account('Cohost'); await owner.create(false);
  const ticket = await cohost.join(); await owner.action('cohost_add', cohost.id); await owner.action('restrict_audio', cohost.id); await owner.action('lock');
  const ownerId = owner.id; await h.close(); h = null;
  h = await harness({ databasePath }); const restored = await h.account('Cohost');
  const state = (await restored.state()).body;
  assert.equal(state.role, 'cohost'); assert.equal(state.canAudio, false); assert.equal(state.locked, true);
  assert.equal(h.database.prepare('SELECT owner_account_id FROM talk_meetings').get().owner_account_id, ownerId);
  assert.ok(await h.authorize(ticket.body.token));
  assert.ok(h.database.prepare('SELECT COUNT(*) AS n FROM talk_meeting_events').get().n >= 5);
  assert.equal(h.database.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n,sqliteMigrationCount);
});

test('overlapping restore/restrict operations cannot apply stale grants and do not hold the local auth database over media I/O', async t => {
  const h = await harness(); t.after(h.close); const host = await h.account('Creator'), member = await h.account('Member'); await host.create(false);
  h.connect(await member.join()); await host.action('restrict_audio', member.id);
  const original = h.service.admin.updateParticipant;
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let block = true;
  h.service.admin.updateParticipant = async (...args) => { if (block) { block = false; enter(); await gate; } return original(...args); };
  const restoring = host.action('restore_audio', member.id); await entered;
  const restricting = host.action('restrict_audio', member.id);
  try { assert.equal((await host.request('session')).status, 200); }
  finally { release(); }
  assert.equal((await restoring).status, 200); assert.equal((await restricting).status, 200);
  assert.equal((await member.state()).body.canAudio, false);
  assert.equal(h.peers[0].permission.canPublishSources.includes(2), false);
});
