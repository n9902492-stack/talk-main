import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DataPacket_Kind, TrackSource } from 'livekit-server-sdk';
import { validMeetingName, workspaceMeeting } from './meetings.mjs';
import { avatarDescriptor } from './avatars.mjs';
export { reactionChoices } from '../../frontend/src/lib/reactionCatalog.js';
import { reactionChoices } from '../../frontend/src/lib/reactionCatalog.js';

export const moderationTopic = 'talk.moderation.v1';
const hash = value => createHash('sha256').update(value).digest('hex');
export class MeetingError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new MeetingError(status, code, message); };
export function createMeetingManagement({ db, service, now = Date.now }) {
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const meeting = id => get('SELECT * FROM talk_meetings WHERE id=?', id);
  const member = (id, account) => get('SELECT * FROM talk_meeting_members WHERE meeting_id=? AND account_id=?', id, account);
  const role = (row, user) => row.owner_account_id === user.account_id ? 'host' : user.role === 'cohost' ? 'cohost' : 'member';
  const controls = new Map();
  let recordingGuard;
  let schedulingGuests;
  async function serialize(id, operation) {
    const previous = controls.get(id) || Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    controls.set(id, current); await previous;
    try { return await operation(); }
    finally { release(); if (controls.get(id) === current) controls.delete(id); }
  }
  async function transaction(id, operation) {
    await db.exec('BEGIN IMMEDIATE');
    try { await db.lockIdentity(`meeting:${id}`); const value = await operation(); await db.exec('COMMIT'); return value; }
    catch (error) { await db.exec('ROLLBACK'); throw error; }
  }
  const audit = (id, actor, action, target = null, detail = {}) => run('INSERT INTO talk_meeting_events(id,meeting_id,actor_account_id,target_account_id,action,detail,created_at) VALUES (?,?,?,?,?,?,?)', randomUUID(), id, actor, target, action, JSON.stringify(detail), now());
  async function active(id) {
    const row = await meeting(id);
    if (!row) fail(404, 'meeting_not_created', 'This meeting has not been created yet.');
    if (row.status !== 'active') fail(410, 'meeting_ended', 'This meeting has ended. Ask the host for a new meeting link.');
    return row;
  }
  async function connected(row) {
    try { return await service.admin.listParticipants(row.room_name); }
    catch (error) { if (error.status === 404 || error.code === 'not_found') return []; throw error; }
  }
  async function snapshotParticipants(row) {
    let deadline;
    try {
      // Waiting-room decisions come from our database, not the SFU presence API.
      // A slow/down presence lookup must not block hosts from seeing requests.
      return await Promise.race([connected(row), new Promise(resolve => {
        deadline = setTimeout(() => resolve(null), 1500);
      })]);
    } catch { return null; }
    finally { clearTimeout(deadline); }
  }
  async function notify(row) {
    try { await service.admin.sendData(row.room_name, new TextEncoder().encode('{}'), DataPacket_Kind.RELIABLE, { topic: moderationTopic }); }
    catch { /* Durable state polling recovers a missed refresh notification. */ }
  }
  function permissions(target) {
    const sources = [target.can_audio && TrackSource.MICROPHONE, target.can_video && TrackSource.CAMERA,
      target.can_video && TrackSource.SCREEN_SHARE, target.can_audio && target.can_video && TrackSource.SCREEN_SHARE_AUDIO].filter(Boolean);
    return { canSubscribe: true, canPublish: sources.length > 0, canPublishData: true, canPublishSources: sources, canUpdateMetadata: false };
  }
  async function enforce(row, targetAccount) {
    const users = await connected(row);
    const guestRecords = await schedulingGuests?.records(row.id);
    const connections = [...await all('SELECT * FROM talk_meeting_connections WHERE meeting_id=?', row.id),...(guestRecords?.connections||[])];
    for (const user of users) {
      if (await recordingGuard?.isRecorder(row, user.identity)) {
        if (user.permission?.canPublish || user.permission?.canPublishData) await service.admin.updateParticipant(row.room_name, user.identity, { permission: { canSubscribe: true, canPublish: false, canPublishData: false, canUpdateMetadata: false } });
        continue;
      }
      const connection = connections.find(item => item.identity === user.identity);
      const guest = connection?.account_id.startsWith('guest-');
      const target = connection && (guest ? guestRecords.people.find(p=>p.account_id===connection.account_id) : await member(row.id, connection.account_id));
      const session = connection && (guest ? await schedulingGuests.validConnection(connection) : await get('SELECT 1 AS active FROM sessions WHERE token_hash=? AND account_id=? AND expires_at>? AND requires_confirmation=0', connection.session_hash, connection.account_id, now()));
      if (targetAccount && connection?.account_id !== targetAccount) continue;
      if (row.status !== 'active' || !connection || connection.revoked || connection.expires_at <= now() || !session || !target || target.admission !== 'admitted') {
        await service.admin.removeParticipant(row.room_name, user.identity);
      } else {
        const desired = permissions(target), actual = user.permission || {};
        if (actual.canPublish !== desired.canPublish || actual.canSubscribe !== true || actual.canPublishData !== true
          || JSON.stringify([...(actual.canPublishSources || [])].sort()) !== JSON.stringify([...desired.canPublishSources].sort())) {
          await service.admin.updateParticipant(row.room_name, user.identity, { permission: desired });
        }
      }
    }
    await schedulingGuests?.markAttendance(row.id,users.map(user=>user.identity));
  }
  async function enforceCurrent(id, targetAccount) {
    const apply = async () => {
      const row = await meeting(id); if (!row) return;
      if (row.status === 'ended') {
        try { await service.admin.deleteRoom(row.room_name); } catch (error) { if (error.status !== 404 && error.code !== 'not_found') throw error; }
      } else await enforce(row, targetAccount);
    };
    // PostgreSQL serializes across backend instances with the same meeting
    // advisory lock used by state changes. Local SQLite has one backend process
    // and uses the queue above, without holding a global DB lock over network I/O.
    if (db.kind === 'postgres') return transaction(id, apply);
    return apply();
  }
  async function create(session, { id = `m-${randomUUID()}`, title = workspaceMeeting.title, approvalRequired = true } = {}) {
    if (!validMeetingName(title) || typeof approvalRequired !== 'boolean' || !/^(talk-workshop|m-[a-f\d-]{36})$/.test(id)) fail(400, 'invalid_meeting', 'Enter a meeting title of 1–80 characters.');
    return transaction(id, async () => {
      if (await meeting(id)) fail(409, 'meeting_exists', 'This meeting already has a creator. Join it or create a new meeting.');
      const roomName = `talk-${randomUUID()}`; // Never recycle ended LiveKit rooms.
      await run('INSERT INTO talk_meetings(id,title,room_name,owner_account_id,created_at,approval_required) VALUES (?,?,?,?,?,?)', id, title.trim(), roomName, session.account_id, now(), approvalRequired ? 1 : 0);
      const account = await get('SELECT name FROM accounts WHERE id=?', session.account_id);
      await run("INSERT INTO talk_meeting_members(meeting_id,account_id,role,admission,display_name,updated_at) VALUES (?,?,'host','admitted',?,?)", id, session.account_id, account.name, now());
      await audit(id, session.account_id, 'created', null, { approvalRequired });
      return { meeting: { id, title: title.trim() } };
    });
  }
  async function details(id, session) {
    const row = await meeting(id);
    if (!row) {
      if (id !== workspaceMeeting.id) fail(404, 'meeting_not_found', 'This meeting is not available.');
      return { meeting: { id, title: workspaceMeeting.title }, joinState: 'not_created' };
    }
    const own = await member(id, session.account_id);
    return { meeting: { id, title: row.title }, joinState: row.status === 'ended' ? 'ended' : own?.admission || 'new' };
  }
  async function access(id, session, displayName, signalOrigin) {
    if (!validMeetingName(displayName)) fail(400, 'invalid_display_name', 'Enter a display name between 1 and 80 characters.');
    const result = await transaction(id, async () => {
      const row = await meeting(id);
      if (!row && id === workspaceMeeting.id) return { meeting: { id, title: workspaceMeeting.title }, joinState: 'not_created' };
      if (!row) fail(404, 'meeting_not_found', 'This meeting is not available.');
      await schedulingGuests?.checkWindow(id);
      if (row.status !== 'active') fail(410, 'meeting_ended', 'This meeting has ended. Ask the host for a new link.');
      let own = await member(id, session.account_id);
      if (own?.admission === 'removed' || own?.admission === 'denied') fail(403, 'admission_denied', 'You cannot join this meeting. Ask the host to authorize your account again.');
      if (row.locked && own?.admission !== 'admitted') fail(423, 'meeting_locked', 'This meeting is locked. Ask the host to unlock it or authorize your account.');
      const admission = own?.admission || (row.approval_required ? 'pending' : 'admitted');
      if (!own) {
        await run('INSERT INTO talk_meeting_members(meeting_id,account_id,admission,display_name,updated_at) VALUES (?,?,?,?,?)', id, session.account_id, admission, displayName.trim(), now());
        await audit(id, session.account_id, admission === 'pending' ? 'requested_admission' : 'joined');
      } else await run('UPDATE talk_meeting_members SET display_name=?,updated_at=? WHERE meeting_id=? AND account_id=?', displayName.trim(), now(), id, session.account_id);
      own = await member(id, session.account_id);
      if (admission !== 'admitted') return { meeting: { id, title: row.title }, joinState: 'waiting' };
      await recordingGuard?.checkJoin(id, session.account_id);
      const ticket = randomBytes(32).toString('base64url'), identity = `talk_${hash(session.account_id).slice(0, 24)}_${randomUUID()}`;
      await run('INSERT INTO talk_meeting_connections(identity,meeting_id,account_id,session_hash,ticket_hash,expires_at) VALUES (?,?,?,?,?,?)', identity, id, session.account_id, session.token_hash, hash(ticket), Math.min(session.expires_at, now() + 8 * 3600000));
      return { token: ticket, serverUrl: service.signalUrl || signalOrigin.replace(/^http/, 'ws') + '/api/auth/meeting-signal', identity, meeting: { id, title: row.title }, expiresIn: Math.floor((session.expires_at - now()) / 1000), canAudio: Boolean(own.can_audio), canVideo: Boolean(own.can_video) };
    });
    const row = await meeting(id); if (row) void notify(row);
    return result;
  }
  async function authorizeTicket(ticket) {
    if (typeof ticket !== 'string' || !/^[\w-]{43}$/.test(ticket)) return null;
    const connection = await get('SELECT * FROM talk_meeting_connections WHERE ticket_hash=? AND revoked=0 AND expires_at>?', hash(ticket), now());
    if (!connection) return schedulingGuests?.authorizeTicket(ticket) || null;
    const row = await meeting(connection.meeting_id), own = await member(connection.meeting_id, connection.account_id);
    const session = await get('SELECT * FROM sessions WHERE token_hash=? AND account_id=? AND expires_at>? AND requires_confirmation=0', connection.session_hash, connection.account_id, now());
    if (!row || row.status !== 'active' || own?.admission !== 'admitted' || !session) return null;
    try { await schedulingGuests?.checkWindow(row.id); } catch { return null; }
    try { await recordingGuard?.checkJoin(row.id, connection.account_id, { existing: true }); } catch { return null; }
    return { connection, row, own };
  }
  async function snapshot(id, session) {
    const row = await meeting(id);
    if (!row) return { ...(await details(id, session)), status: 'not_created', role: 'member', admission: 'new', members: [], pending: [], reactions: [] };
    const own = await member(id, session.account_id), ownRole = own ? role(row, own) : 'member';
    const base = { serverTime: now(), meeting: { id, title: row.title }, status: row.status, role: ownRole, admission: own?.admission || 'new', canAudio: own?.can_audio !== 0, canVideo: own?.can_video !== 0,
      muteRequestedAt: own?.mute_requested_at || 0, handAt: own?.hand_at || null, locked: Boolean(row.locked), approvalRequired: Boolean(row.approval_required), members: [], pending: [], reactions: [] };
    if (row.status !== 'active' || own?.admission !== 'admitted' || !service.configured) return base;
    const guestRecords = await schedulingGuests?.records(id);
    const connections = [...await all('SELECT identity,account_id FROM talk_meeting_connections WHERE meeting_id=? AND revoked=0 AND expires_at>?', id, now()),...(guestRecords?.connections||[]).filter(c=>!c.revoked&&c.expires_at>now())];
    const people = [...await all('SELECT * FROM talk_meeting_members WHERE meeting_id=?', id),...(guestRecords?.people||[])];
    const avatars = await all('SELECT a.* FROM account_avatars a JOIN talk_meeting_members m ON m.account_id=a.account_id WHERE m.meeting_id=?', id);
    if (ownRole !== 'member') base.pending = people.filter(user => user.admission === 'pending' || user.admission === 'removed' || user.admission === 'denied')
      .map(user => ({ accountId: user.account_id, name: user.display_name, admission: user.admission, requestedAt: user.updated_at }));
    const live = await snapshotParticipants(row);
    if(live)await schedulingGuests?.markAttendance(id,live.map(person=>person.identity));
    base.participantSync = live === null ? 'unavailable' : 'live';
    base.members = (live || []).flatMap(person => {
      const connection = connections.find(item => item.identity === person.identity), user = people.find(item => item.account_id === connection?.account_id && item.admission === 'admitted');
      return user ? [{ identity: person.identity, accountId: user.account_id, name: user.display_name, avatar: avatarDescriptor(avatars.find(avatar => avatar.account_id === user.account_id)), role: role(row, user), handAt: user.hand_at, canAudio: Boolean(user.can_audio), canVideo: Boolean(user.can_video) }] : [];
    });
    const reactions = (await all("SELECT id,actor_account_id,detail,created_at FROM talk_meeting_events WHERE meeting_id=? AND action='reaction' AND created_at>? ORDER BY created_at DESC,id DESC LIMIT 100", id, now() - 6000)).reverse();
    base.reactions = reactions.map(event => ({ id: event.id, accountId: event.actor_account_id, emoji: JSON.parse(event.detail).emoji, at: event.created_at }));
    return base;
  }
  async function performAction(id, session, body) {
    const allowed = ['admit', 'deny', 'admit_all', 'remove', 'restrict_audio', 'restrict_video', 'restore_audio', 'restore_video', 'request_mute', 'cohost_add', 'cohost_remove', 'lock', 'unlock', 'approval_on', 'approval_off', 'raise_hand', 'lower_hand', 'reaction', 'end', 'leave', 'reauthorize'];
    if (!allowed.includes(body?.action)) fail(400, 'invalid_action', 'This meeting action is unavailable.');
    if (body.target !== undefined && (typeof body.target !== 'string' || !body.target || body.target.length > 100)) fail(400, 'invalid_target', 'Choose a valid meeting participant.');
    const kind = body.action;
    const result = await transaction(id, async () => {
      const row = await active(id), own = await member(id, session.account_id);
      if (!own || own.admission !== 'admitted') fail(403, 'not_admitted', 'Join this meeting before using its controls.');
      const ownRole = role(row, own), host = ownRole === 'host', moderator = host || ownRole === 'cohost';
      if (['raise_hand', 'reaction', 'leave'].includes(kind) && body.target && body.target !== session.account_id) fail(403, 'self_only', 'This action applies only to your own account.');
      const selfAction = ['raise_hand', 'lower_hand', 'reaction', 'leave'].includes(kind) && (!body.target || body.target === session.account_id);
      if (!selfAction && !moderator) fail(403, 'host_required', 'Only the host or an authorized co-host can do this.');
      if (['cohost_add', 'cohost_remove', 'lock', 'unlock', 'approval_on', 'approval_off', 'end', 'reauthorize'].includes(kind) && !host) fail(403, 'owner_required', 'Only the meeting creator can do this.');
      if(body.target?.startsWith('guest-') && schedulingGuests){const target=await schedulingGuests.moderate(id,body.target,kind);await audit(id,session.account_id,kind,target.account_id);return {row:await meeting(id),targetAccount:target.account_id};}
      let target = body.target ? await member(id, body.target) : own;
      const targetAction = ['admit', 'deny', 'remove', 'restrict_audio', 'restrict_video', 'restore_audio', 'restore_video', 'request_mute', 'cohost_add', 'cohost_remove', 'lower_hand', 'reauthorize'].includes(kind);
      if (targetAction && !target) fail(404, 'participant_not_found', 'That participant is unavailable.');
      if (targetAction && target.account_id !== session.account_id && (role(row, target) === 'host' || !host && role(row, target) === 'cohost')) fail(403, 'protected_role', 'You cannot moderate this participant.');
      if (kind === 'admit' || kind === 'deny') {
        if (target.admission !== 'pending') fail(409, 'not_waiting', 'This admission request has already been handled.');
        await run('UPDATE talk_meeting_members SET admission=?,updated_at=? WHERE meeting_id=? AND account_id=?', kind === 'admit' ? 'admitted' : 'denied', now(), id, target.account_id);
      } else if (kind === 'admit_all') {await run("UPDATE talk_meeting_members SET admission='admitted',updated_at=? WHERE meeting_id=? AND admission='pending'", now(), id);if(schedulingGuests){for(const guest of (await schedulingGuests.records(id)).people.filter(p=>p.admission==='pending'))await schedulingGuests.moderate(id,guest.account_id,'admit');}}
      else if (kind === 'reauthorize') {
        if (!['removed', 'denied'].includes(target.admission)) fail(409, 'not_blocked', 'This account is already authorized or waiting.');
        await run("UPDATE talk_meeting_members SET admission='pending',role='member',updated_at=? WHERE meeting_id=? AND account_id=?", now(), id, target.account_id);
      } else if (kind === 'remove') {
        if (target.account_id === row.owner_account_id) fail(403, 'protected_role', 'The creator cannot be removed.');
        await run("UPDATE talk_meeting_members SET admission='removed',role='member',hand_at=NULL,updated_at=? WHERE meeting_id=? AND account_id=?", now(), id, target.account_id);
        await run('UPDATE talk_meeting_connections SET revoked=1 WHERE meeting_id=? AND account_id=?', id, target.account_id);
      } else if (kind === 'cohost_add' || kind === 'cohost_remove') {
        if (target.admission !== 'admitted' || target.account_id === row.owner_account_id) fail(409, 'invalid_role_target', 'Choose an admitted participant other than the creator.');
        await run('UPDATE talk_meeting_members SET role=?,updated_at=? WHERE meeting_id=? AND account_id=?', kind === 'cohost_add' ? 'cohost' : 'member', now(), id, target.account_id);
      } else if (kind.startsWith('restrict_') || kind.startsWith('restore_')) {
        if (target.admission !== 'admitted' || target.account_id === row.owner_account_id) fail(409, 'invalid_media_target', 'Choose an admitted participant other than the creator.');
        const column = kind.endsWith('audio') ? 'can_audio' : 'can_video';
        await run(`UPDATE talk_meeting_members SET ${column}=?,updated_at=? WHERE meeting_id=? AND account_id=?`, kind.startsWith('restore_') ? 1 : 0, now(), id, target.account_id);
      } else if (kind === 'request_mute') await run('UPDATE talk_meeting_members SET mute_requested_at=?,updated_at=? WHERE meeting_id=? AND account_id=?', now(), now(), id, target.account_id);
      else if (kind === 'lock' || kind === 'unlock') await run('UPDATE talk_meetings SET locked=? WHERE id=?', kind === 'lock' ? 1 : 0, id);
      else if (kind === 'approval_on' || kind === 'approval_off') await run('UPDATE talk_meetings SET approval_required=? WHERE id=?', kind === 'approval_on' ? 1 : 0, id);
      else if (kind === 'raise_hand' || kind === 'lower_hand') await run('UPDATE talk_meeting_members SET hand_at=?,updated_at=? WHERE meeting_id=? AND account_id=?', kind === 'raise_hand' ? own.hand_at || now() : null, now(), id, target.account_id);
      else if (kind === 'reaction') { if (!reactionChoices.includes(body.emoji)) fail(400, 'invalid_reaction', 'Choose one of the available reactions.'); }
      else if (kind === 'end') {
        await run("UPDATE talk_meetings SET status='ended',ended_at=? WHERE id=?", now(), id);
        await run('UPDATE talk_meeting_connections SET revoked=1 WHERE meeting_id=?', id);
        await run('UPDATE talk_meeting_members SET hand_at=NULL WHERE meeting_id=?', id);
      } else if (kind === 'leave') {
        if (typeof body.identity !== 'string') fail(400, 'invalid_identity', 'The meeting connection is unavailable.');
        await run('UPDATE talk_meeting_connections SET revoked=1 WHERE identity=? AND account_id=? AND meeting_id=?', body.identity, session.account_id, id);
        await run('UPDATE talk_meeting_members SET hand_at=NULL WHERE meeting_id=? AND account_id=?', id, session.account_id);
      }
      await audit(id, session.account_id, kind, targetAction ? target.account_id : null, kind === 'reaction' ? { emoji: body.emoji } : {});
      return { row: await meeting(id), targetAccount: target?.account_id };
    });
    // Persist desired state first. Gateway checks it on every reconnect and a
    // reconciliation timer retries media enforcement after transport outages.
    try {
      if (kind === 'end') await recordingGuard?.onMeetingEnd(id);
      if (['end', 'remove', 'restrict_audio', 'restrict_video', 'restore_audio', 'restore_video', 'leave'].includes(kind)) await enforceCurrent(id, kind === 'leave' ? session.account_id : result.targetAccount);
    } catch { fail(503, 'enforcement_pending', 'The change is saved, but the media server has not confirmed it yet. Talk will retry; check the participant status before continuing.'); }
    void notify(result.row);
    return { ok: true };
  }
  async function reconcile() {
    await run("DELETE FROM talk_meeting_events WHERE action='reaction' AND created_at<?", now() - 60000);
    await run('DELETE FROM talk_meeting_connections WHERE expires_at<?', now() - 24 * 3600000);
    const rows = await all('SELECT DISTINCT m.* FROM talk_meetings m JOIN talk_meeting_connections c ON c.meeting_id=m.id WHERE c.expires_at>? LIMIT 100', now());
    if(schedulingGuests){const guestRows=await all('SELECT DISTINCT m.* FROM talk_meetings m JOIN scheduling_guest_connections c ON c.meeting_id=m.id WHERE c.expires_at>? LIMIT 100',now());for(const row of guestRows)if(!rows.some(r=>r.id===row.id))rows.push(row);}
    for (const row of rows) { try { await serialize(row.id, () => enforceCurrent(row.id)); } catch { /* Retry durable desired state on the next pass. */ } }
  }
  const action = (id, session, body) => serialize(id, () => performAction(id, session, body));
  async function notifyProfileChange(accountId) {
    const rows = await all("SELECT m.* FROM talk_meetings m JOIN talk_meeting_members p ON p.meeting_id=m.id WHERE p.account_id=? AND p.admission='admitted' AND m.status='active'", accountId);
    await Promise.allSettled(rows.map(notify));
  }
  return { create, details, access, snapshot, action, authorizeTicket, permissions, enforce, meeting, member, reconcile, notifyProfileChange, setRecordingGuard: guard => { recordingGuard = guard; },setSchedulingGuests:guests=>{schedulingGuests=guests;},hasScheduledGuests:id=>schedulingGuests?.hasGuests(id)||false };
}
