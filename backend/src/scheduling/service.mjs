import { createHash, randomBytes, randomUUID } from "node:crypto";
import { enqueueEmails } from "./email-outbox.mjs";
import {enqueueCalendarBooking} from './google-calendar/repository.mjs';
import { repository } from "./repository.mjs";
import { answers, email, integer, questions, reject, settings, text, windows, zone } from "./validation.mjs";
import { availableSlots, localParts, recommendations, slotReason } from "./availability.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
function credential(value) {
  if (typeof value !== "string" || !/^[-\w]{43}$/.test(value)) reject(403, "booking_access_denied", "This booking credential is unavailable.");
  return value;
}
const slug = (value) => {
  const s = text(value, 60).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) reject(400, "invalid_slug", "Use lowercase letters, numbers and hyphens.");
  return s;
};
function createScheduling({ db, now = Date.now, transport = null, links = transport?.links, calendarEnabled=false }) {
  const r = repository(db), { get, all, run, transaction } = r;
  const audit = (host, booking, action) => run("INSERT INTO scheduling_audit(id,host_id,booking_id,action,created_at) VALUES (?,?,?,?,?)", randomUUID(), host, booking, action, now());
  const calendarQueue=id=>calendarEnabled?enqueueCalendarBooking({...r,now},id):Promise.resolve();
  async function saveProfile(host, body) {
    const tz = zone(body.timezone), cfg = settings(body.settings), hours = windows(body.windows), handle = slug(body.slug);
    const overrides = body.overrides || [];
    if (!Array.isArray(overrides) || overrides.length > 120) reject(400, "invalid_overrides", "Use up to 120 date overrides.");
    const dates = /* @__PURE__ */ new Set();
    for (const o of overrides) {
      if (!o || typeof o !== "object" || typeof o.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.date) || !Number.isFinite(Date.parse(o.date)) || new Date(o.date).toISOString().slice(0, 10) !== o.date || dates.has(o.date)) reject(400, "invalid_date", "Choose unique valid dates.");
      dates.add(o.date);
      if (!Array.isArray(o.windows)) reject(400, "invalid_overrides", "Enter valid date availability.");
      o.windows = windows(o.windows.map((w) => ({ ...w, weekday: 0 })));
    }
    return transaction(host, async () => {
      if (await get("SELECT 1 AS found FROM scheduling_profiles WHERE slug=? AND host_id<>?", handle, host)) reject(409, "slug_taken", "This booking handle is already used.");
      await run("INSERT INTO scheduling_profiles(host_id,slug,timezone,settings,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(host_id) DO UPDATE SET slug=excluded.slug,timezone=excluded.timezone,settings=excluded.settings,version=scheduling_profiles.version+1,updated_at=excluded.updated_at", host, handle, tz, JSON.stringify(cfg), now());
      await run("DELETE FROM scheduling_windows WHERE host_id=?", host);
      for (const w of hours) await run("INSERT INTO scheduling_windows(id,host_id,weekday,start_minute,end_minute) VALUES (?,?,?,?,?)", randomUUID(), host, w.weekday, w.start, w.end);
      await run("DELETE FROM scheduling_overrides WHERE host_id=?", host);
      for (const o of overrides) await run("INSERT INTO scheduling_overrides(id,host_id,local_date,windows) VALUES (?,?,?,?)", randomUUID(), host, o.date, JSON.stringify(o.windows));
      await run("INSERT INTO scheduling_calendar_connections(id,host_id,provider,status,created_at) VALUES (?,?,'ics','local',?) ON CONFLICT(host_id,provider) DO NOTHING", randomUUID(), host, now());
      await audit(host, null, "profile_updated");
      return dashboard(host);
    });
  }
  async function createEvent(host, body) {
    if (!await r.profile(host)) reject(409, "profile_required", "Save availability first.");
    const title = text(body.title), duration = integer(body.duration, 5, 240), capacity = integer(body.capacity ?? 1, 1, 20), handle = slug(body.slug), qs = questions(body.questions), followUpDuration = integer(body.followUpDuration ?? duration, 5, 240);
    const agenda=body.agenda===undefined||body.agenda===''?'':text(body.agenda,2000);
    return transaction(host, async () => {
      if (await get("SELECT 1 AS found FROM scheduling_events WHERE host_id=? AND slug=?", host, handle)) reject(409, "event_slug_taken", "Choose another event link.");
      const id = randomUUID();
      await run("INSERT INTO scheduling_events(id,host_id,slug,title,duration,capacity,settings,created_at) VALUES (?,?,?,?,?,?,?,?)", id, host, handle, title, duration, capacity, JSON.stringify({ followUpDuration,...agenda?{agenda}:{} }), now());
      for (const q of qs) await run("INSERT INTO scheduling_questions(event_id,id,definition) VALUES (?,?,?)", id, q.id, JSON.stringify(q));
      await audit(host, null, "event_created");
      return { event: await publicEvent(id) };
    });
  }
  async function publicEvent(id, includeDisabled = false) {
    const e = await r.event(id);
    if (!e || !e.enabled && !includeDisabled) reject(404, "event_unavailable", "This event is unavailable.");
    const p = await r.profile(e.host_id), a = await get("SELECT name FROM accounts WHERE id=?", e.host_id);
    return { id: e.id, title: e.title, duration: e.duration, capacity: e.capacity, hostName: a.name, hostSlug: p.slug, slug: e.slug, timezone: p.timezone, followUp: await get("SELECT slug,duration FROM scheduling_events WHERE host_id=? AND duration=? AND enabled=1 ORDER BY created_at DESC LIMIT 1", e.host_id, e.settings.followUpDuration), questions: (await all("SELECT definition FROM scheduling_questions WHERE event_id=? ORDER BY id", id)).map((q) => JSON.parse(q.definition)), followUpDuration: e.settings.followUpDuration, emailEnabled: Boolean(transport) };
  }
  async function resolve(handle, eventSlug) {
    const row = await get("SELECT e.id FROM scheduling_events e JOIN scheduling_profiles p ON p.host_id=e.host_id WHERE p.slug=? AND e.slug=? AND e.enabled=1", handle, eventSlug);
    if (!row) reject(404, "event_unavailable", "This event is unavailable.");
    return publicEvent(row.id);
  }
  async function input(eventId, from, to) {
    const event = await r.event(eventId);
    if (!event || !event.enabled) reject(404, "event_unavailable", "This event is unavailable.");
    const profile = await r.profile(event.host_id);
    return { event, profile, windows: (await all("SELECT * FROM scheduling_windows WHERE host_id=?", event.host_id)).map((w) => ({ weekday: w.weekday, start: w.start_minute, end: w.end_minute })), overrides: (await all("SELECT * FROM scheduling_overrides WHERE host_id=?", event.host_id)).map((o) => ({ date: o.local_date, windows: JSON.parse(o.windows) })), busy: await r.occurrenceRows(event.host_id, from - 2 * 864e5, to + 2 * 864e5), now: now() };
  }
  async function slots(id, { from, to, timezone }, host = null) {
    zone(timezone);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < now() - 864e5 || to <= from || to - from > 14 * 864e5) reject(400, "invalid_range", "Choose a range of up to fourteen days.");
    const data = await input(id, from, to);
    if (host && data.event.host_id !== host) reject(404, "event_unavailable", "This event is unavailable.");
    const result = availableSlots(data, from, to);
    return { slots: result, recommendations: recommendations(result, timezone, data.profile.settings.preferred), timezone, hostTimezone: data.profile.timezone, ...host ? { unavailableReasons: ["booking_window", "working_hours", "focus", "busy", "capacity", "daily_count", "daily_minutes"].map((reason) => ({ reason, count: Array.from({ length: Math.ceil((to - from) / 9e5) }, (_, i) => slotReason({ ...data, start: from + i * 9e5 })).filter((r2) => r2 === reason).length })) } : {} };
  }
  async function associate(data, start) {
    const end = start + data.event.duration * 6e4;
    let o = await get("SELECT * FROM scheduling_occurrences WHERE event_id=? AND starts_at=? AND status='confirmed'", data.event.id, start);
    if (o) return o;
    const id = randomUUID(), meetingId = `m-${randomUUID()}`, room = `talk-${randomUUID()}`;
    await run("INSERT INTO talk_meetings(id,title,room_name,owner_account_id,approval_required,created_at) VALUES (?,?,?,?,1,?)", meetingId, data.event.title, room, data.event.host_id, now());
    const account = await get("SELECT name FROM accounts WHERE id=?", data.event.host_id);
    await run("INSERT INTO talk_meeting_members(meeting_id,account_id,role,admission,display_name,updated_at) VALUES (?,?,'host','admitted',?,?)", meetingId, data.event.host_id, account.name, now());
    await run("INSERT INTO scheduling_occurrences(id,host_id,event_id,starts_at,ends_at,meeting_id,status) VALUES (?,?,?,?,?,?,'confirmed')", id, data.event.host_id, data.event.id, start, end, meetingId);
    return get("SELECT * FROM scheduling_occurrences WHERE id=?", id);
  }
  const queue=(id,version,start,kind="confirmation")=>enqueueEmails({get,run,now},id,version,kind);
  async function book(eventId, body) {
    const token = credential(body.credential), start = integer(body.start, 0, Number.MAX_SAFE_INTEGER), name = text(body.name), address = email(body.email), tz = zone(body.timezone), event = await publicEvent(eventId), response = answers(event.questions, body.answers), requestHash = hash(JSON.stringify({ eventId, start, name, address, tz, response })), host = (await r.event(eventId)).host_id;
    return transaction(host, async () => {
      const previous = await get("SELECT * FROM scheduling_bookings WHERE host_id=? AND idempotency_hash=?", host, hash(token));
      if (previous) {
        if (previous.request_hash !== requestHash) reject(409, "idempotency_conflict", "This request ID has already been used for different details.");
        return detail(previous.id, token);
      }
      const data = await input(eventId, start, start + event.duration * 6e4), reason = slotReason({ ...data, start });
      if (reason) reject(409, "slot_unavailable", "This time is no longer available. Choose another time.");
      const occurrence = await associate(data, start), id = randomUUID(), attendee = `guest-${randomUUID()}`;
      await run("INSERT INTO scheduling_bookings(id,occurrence_id,host_id,name,email,timezone,status,manage_hash,idempotency_hash,request_hash,created_at,answers_expire_at) VALUES (?,?,?,?,?,?,'confirmed',?,?,?,?,?)", id, occurrence.id, host, name, address, tz, hash(token), hash(token), requestHash, now(), occurrence.ends_at + 30 * 864e5);
      await run("INSERT INTO scheduling_attendees(id,booking_id,meeting_id) VALUES (?,?,?)", attendee, id, occurrence.meeting_id);
      await run("INSERT INTO scheduling_invitations(id,booking_id,token_hash,expires_at) VALUES (?,?,?,?)", randomUUID(), id, hash(token + ":invite"), occurrence.ends_at + 36e5);
      await run("INSERT INTO scheduling_answers(booking_id,schema_snapshot,answers) VALUES (?,?,?)", id, JSON.stringify(event.questions), JSON.stringify(response));
      await queue(id, 1, start);
      await audit(host, id, "confirmed");
      await calendarQueue(id);
      if (body.analyticsConsent === true && body.analyticsToken) {
        const changed = await run("UPDATE scheduling_metric_visits SET completed=1 WHERE event_id=? AND token_hash=? AND completed=0 AND expires_at>?", eventId, hash(body.analyticsToken), now());
        if (changed.changes) await countMetric(eventId, "completion");
      }
      return detail(id, token);
    });
  }
  const emailAccess=(b,token)=>Boolean(links?.verify(b,token,now()));
  async function authorized(id, token, host) {
    const b = await get("SELECT b.*,o.starts_at,o.ends_at,o.meeting_id,o.event_id FROM scheduling_bookings b JOIN scheduling_occurrences o ON o.id=b.occurrence_id WHERE b.id=?", id);
    if (!b || !(host && b.host_id === host) && (!token || hash(credential(token)) !== b.manage_hash && !(emailAccess(b,token) && await get("SELECT 1 AS valid FROM scheduling_invitations WHERE booking_id=? AND revoked=0 AND expires_at>? LIMIT 1",b.id,now())))) reject(404, "booking_unavailable", "This booking is unavailable.");
    return b;
  }
  async function detail(id, token, host) {
    const b=await authorized(id,token,host);return present(b,Boolean(host));
  }
  async function present(b,host=false){
    const event=await publicEvent(b.event_id,true),meeting=await get("SELECT status FROM talk_meetings WHERE id=?",b.meeting_id);
    return { booking: { id: b.id, name: b.name, email: b.email, start: b.starts_at, end: b.ends_at, timezone: b.timezone, status: b.status, completed: meeting.status === "ended", version: b.version, meetingId: b.meeting_id, event, ...host ? { answers: b.answers_expire_at > now() ? JSON.parse((await get("SELECT answers FROM scheduling_answers WHERE booking_id=?", b.id))?.answers || "{}") : null } : {} }, emailEnabled: Boolean(transport) };
  }
  async function revoke(booking) {
    await run("UPDATE scheduling_invitations SET revoked=1,proof_hash=NULL WHERE booking_id=?", booking);
    await run("UPDATE scheduling_guest_sessions SET revoked=1 WHERE attendee_id IN (SELECT id FROM scheduling_attendees WHERE booking_id=?)", booking);
    await run("UPDATE scheduling_guest_connections SET revoked=1 WHERE attendee_id IN (SELECT id FROM scheduling_attendees WHERE booking_id=?)", booking);
    await run("UPDATE scheduling_jobs SET status='cancelled' WHERE booking_id=? AND status IN ('queued','sending')", booking);
  }
  async function release(occurrence) {
    if (!(await get("SELECT COUNT(*) AS n FROM scheduling_bookings WHERE occurrence_id=? AND status='confirmed'", occurrence)).n) await run("UPDATE scheduling_occurrences SET status='cancelled' WHERE id=?", occurrence);
  }
  async function change(id, body, host = null) {
    const b = await authorized(id, body.credential, host);
    return transaction(b.host_id, async () => {
      const current = await authorized(id, body.credential, host);
      if (current.version !== body.version || current.status !== "confirmed") reject(409, "booking_changed", "Refresh this booking before changing it.");
      if (now() >= current.starts_at) reject(409, "booking_started", "This booking has already started.");
      if (body.action === "cancel") {
        await run("UPDATE scheduling_bookings SET status='cancelled',version=version+1 WHERE id=?", id);
        await revoke(id);
        await release(current.occurrence_id);
        await audit(b.host_id, id, "cancelled");
        await queue(id,current.version+1,current.starts_at,"cancellation");
        await calendarQueue(id);
      } else if (body.action === "reschedule") {
        const start = integer(body.start, 0, Number.MAX_SAFE_INTEGER);
        if (start === current.starts_at) return detail(id, body.credential, host);
        const data = await input(current.event_id, start, start + 864e5);
        const old = data.busy.find((o) => o.id === current.occurrence_id);
        if (old?.count === 1) data.busy = data.busy.filter((o) => o.id !== old.id);
        if (slotReason({ ...data, start })) reject(409, "slot_unavailable", "This time is no longer available.");
        const occurrence = await associate(data, start), nextSecret = credential(body.newCredential);
        if (hash(nextSecret) === current.manage_hash) reject(400, "rotate_credential", "Use a fresh credential for the rescheduled booking.");
        await revoke(id);
        await run("UPDATE scheduling_bookings SET occurrence_id=?,manage_hash=?,version=version+1,answers_expire_at=? WHERE id=?", occurrence.id, hash(nextSecret), occurrence.ends_at + 30 * 864e5, id);
        await run("UPDATE scheduling_attendees SET meeting_id=?,admission='new',attended_at=NULL WHERE booking_id=?", occurrence.meeting_id, id);
        await run("INSERT INTO scheduling_invitations(id,booking_id,token_hash,expires_at) VALUES (?,?,?,?)", randomUUID(), id, hash(nextSecret + ":invite"), occurrence.ends_at + 36e5);
        await release(current.occurrence_id);
        await queue(id, current.version + 1, start, "rescheduled");
        await audit(b.host_id, id, "rescheduled");
        await calendarQueue(id);
        return detail(id, nextSecret, host);
      } else reject(400, "invalid_action", "Choose cancel or reschedule.");
      return present({...current,status:"cancelled",version:current.version+1},Boolean(host));
    });
  }
  async function dashboard(host) {
    const profile = await r.profile(host);
    return { profile, windows: (await all("SELECT * FROM scheduling_windows WHERE host_id=?", host)).map((w) => ({ weekday: w.weekday, start: w.start_minute, end: w.end_minute })), overrides: (await all("SELECT * FROM scheduling_overrides WHERE host_id=?", host)).map((o) => ({ date: o.local_date, windows: JSON.parse(o.windows) })), events: await all("SELECT * FROM scheduling_events WHERE host_id=? ORDER BY created_at DESC", host), bookings: await all("SELECT b.id,b.name,b.email,b.status,b.version,o.starts_at,o.ends_at,o.meeting_id,e.title,m.status AS meeting_status FROM scheduling_bookings b JOIN scheduling_occurrences o ON o.id=b.occurrence_id JOIN scheduling_events e ON e.id=o.event_id JOIN talk_meetings m ON m.id=o.meeting_id WHERE b.host_id=? ORDER BY o.starts_at DESC LIMIT 200", host), emailEnabled: Boolean(transport) };
  }
  async function analytics(host) {
    const counts = await all("SELECT action,COUNT(*) AS count FROM scheduling_audit WHERE host_id=? AND booking_id IS NOT NULL GROUP BY action", host);
    const hours = await all("SELECT o.starts_at FROM scheduling_bookings b JOIN scheduling_occurrences o ON o.id=b.occurrence_id WHERE b.host_id=? AND b.status='confirmed'", host), p = await r.profile(host), popular = {};
    for (const row of hours) {
      const hour = Math.floor(localParts(row.starts_at, p.timezone).minute / 60);
      popular[hour] = (popular[hour] || 0) + 1;
    }
    const metrics = await all("SELECT m.kind,SUM(m.count) AS count FROM scheduling_metrics m JOIN scheduling_events e ON e.id=m.event_id WHERE e.host_id=? GROUP BY m.kind", host);
    metrics.push({ kind: "completion", count: (await get("SELECT COALESCE(SUM(m.count),0) AS n FROM scheduling_conversions m JOIN scheduling_events e ON e.id=m.event_id WHERE e.host_id=?", host)).n });
    return { bookings: counts, popularHours: popular, pageEvents: metrics, conversionRate: (metrics.find((m) => m.kind === "visit")?.count || 0) > 0 ? 100 * (metrics.find((m) => m.kind === "completion")?.count || 0) / metrics.find((m) => m.kind === "visit").count : null, conversionNote: "Conversion is bookings per consented anonymous booking-form visit. Nonconsenting visits are excluded; no person-level tracking.", attendance: (await get("SELECT COUNT(*) AS n FROM scheduling_attendees a JOIN scheduling_bookings b ON b.id=a.booking_id WHERE b.host_id=? AND a.attended_at IS NOT NULL", host)).n };
  }
  async function countMetric(id, kind) {
    const table = kind === "completion" ? "scheduling_conversions" : "scheduling_metrics";
    await run(`INSERT INTO ${table}(event_id,local_date,kind,count) VALUES (?,?,?,1) ON CONFLICT(event_id,local_date,kind) DO UPDATE SET count=${table}.count+1`, id, new Date(now()).toISOString().slice(0, 10), kind);
  }
  async function metric(id, body, formToken) {
    await publicEvent(id);
    if (body.consent !== true || !["visit", "selection"].includes(body.kind)) return { tracked: false };
    const e = await r.event(id), tokenHash = hash(credential(formToken));
    return transaction(e.host_id, async () => {
      const inserted = await run("INSERT INTO scheduling_metric_visits(event_id,token_hash,expires_at) VALUES (?,?,?) ON CONFLICT(event_id,token_hash) DO NOTHING", id, tokenHash, now() + 864e5);
      if (inserted.changes) await countMetric(id, "visit");
      if (body.kind === "selection") {
        const changed = await run("UPDATE scheduling_metric_visits SET selected=1 WHERE event_id=? AND token_hash=? AND selected=0", id, tokenHash);
        if (changed.changes) await countMetric(id, "selection");
      }
      return { tracked: true };
    });
  }
  async function manageEvent(host, id, body) {
    return transaction(host, async () => {
      const e = await r.event(id);
      if (!e || e.host_id !== host) reject(404, "event_unavailable", "This event is unavailable.");
      if (typeof body.enabled !== "boolean") reject(400, "invalid_event", "Choose whether new bookings are enabled.");
      await run("UPDATE scheduling_events SET enabled=? WHERE id=?", body.enabled ? 1 : 0, id);
      await audit(host, null, "event_availability_changed");
      return { ok: true };
    });
  }
  return { ...r, now, transport, audit, saveProfile, createEvent, manageEvent, publicEvent, resolve, slots, book, authorized, emailAccess, detail, change, dashboard, analytics, metric, revoke };
}
export {
  createScheduling,
  credential,
  hash,
  secret
};
