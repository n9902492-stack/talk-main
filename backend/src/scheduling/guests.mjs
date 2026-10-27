import { randomInt, randomUUID } from "node:crypto";
import { credential, hash, secret } from "./service.mjs";
import { reject, text } from "./validation.mjs";
function createSchedulingGuests(s, manager) {
  const { get, all, run, now, transaction } = s;
  async function joinWindow(meetingId) {
    const o = await get("SELECT * FROM scheduling_occurrences WHERE meeting_id=? AND status='confirmed'", meetingId);
    if (!o || now() < o.starts_at - 15 * 6e4 || now() > o.ends_at + 36e5) reject(403, "join_window", "Join is available from fifteen minutes before the appointment until one hour after it.");
    return o;
  }
  async function invite(id, token) {
    const b = await s.authorized(id, token);
    const i = await get("SELECT * FROM scheduling_invitations WHERE booking_id=? AND (token_hash=? OR ?=1) AND revoked=0 AND expires_at>? ORDER BY expires_at DESC LIMIT 1", id, hash(token + ":invite"), s.emailAccess(b,token)?1:0, now());
    if (!i || b.status !== "confirmed" || i.redeemed_at) reject(403, "invitation_unavailable", "This invitation is expired or already redeemed.");
    return { b, i };
  }
  async function challenge(id, token) {
    if (!s.transport?.sendCode) reject(503, "guest_email_disabled", "Guest email verification is not enabled. The host can still join with their Talk account.");
    const { b } = await invite(id, token);
    await joinWindow(b.meeting_id);
    const code = String(randomInt(0, 1e6)).padStart(6, "0");
    let invitationId, expiresAt;
    await transaction(b.host_id, async () => {
      const { i } = await invite(id, token);
      if (i.proof_expires_at > now() + 4 * 6e4) reject(429, "verification_cooldown", "Wait a minute before requesting another code.");
      if (s.transport.canSendCode && !await s.transport.canSendCode({bookingId:id,invitationId:i.id,to:b.email}))
        reject(409,"verification_delivery_unavailable","This controlled verification email is unavailable or its single attempt has already been used. Contact the test operator.");
      invitationId=i.id; expiresAt=now()+5*6e4;
      await run("UPDATE scheduling_invitations SET proof_hash=?,proof_expires_at=?,attempts=0 WHERE id=?", hash(i.id + ":" + code), expiresAt, i.id);
    });
    try {
      await s.transport.sendCode({ to: b.email, code, expiresAt: new Date(expiresAt),bookingId:id,invitationId });
    } catch {
      reject(503, "verification_delivery_failed", "The verification email could not be delivered. Try again later.");
    }
    return { sent: true };
  }
  async function redeem(id, token, code) {
    const { b } = await invite(id, token);
    let bad = false, result;
    await transaction(b.host_id, async () => {
      const { i } = await invite(id, token);
      await joinWindow(b.meeting_id);
      if (typeof code !== "string" || !/^\d{6}$/.test(code) || i.attempts >= 5 || i.proof_expires_at <= now() || i.proof_hash !== hash(i.id + ":" + code)) {
        await run("UPDATE scheduling_invitations SET attempts=attempts+1 WHERE id=?", i.id);
        bad = true;
        return;
      }
      const a = await get("SELECT * FROM scheduling_attendees WHERE booking_id=?", id), sessionToken = secret(), csrf = secret();
      await run("UPDATE scheduling_invitations SET redeemed_at=?,proof_hash=NULL WHERE id=?", now(), i.id);
      await run("INSERT INTO scheduling_guest_sessions(token_hash,invitation_id,attendee_id,csrf_token,expires_at) VALUES (?,?,?,?,?)", hash(sessionToken), i.id, a.id, csrf, Math.min(i.expires_at, now() + 4 * 36e5));
      result = { token: sessionToken, csrfToken: csrf, meetingId: b.meeting_id };
    });
    if (bad) reject(403, "invalid_code", "The code could not be verified.");
    return result;
  }
  async function session(token, meetingId) {
    if (!token || !/^[-\w]{43}$/.test(token)) return null;
    const row = await get("SELECT g.*,a.meeting_id,a.admission,a.id AS account_id,b.name,b.host_id,b.status AS booking_status,i.revoked AS invitation_revoked FROM scheduling_guest_sessions g JOIN scheduling_attendees a ON a.id=g.attendee_id JOIN scheduling_bookings b ON b.id=a.booking_id JOIN scheduling_invitations i ON i.id=g.invitation_id WHERE g.token_hash=? AND g.revoked=0 AND g.expires_at>?", hash(token), now());
    if (!row || row.invitation_revoked || row.booking_status !== "confirmed" || row.meeting_id !== meetingId) return null;
    try {
      await joinWindow(meetingId);
    } catch {
      return null;
    }
    return row;
  }
  async function records(meetingId) {
    const people = await all("SELECT a.*,a.id AS account_id,b.name AS display_name,'member' AS role,b.created_at AS updated_at FROM scheduling_attendees a JOIN scheduling_bookings b ON b.id=a.booking_id WHERE a.meeting_id=? AND b.status='confirmed'", meetingId), connections = await all("SELECT *,attendee_id AS account_id FROM scheduling_guest_connections WHERE meeting_id=?", meetingId);
    return { people, connections };
  }
  async function authorizeTicket(ticket) {
    if (typeof ticket !== "string" || !/^[-\w]{43}$/.test(ticket)) return null;
    const c = await get("SELECT *,attendee_id AS account_id FROM scheduling_guest_connections WHERE ticket_hash=? AND revoked=0 AND expires_at>?", hash(ticket), now());
    if (!c) return null;
    const gs = await get("SELECT * FROM scheduling_guest_sessions WHERE token_hash=?", c.session_hash), a = await get("SELECT * FROM scheduling_attendees WHERE id=?", c.attendee_id), b = await get("SELECT * FROM scheduling_bookings WHERE id=?", a?.booking_id), i = gs && await get("SELECT * FROM scheduling_invitations WHERE id=?", gs.invitation_id), row = await manager.meeting(c.meeting_id);
    if (!gs || gs.revoked || gs.expires_at <= now() || !i || i.revoked || b?.status !== "confirmed" || a?.admission !== "admitted" || row?.status !== "active") return null;
    try {
      await joinWindow(c.meeting_id);
    } catch {
      return null;
    }
    return { connection: c, row, own: { ...a, account_id: a.id, display_name: b.name, role: "member" } };
  }
  async function access(gs, displayName, origin) {
    text(displayName);
    return transaction(gs.host_id, async () => {
      await s.db.lockIdentity("meeting:" + gs.meeting_id);
      await joinWindow(gs.meeting_id);
      const m = await manager.meeting(gs.meeting_id), a = await get("SELECT * FROM scheduling_attendees WHERE id=?", gs.account_id);
      if (m?.status !== "active" || ["denied", "removed"].includes(a.admission)) reject(403, "admission_denied", "This guest cannot join the meeting.");
      if (m.locked && a.admission !== "admitted") reject(423, "meeting_locked", "The meeting is locked.");
      if (await get("SELECT 1 AS active FROM talk_recordings WHERE meeting_id=? AND status IN ('starting','recording','stopping')", gs.meeting_id)) reject(409, "guest_recording_blocked", "Ask the host to stop recording before guest admission.");
      if (a.admission === "new") {
        await run("UPDATE scheduling_attendees SET admission='pending' WHERE id=?", a.id);
        a.admission = "pending";
      }
      if (a.admission !== "admitted") return { meeting: { id: m.id, title: m.title }, joinState: "waiting" };
      const ticket = secret(), identity = `talk_guest_${randomUUID()}`;
      await run("INSERT INTO scheduling_guest_connections(identity,attendee_id,meeting_id,session_hash,ticket_hash,expires_at) VALUES (?,?,?,?,?,?)", identity, a.id, m.id, gs.token_hash, hash(ticket), gs.expires_at);
      return { token: ticket, identity, serverUrl: origin.replace(/^http/, "ws") + "/api/auth/meeting-signal", meeting: { id: m.id, title: m.title }, canAudio: Boolean(a.can_audio), canVideo: Boolean(a.can_video) };
    });
  }
  async function state(gs) {
    const a = await get("SELECT * FROM scheduling_attendees WHERE id=?", gs.account_id), m = await manager.meeting(gs.meeting_id);
    return { meeting: { id: m.id, title: m.title }, status: m.status, role: "member", admission: a.admission, canAudio: Boolean(a.can_audio), canVideo: Boolean(a.can_video), handAt: a.hand_at, muteRequestedAt: a.mute_requested_at || 0, locked: Boolean(m.locked), approvalRequired: true, members: [], pending: [], reactions: [], csrfToken: gs.csrf_token };
  }
  async function moderate(id, target, kind) {
    const a = await get("SELECT * FROM scheduling_attendees WHERE id=? AND meeting_id=?", target, id);
    if (!a) reject(404, "participant_not_found", "This guest is unavailable.");
    if (!["admit", "deny", "remove", "reauthorize", "restrict_audio", "restrict_video", "restore_audio", "restore_video", "request_mute", "lower_hand"].includes(kind)) reject(403, "guest_role_denied", "Guest role changes are unavailable.");
    if (["admit", "deny"].includes(kind) && a.admission !== "pending") reject(409, "not_waiting", "This guest is not waiting.");
    const next = { admit: "admitted", deny: "denied", remove: "removed", reauthorize: "pending" }[kind];
    if (next) await run("UPDATE scheduling_attendees SET admission=? WHERE id=?", next, target);
    if (kind === "deny" || kind === "remove") await run("UPDATE scheduling_guest_connections SET revoked=1 WHERE attendee_id=?", target);
    if (kind.endsWith("_audio") || kind.endsWith("_video")) {
      const col = kind.endsWith("_audio") ? "can_audio" : "can_video";
      await run(`UPDATE scheduling_attendees SET ${col}=? WHERE id=?`, kind.startsWith("restore") ? 1 : 0, target);
    }
    if (kind === "request_mute") await run("UPDATE scheduling_attendees SET mute_requested_at=? WHERE id=?", now(), target);
    if (kind === "lower_hand") await run("UPDATE scheduling_attendees SET hand_at=NULL WHERE id=?", target);
    return { account_id: target };
  }
  async function selfAction(gs, body) {
    if (body.target && body.target !== gs.account_id) reject(403, "self_only", "Guest actions apply only to yourself.");
    if (!["leave", "raise_hand", "lower_hand"].includes(body.action)) reject(403, "guest_action_denied", "This guest action is unavailable.");
    await transaction(gs.host_id, async () => {
      if (body.action === "leave") await run("UPDATE scheduling_guest_connections SET revoked=1 WHERE attendee_id=?", gs.account_id);
      else {
        if (gs.admission !== "admitted") reject(403, "not_admitted", "Wait for host admission.");
        await run("UPDATE scheduling_attendees SET hand_at=? WHERE id=?", body.action === "raise_hand" ? now() : null, gs.account_id);
      }
    });
    return { ok: true };
  }
  async function checkWindow(id) {
    if (await get("SELECT 1 AS found FROM scheduling_occurrences WHERE meeting_id=?", id)) await joinWindow(id);
  }
  async function validConnection(c) {
    const gs = await get("SELECT g.*,i.revoked AS invitation_revoked FROM scheduling_guest_sessions g JOIN scheduling_invitations i ON i.id=g.invitation_id WHERE g.token_hash=?", c.session_hash);
    if (!gs || gs.revoked || gs.invitation_revoked || gs.expires_at <= now()) return false;
    try {
      await joinWindow(c.meeting_id);
      return true;
    } catch {
      return false;
    }
  }
  const hasGuests = async (id) => Boolean(await get("SELECT 1 AS found FROM scheduling_attendees a JOIN scheduling_guest_sessions g ON g.attendee_id=a.id WHERE a.meeting_id=? AND a.admission='admitted' AND g.revoked=0 AND g.expires_at>?", id, now()));
  async function markAttendance(meetingId, identities) {
    for (const identity of identities) await run("UPDATE scheduling_attendees SET attended_at=COALESCE(attended_at,?) WHERE admission='admitted' AND meeting_id=? AND id IN (SELECT attendee_id FROM scheduling_guest_connections WHERE identity=? AND revoked=0 AND expires_at>?)", now(), meetingId, identity, now());
  }
  return { challenge, redeem, session, records, authorizeTicket, access, state, moderate, selfAction, joinWindow, checkWindow, validConnection, hasGuests, markAttendance };
}
export {
  createSchedulingGuests
};
