import express from "express";
import { createScheduling, hash, secret } from "./service.mjs";
import { createSchedulingGuests } from "./guests.mjs";
import { createSchedulingJobs } from "./jobs.mjs";
import { parseSchedule } from "./parser.mjs";
import { calendarInvitation } from "./calendar.mjs";
import { reject } from "./validation.mjs";
import {createGoogleCalendar} from './google-calendar/service.mjs';
import {mountCalendarRoutes} from './google-calendar/routes.mjs';
import {deliveryHistory} from './delivery-attempts.mjs';
function mountScheduling({ app, db, manager, now, origins, secureCookies, hostSession, validOrigin, safeAsync, rateLimited, transport = null, links = transport?.links, calendar={} }) {
  const service = createScheduling({ db, now, transport, links,calendarEnabled:calendar.config?.configured===true }), guests = createSchedulingGuests(service, manager), jobs = createSchedulingJobs(service), googleCalendar=createGoogleCalendar(service,calendar);
  manager?.setSchedulingGuests(guests);
  const base = "/api/auth/scheduling", router = express.Router(), json = express.json({ limit: "32kb" });
  app.locals.scheduling = service;
  app.locals.schedulingJobs = jobs;
  app.locals.schedulingGuests = guests;
  app.locals.googleCalendar=googleCalendar;
  let pending = Promise.resolve(),ticking=false;
  const timer = setInterval(() => {
    if(ticking)return;ticking=true;
    pending = Promise.allSettled([jobs.tick(),db.withContext(()=>googleCalendar.worker.tick())]).finally(()=>{ticking=false;});
  }, 3e4);
  timer.unref();
  app.locals.schedulingShutdown = () => {
    clearInterval(timer);
    return pending;
  };
  const host = (handler) => safeAsync(async (req, res) => {
    const session = await hostSession(req, res);
    if (!session) return;
    if (req.method !== "GET" && req.get("X-CSRF-Token") !== session.csrf_token) reject(403, "invalid_csrf", "Refresh Talk before changing bookings.");
    await handler(req, res, session.account_id,session);
  });
  router.use(safeAsync(async (req, res, next) => {
    if (await rateLimited(req, res, "scheduling", req.ip || "local", { email: 240, ip: 240, window: 6e4 })) return;
    next();
  }));
  router.use((req, res, next) => req.method === "GET" ? next() : validOrigin(req, res, () => json(req, res, next)));
  router.use((req, _res, next) => {
    if (req.method !== "GET" && (!req.body || typeof req.body !== "object" || Array.isArray(req.body))) {
      try {
        reject(400, "invalid_scheduling_input", "Enter a valid scheduling request.");
      } catch (error) {
        return next(error);
      }
    }
    next();
  });
  mountCalendarRoutes(router,host,googleCalendar,service);
  const publicWrite = (handler) => safeAsync(async (req, res) => {
    const token = req.get("X-Scheduling-Token");
    if (!token || !/^[-\w]{43}$/.test(token) || !await service.get("SELECT 1 AS ok FROM scheduling_challenges WHERE token_hash=? AND expires_at>?", hash(token), now())) reject(403, "invalid_booking_form", "Refresh the booking page before continuing.");
    await handler(req, res);
  });
  router.get("/form", safeAsync(async (req, res) => {
    await service.run("DELETE FROM scheduling_challenges WHERE expires_at<=?", now());
    const t = secret();
    await service.run("INSERT INTO scheduling_challenges(token_hash,expires_at) VALUES (?,?)", hash(t), now() + 36e5);
    res.json({ formToken: t });
  }));
  router.get("/dashboard", host(async (_req, res, id) => res.json(await service.dashboard(id))));
  router.get('/email-deliveries',host(async(_req,res,id)=>res.json(await deliveryHistory(service,id))));
  router.post("/profile", host(async (req, res, id) => res.json(await service.saveProfile(id, req.body))));
  router.post("/events", host(async (req, res, id) => res.status(201).json(await service.createEvent(id, req.body))));
  router.post("/events/:id/manage", host(async (req, res, id) => res.json(await service.manageEvent(id, req.params.id, req.body))));
  router.post("/parse", host(async (req, res) => res.json(parseSchedule(req.body?.prompt))));
  router.get("/analytics", host(async (_req, res, id) => res.json(await service.analytics(id))));
  router.get("/public/:host/:event", safeAsync(async (req, res) => res.json({ event: await service.resolve(req.params.host, req.params.event) })));
  router.get("/events/:id/slots", safeAsync(async (req, res) => res.json(await service.slots(req.params.id, { from: Number(req.query.from), to: Number(req.query.to), timezone: req.query.timezone }))));
  router.post("/events/:id/book", publicWrite(async (req, res) => res.status(201).json(await service.book(req.params.id, { ...req.body, analyticsConsent: req.body.analyticsConsent === true && req.get("DNT") !== "1" && req.get("Sec-GPC") !== "1", analyticsToken: req.get("X-Scheduling-Token") }))));
  router.post("/events/:id/metric", publicWrite(async (req, res) => res.json(req.get("Sec-GPC") === "1" || req.get("DNT") === "1" ? { tracked: false } : await service.metric(req.params.id, req.body, req.get("X-Scheduling-Token")))));
  router.post("/booking/:id/detail", publicWrite(async (req, res) => res.json(await service.detail(req.params.id, req.body.credential))));
  router.post("/booking/:id/change", publicWrite(async (req, res) => res.json(await service.change(req.params.id, req.body))));
  router.get("/host-booking/:id", host(async (req, res, id) => res.json(await service.detail(req.params.id, void 0, id))));
  router.post("/host-booking/:id/change", host(async (req, res, id) => res.json(await service.change(req.params.id, req.body, id))));
  router.post("/booking/:id/calendar", publicWrite(async (req, res) => {
    const { booking: b } = await service.detail(req.params.id, req.body.credential);
    res.set({ "Content-Disposition": 'attachment; filename="talk-booking.ics"', "Content-Security-Policy": "default-src 'none'; sandbox" }).type("text/calendar").send(calendarInvitation({ id: b.id, title: b.event.title, start: b.start, end: b.end, version: b.version, cancelled: b.status === "cancelled" }));
  }));
  router.post("/booking/:id/code", publicWrite(async (req, res) => res.json(await guests.challenge(req.params.id, req.body.credential))));
  router.post("/booking/:id/redeem", publicWrite(async (req, res) => {
    const result = await guests.redeem(req.params.id, req.body.credential, req.body.code);
    res.cookie("talk_booking_guest", result.token, { httpOnly: true, secure: secureCookies, sameSite: "lax", path: base, maxAge: 4 * 36e5 });
    res.json({ csrfToken: result.csrfToken, meetingId: result.meetingId });
  }));
  const guest = (handler) => safeAsync(async (req, res) => {
    const raw = (req.headers.cookie || "").split(";").map((v) => v.trim()).filter((v) => v.startsWith("talk_booking_guest="));
    const session = raw.length === 1 ? await guests.session(raw[0].slice("talk_booking_guest=".length), req.params.id) : null;
    if (!session) reject(401, "guest_session_required", "Verify your booking invitation before joining.");
    if (req.method !== "GET" && req.get("X-CSRF-Token") !== session.csrf_token) reject(403, "invalid_csrf", "Refresh your guest session.");
    await handler(req, res, session);
  });
  router.get("/guest/meetings/:id", guest(async (req, res, gs) => res.json({ meeting: await manager.meeting(req.params.id).then((m) => ({ id: m.id, title: m.title })), configured: true, csrfToken: gs.csrf_token })));
  router.get("/guest/meetings/:id/state", guest(async (_req, res, gs) => res.json(await guests.state(gs))));
  router.post("/guest/meetings/:id/token", guest(async (req, res, gs) => {
    const result = await guests.access(gs, req.body.displayName, [...origins][0]);
    res.status(result.joinState ? 202 : 200).json(result);
  }));
  router.post("/guest/meetings/:id/actions", guest(async (req, res, gs) => res.json(await guests.selfAction(gs, req.body))));
  router.get("/embed/:id", safeAsync(async (req, res) => {
    const e = await service.publicEvent(req.params.id), p = await service.profile((await service.event(e.id)).host_id), parent = String(req.query.parent || "");
    if (!p.settings.embedOrigins.includes(parent)) reject(403, "embed_origin_denied", "The host has not authorized this parent origin.");
    res.json({ event: e, parent, src: `/booking/${e.hostSlug}/${e.slug}?embed=1&parent=${encodeURIComponent(parent)}`, sandbox: "allow-scripts allow-forms allow-same-origin allow-popups", referrerPolicy: "no-referrer" });
  }));
  app.use(base, router);
  app.use("/booking", (req, res, next) => {
    if (req.query.embed === "1") {
      void db.withContext(async () => {
        const parts = req.path.split("/").filter(Boolean), e = await service.resolve(parts[0], parts[1]), p = await service.profile((await service.event(e.id)).host_id), parent = String(req.query.parent || "");
        if (!p.settings.embedOrigins.includes(parent)) return res.status(403).send("Embedding is not authorized.");
        res.set({ "Content-Security-Policy": `frame-ancestors ${parent}`, "Referrer-Policy": "no-referrer" });
        next();
      }).catch(() => res.status(404).send("Booking unavailable."));
    } else {
      res.set({ "Content-Security-Policy": "frame-ancestors 'none'", "Referrer-Policy": "no-referrer" });
      next();
    }
  });
  return { service, guests, jobs };
}
export {
  mountScheduling
};
