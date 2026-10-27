import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openAuthDatabase } from '../database.mjs';
import { asyncDatabase } from '../async-database.mjs';
import { createScheduling, secret } from './service.mjs';
import { createEmailLinks } from './email-links.mjs';
import { renderSchedulingEmail } from './email-templates.mjs';
import { emailBookingSql } from './email-outbox.mjs';
import { calendarInvitation } from './calendar.mjs';
import { createVerificationMailer } from '../mailer.mjs';

const scope = 'talk:phase11:gmail:first-confirmation:v1';
const privateRequests = new WeakMap();
const digest = value => createHash('sha256').update(value).digest('hex');
const redact = value => value.replace(/#[A-Za-z0-9_-]{43}/g, '#[PRIVATE_BOOKING_CREDENTIAL]');
const qaRoot = path.resolve('artifacts/qa');
function inside(root, filename) {
  const relative = path.relative(root, filename);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function artifactPath(filename, { create = false } = {}) {
  const absolute = path.resolve(filename);
  if (!inside(qaRoot, absolute)) throw new Error('Smoke test artifacts must remain under artifacts/qa.');
  mkdirSync(qaRoot, { recursive: true });
  const actualRoot = realpathSync(qaRoot);
  let ancestor = absolute;
  while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (!inside(actualRoot, realpathSync(ancestor))) throw new Error('Smoke test artifact path is unsafe.');
  if (create) mkdirSync(absolute, { recursive: true });
  if (existsSync(absolute) && !inside(actualRoot, realpathSync(absolute))) throw new Error('Smoke test artifact path is unsafe.');
  return absolute;
}
function fingerprintOf({ sender, recipient, configurationIdentity, mail }) {
  return digest(JSON.stringify({ scope, sender, recipient, configurationIdentity,
    subject: mail.subject, text: mail.text, html: mail.html, calendar: mail.calendar, jobId: mail.jobId }));
}

/** Pure offline validation. The verification mailer constructs SMTP lazily, only on send/verify. */
export function schedulingEmailSmokeConfiguration(env) {
  if ([env.SCHEDULING_EMAIL_ENABLED, env.WHITEBOARD_CLOUD_AI_ENABLED, env.WHITEBOARD_CLOUD_AI_OPERATOR_APPROVED]
    .some(value => value === 'true')) throw new Error('Normal scheduling delivery and Cloud AI must remain disabled.');
  if (!createVerificationMailer(env).configured) throw new Error('SMTP configuration is incomplete or invalid.');
  const named = /^(?:"[^"<>]+"|[^"<>]+)\s*<([^<>]+)>$/.exec(env.SMTP_FROM.trim());
  const sender = address(named ? named[1].trim() : env.SMTP_FROM.trim());
  const baseUrl = env.SCHEDULING_PUBLIC_URL, linkSecret = env.SCHEDULING_EMAIL_LINK_SECRET;
  createEmailLinks({ baseUrl, secret: linkSecret });
  const configurationIdentity = digest(JSON.stringify({ host: env.SMTP_HOST || 'smtp.gmail.com',
    port: env.SMTP_PORT || '587', user: env.SMTP_USER, from: env.SMTP_FROM, publicUrl: baseUrl,
    passwordHash: digest(env.SMTP_PASSWORD), signingSecretHash: digest(linkSecret) }));
  return { sender, baseUrl, linkSecret, configurationIdentity };
}
function address(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(value) || value.length > 254)
    throw new Error('Use one plain sender address and one explicitly selected recipient address.');
  return value;
}
function ledger(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS email_smoke_attempts (
      scope TEXT PRIMARY KEY, consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1)),
      fingerprint TEXT NOT NULL, status TEXT NOT NULL, prepared_at INTEGER NOT NULL,
      dispatched_at INTEGER, completed_at INTEGER, smtp_accepted INTEGER NOT NULL DEFAULT 0
    )`);
  return db;
}

/** Offline only. Creates synthetic records in a new isolated DB; never starts a worker or SMTP. */
export async function prepareSchedulingEmailSmokeTest({ recipient, sender, baseUrl, linkSecret,
  configurationIdentity, outputRoot = path.resolve('artifacts/qa'), now = Date.now() }) {
  recipient = address(recipient); sender = address(sender);
  if (typeof configurationIdentity !== 'string' || !/^[a-f0-9]{64}$/.test(configurationIdentity))
    throw new Error('A private configuration fingerprint is required.');
  const links = createEmailLinks({ baseUrl, secret: linkSecret });
  outputRoot = artifactPath(outputRoot, { create: true });
  const directory = mkdtempSync(path.join(outputRoot, 'phase11-gmail-smoke-'));
  const databasePath = path.join(directory, 'synthetic.sqlite');
  const ledgerPath = path.join(path.resolve(outputRoot), 'phase11-gmail-first-attempt.sqlite');
  const raw = openAuthDatabase(databasePath), db = asyncDatabase(raw);
  let mail, bookingId;
  try {
    const scheduling = createScheduling({ db, now: () => now, transport: null });
    await db.withContext(async () => {
      const host = randomUUID();
      await scheduling.run('INSERT INTO accounts(id,name,email,email_verified,created_at) VALUES (?,?,?,1,?)',
        host, 'Talk Synthetic Test Host', `host-${host}@example.invalid`, now);
      await scheduling.saveProfile(host, { slug: `test-${host}`, timezone: 'Asia/Kolkata',
        settings: { notice: 0, bufferAfter: 0 }, windows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: 0, end: 1440 })) });
      const { event } = await scheduling.createEvent(host, { slug: 'synthetic-confirmation',
        title: 'Talk SMTP delivery test — fictional booking', duration: 30, capacity: 1 });
      const start = Math.ceil((now + 2 * 86400000) / 900000) * 900000;
      const confirmed = await scheduling.book(event.id, { start, name: 'Synthetic Test Invitee',
        email: recipient, timezone: 'Asia/Kolkata', credential: secret(), answers: {} });
      // No standard worker is constructed. Cancel all automatically queued jobs
      // in this isolated DB as a second defence against reminders or host mail.
      await scheduling.run("UPDATE scheduling_jobs SET status='cancelled',error_code='offline_smoke_no_worker'");
      const b = await scheduling.get(emailBookingSql, confirmed.booking.id);
      bookingId = b.id;
      const rendered = renderSchedulingEmail({ kind: 'confirmation', recipient: 'invitee', b,
        host: { name: b.host_name, email: b.host_email, timezone: b.host_timezone },
        hostUrl: links.hostUrl(b), inviteeUrl: links.inviteeUrl(b) });
      mail = { jobId: `smoke-${randomUUID()}`, to: recipient, ...rendered,
        calendar: calendarInvitation({ id: b.id, title: b.title, start: b.starts_at, end: b.ends_at, version: b.version }) };
    });
  } finally { raw.close(); }
  // Fingerprint covers the exact unredacted message, envelope and private
  // configuration identity. Only the digest is persisted, never the credential.
  const fingerprint = fingerprintOf({ sender, recipient, configurationIdentity, mail });
  const attemptDb = ledger(ledgerPath);
  let consumed;
  try {
    attemptDb.prepare(`INSERT INTO email_smoke_attempts(scope,fingerprint,status,prepared_at)
      VALUES (?,?,'prepared',?) ON CONFLICT(scope) DO UPDATE SET
      fingerprint=excluded.fingerprint,prepared_at=excluded.prepared_at WHERE consumed=0`).run(scope, fingerprint, now);
    consumed = attemptDb.prepare('SELECT consumed FROM email_smoke_attempts WHERE scope=?').get(scope).consumed;
  } finally { attemptDb.close(); }
  const review = Object.freeze({ mode: 'OFFLINE_PREPARATION_ONLY', sender: sender.replace(/^(.).*(@.*)$/, '$1***$2'),
    recipient, subject: mail.subject, text: redact(mail.text), html: redact(mail.html),
    calendar: mail.calendar, emailsToSendAfterExplicitApproval: 1, attemptsConsumed: consumed,
    joiningLinkExternalReachability: 'UNVERIFIED — no network request performed',
    bookingRouteReachability: 'UNVERIFIED_ISOLATED_DB_NOT_SERVED',
    joiningLinkOrigin: new URL(baseUrl).origin, requestFingerprint: fingerprint,
    normalSchedulingEmailEnabled: false, realEmailSent: false });
  writeFileSync(path.join(directory, 'review.json'), JSON.stringify(review, null, 2) + '\n', { flag: 'wx' });
  writeFileSync(path.join(directory, 'metadata.json'), JSON.stringify({ schema: 1, scope, bookingId,
    sender, jobId: mail.jobId, preparedAt: now }, null, 2) + '\n', { flag: 'wx' });
  const prepared = Object.freeze({ review, directory, databasePath, ledgerPath });
  privateRequests.set(prepared, { mail, sender, recipient, fingerprint, configurationIdentity });
  return prepared;
}

/** Existing served fixture only: read-only DB, no workers, no SMTP construction.
 * This binds the same durable first-email scope to the exact served message.
 * Protect outputRoot with a private OS ACL before calling with real addresses.
 */
export function prepareServedSchedulingEmailSmokeTest({databasePath,bookingId,recipient,sender,baseUrl,linkSecret,
  configurationIdentity,outputRoot=qaRoot,ledgerFilename=path.join(qaRoot,'phase11-gmail-first-attempt.sqlite'),managementEnabled=true,now=Date.now()}) {
  recipient=address(recipient);sender=address(sender);
  if(!/^[a-f0-9]{64}$/.test(configurationIdentity||''))throw new Error('Invalid private configuration identity.');
  const sourceRoot=path.resolve('data/booking-link-test'),source=path.resolve(databasePath);
  if(!inside(sourceRoot,source)||!inside(sourceRoot,realpathSync(source))||
    readFileSync(path.join(path.dirname(source),'.synthetic-booking-test'),'utf8')!=='Talk isolated synthetic booking test v1\n')
    throw new Error('Only the marked isolated served fixture may be reviewed.');
  const raw=new DatabaseSync(source,{readOnly:true});let b;
  try {
    if(raw.prepare('SELECT COUNT(*) n FROM accounts').get().n!==1||raw.prepare('SELECT COUNT(*) n FROM scheduling_bookings').get().n<1||
      raw.prepare("SELECT COUNT(*) n FROM scheduling_jobs WHERE status!='cancelled'").get().n!==0)throw new Error('Unexpected fixture records or enabled jobs.');
    b=raw.prepare(emailBookingSql).get(bookingId);
    if(!b||b.host_name!=='Synthetic Booking Test Host'||b.name!=='Synthetic Test Invitee'||b.email!==recipient||b.status!=='confirmed'||now>b.ends_at+3600000||
      !raw.prepare('SELECT 1 ok FROM scheduling_invitations WHERE booking_id=? AND revoked=0 AND expires_at>?').get(bookingId,now))throw new Error('The served invitation is unavailable.');
    if(raw.prepare("SELECT COUNT(*) n FROM scheduling_bookings b JOIN scheduling_occurrences o ON o.id=b.occurrence_id JOIN scheduling_events e ON e.id=o.event_id WHERE b.host_id<>? OR b.email<>? OR b.name<>'Synthetic Test Invitee' OR e.title<>'Synthetic OrbitMeet booking link test'").get(b.host_id,recipient).n)throw new Error('Unexpected non-synthetic booking history.');
  }finally{raw.close();}
  const links=createEmailLinks({baseUrl,secret:linkSecret});
  const inviteeUrl=links.inviteeUrl(b);
  if(!links.verify(b,new URL(inviteeUrl).hash.slice(1),now))throw new Error('Served signing verification failed.');
  const mail={jobId:`smoke-${randomUUID()}`,to:recipient,
    ...renderSchedulingEmail({kind:'confirmation',recipient:'invitee',b,host:{name:b.host_name,email:b.host_email,timezone:b.host_timezone},hostUrl:links.hostUrl(b),inviteeUrl,managementEnabled}),
    calendar:calendarInvitation({id:b.id,title:b.title,start:b.starts_at,end:b.ends_at,version:b.version})};
  const directory=mkdtempSync(path.join(artifactPath(outputRoot),'served-preview-'));
  const ledgerPath=artifactPath(ledgerFilename);
  const fingerprint=fingerprintOf({sender,recipient,configurationIdentity,mail});
  const db=ledger(ledgerPath);let attempts;
  try{
    db.exec('BEGIN IMMEDIATE');
    const prior=db.prepare('SELECT consumed FROM email_smoke_attempts WHERE scope=?').get(scope);
    if(prior?.consumed)throw new Error('The first email attempt has already been consumed.');
    db.prepare(`INSERT INTO email_smoke_attempts(scope,fingerprint,status,prepared_at) VALUES (?,?,'prepared',?)
      ON CONFLICT(scope) DO UPDATE SET fingerprint=excluded.fingerprint,status='prepared',prepared_at=excluded.prepared_at WHERE consumed=0`).run(scope,fingerprint,now);
    attempts=db.prepare('SELECT consumed FROM email_smoke_attempts WHERE scope=?').get(scope).consumed;db.exec('COMMIT');
  }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}finally{db.close();}
  const review={mode:'SERVED_FIXTURE_PREVIEW_ONLY',sender,recipient,subject:mail.subject,text:redact(mail.text),html:redact(mail.html),
    joiningLink:redact(inviteeUrl),joiningLinkOrigin:new URL(baseUrl).origin,expiresAt:b.ends_at+3600000,startsAt:b.starts_at,endsAt:b.ends_at,
    emailsToSendAfterExplicitApproval:1,attemptsConsumed:attempts,realEmailSent:false,normalSchedulingEmailEnabled:false,requestFingerprint:fingerprint};
  const save=(name,value)=>writeFileSync(path.join(directory,name),value,{flag:'wx',mode:0o600});
  save('review.json',JSON.stringify(review,null,2));save('preview.txt',review.text);save('preview.html',review.html);
  save('message.private.json',JSON.stringify({sender,recipient,...mail},null,2));save('preview.private.txt',mail.text);save('preview.private.html',mail.html);save('talk-booking.ics',mail.calendar);
  save('metadata.json',JSON.stringify({scope,bookingId:b.id,databasePath:source,jobId:mail.jobId,preparedAt:now,source:'served-fixture',configurationIdentity},null,2));
  const prepared=Object.freeze({review:Object.freeze(review),directory,databasePath:source,ledgerPath});
  privateRequests.set(prepared,{mail,sender,recipient,fingerprint,configurationIdentity});return prepared;
}

/** Restore a reviewed request after restart without persisting bearer tokens or SMTP secrets. */
export function restoreServedSchedulingEmailSmokeTest({directory,linkSecret,baseUrl,configurationIdentity,recipient,now=Date.now(),ledgerFilename=path.join(qaRoot,'phase11-gmail-first-attempt.sqlite')}) {
  directory=artifactPath(directory);
  const load=name=>JSON.parse(readFileSync(artifactPath(path.join(directory,name)),'utf8'));
  const metadata=load('metadata.json'),review=load('review.json'),saved=load('message.private.json');
  recipient=address(recipient);
  const source=path.resolve(metadata.databasePath||''),sourceRoot=path.resolve('data/booking-link-test');
  if(metadata.source!=='served-fixture'||metadata.scope!==scope||metadata.configurationIdentity!==configurationIdentity||
    !inside(sourceRoot,source)||!inside(sourceRoot,realpathSync(source))||
    readFileSync(path.join(path.dirname(source),'.synthetic-booking-test'),'utf8')!=='Talk isolated synthetic booking test v1\n')
    throw new Error('The approved served fixture or configuration changed.');
  const raw=new DatabaseSync(source,{readOnly:true});let b;
  try {
    b=raw.prepare(emailBookingSql).get(metadata.bookingId);
    if(!b||b.status!=='confirmed'||b.starts_at<=now||b.email!==recipient||b.name!=='Synthetic Test Invitee'||
      b.host_name!=='Synthetic Booking Test Host'||b.title!=='Synthetic OrbitMeet booking link test'||
      raw.prepare("SELECT COUNT(*) n FROM scheduling_jobs WHERE status<>'cancelled'").get().n!==0||
      !raw.prepare('SELECT 1 ok FROM scheduling_invitations WHERE booking_id=? AND revoked=0 AND expires_at>?').get(b.id,now))
      throw new Error('The reviewed future invitation is unavailable.');
  } finally {raw.close();}
  const links=createEmailLinks({baseUrl,secret:linkSecret}),url=links.inviteeUrl(b),sender=address(saved.sender);
  if(!links.verify(b,new URL(url).hash.slice(1),now))throw new Error('The reviewed invitation is invalid.');
  const mail={jobId:metadata.jobId,to:recipient,...renderSchedulingEmail({kind:'confirmation',recipient:'invitee',b,
    host:{name:b.host_name,email:b.host_email,timezone:b.host_timezone},hostUrl:links.hostUrl(b),inviteeUrl:url,managementEnabled:false}),
    calendar:calendarInvitation({id:b.id,title:b.title,start:b.starts_at,end:b.ends_at,version:b.version})};
  // The approved attachment's creation time is immutable across process restarts.
  const approvedStamp=typeof saved.calendar==='string'&&/^DTSTAMP:(\d{8}T\d{6}Z)\r?$/m.exec(saved.calendar)?.[1];
  if(!approvedStamp)throw new Error('The approved calendar timestamp is invalid.');
  mail.calendar=mail.calendar.replace(/^DTSTAMP:[^\r\n]+/m,'DTSTAMP:'+approvedStamp);
  const fingerprint=fingerprintOf({sender,recipient,configurationIdentity,mail});
  if(Object.entries(mail).some(([key,value])=>saved[key]!==value)||readFileSync(path.join(directory,'talk-booking.ics'),'utf8')!==mail.calendar||
    review.requestFingerprint!==fingerprint||review.sender!==sender||review.recipient!==recipient||review.subject!==mail.subject||
    review.text!==redact(mail.text)||review.html!==redact(mail.html)||review.joiningLinkOrigin!==new URL(baseUrl).origin||
    review.startsAt!==b.starts_at||review.endsAt!==b.ends_at)
    throw new Error('The exact reviewed message, calendar or booking changed.');
  const ledgerPath=artifactPath(ledgerFilename),db=new DatabaseSync(ledgerPath,{readOnly:true});let attempt;
  try{attempt=db.prepare('SELECT consumed,fingerprint FROM email_smoke_attempts WHERE scope=?').get(scope);}finally{db.close();}
  if(!attempt||attempt.consumed!==0||attempt.fingerprint!==fingerprint)throw new Error('The single approved attempt is unavailable.');
  const prepared=Object.freeze({review:Object.freeze({...review,attemptsConsumed:0}),directory,databasePath:source,ledgerPath});
  privateRequests.set(prepared,{mail,sender,recipient,fingerprint,configurationIdentity});return prepared;
}

/** Restore an unserved, standalone synthetic preview. */
export function restorePreparedSchedulingEmailSmokeTest({ directory, linkSecret, baseUrl, configurationIdentity }) {
  directory = artifactPath(directory);
  const metadata = JSON.parse(readFileSync(artifactPath(path.join(directory, 'metadata.json')), 'utf8'));
  const review = JSON.parse(readFileSync(artifactPath(path.join(directory, 'review.json')), 'utf8'));
  if (metadata.schema !== 1 || metadata.scope !== scope || typeof metadata.jobId !== 'string')
    throw new Error('The saved smoke test review is invalid.');
  const sender = address(metadata.sender), links = createEmailLinks({ baseUrl, secret: linkSecret });
  const databasePath = artifactPath(path.join(directory, 'synthetic.sqlite'));
  const ledgerPath = artifactPath(path.join(path.dirname(directory), 'phase11-gmail-first-attempt.sqlite'));
  // Read-only native SQLite deliberately bypasses application migrations and workers.
  const raw = new DatabaseSync(databasePath, { readOnly: true });
  let b;
  try {
    if (raw.prepare('SELECT COUNT(*) AS n FROM scheduling_bookings').get().n !== 1 ||
      raw.prepare('SELECT COUNT(*) AS n FROM accounts').get().n !== 1 ||
      raw.prepare("SELECT COUNT(*) AS n FROM scheduling_jobs WHERE status<>'cancelled'").get().n !== 0)
      throw new Error('Only the isolated synthetic booking can be restored.');
    b = raw.prepare(emailBookingSql).get(metadata.bookingId);
    if (!b || b.host_name !== 'Talk Synthetic Test Host' || !b.host_email.endsWith('@example.invalid'))
      throw new Error('Only the isolated synthetic booking can be restored.');
  } finally { raw.close(); }
  const rendered = renderSchedulingEmail({ kind: 'confirmation', recipient: 'invitee', b,
    host: { name: b.host_name, email: b.host_email, timezone: b.host_timezone },
    hostUrl: links.hostUrl(b), inviteeUrl: links.inviteeUrl(b) });
  const mail = { jobId: metadata.jobId, to: address(b.email), ...rendered, calendar: review.calendar };
  const fingerprint = fingerprintOf({ sender, recipient: mail.to, configurationIdentity, mail });
  const saved = new DatabaseSync(ledgerPath, { readOnly: true });
  let attempt;
  try { attempt = saved.prepare('SELECT * FROM email_smoke_attempts WHERE scope=?').get(scope); }
  finally { saved.close(); }
  if (!attempt || attempt.fingerprint !== fingerprint || review.requestFingerprint !== fingerprint ||
    review.recipient !== mail.to || review.subject !== mail.subject || review.text !== redact(mail.text) ||
    review.html !== redact(mail.html)) throw new Error('The reviewed message or configuration changed; new approval is required.');
  const prepared = Object.freeze({ review: Object.freeze({ ...review, attemptsConsumed: attempt.consumed }), directory, databasePath, ledgerPath });
  privateRequests.set(prepared, { mail, sender, recipient: mail.to, fingerprint, configurationIdentity });
  return prepared;
}

/**
 * No network implementation: callers must supply an explicitly authorized
 * adapter. A reserved attempt is never retried, including crashes and failures.
 * The preparation CLI deliberately exposes no route to this function.
 */
export async function dispatchPreparedSchedulingEmailSmokeTest(prepared, { approval, configurationIdentity, send, now = Date.now } = {}) {
  const request = privateRequests.get(prepared);
  if (!request || approval?.approved !== true || approval.fingerprint !== request.fingerprint ||
    approval.recipient !== request.recipient || approval.joiningLinkVerified !== true ||
    configurationIdentity !== request.configurationIdentity || typeof send !== 'function')
    throw new Error('Explicit approval of the exact reviewed recipient and message is required.');
  const db = ledger(prepared.ledgerPath);
  try {
    db.exec('BEGIN IMMEDIATE');
    const changed = db.prepare(`UPDATE email_smoke_attempts SET consumed=1,status='reserved',dispatched_at=?
      WHERE scope=? AND consumed=0 AND fingerprint=?`).run(now(), scope, request.fingerprint);
    if (changed.changes !== 1) throw new Error('The single email attempt is unavailable or the review changed.');
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    db.close(); throw error;
  }
  let status = 'failed_or_acceptance_unknown', accepted = false;
  try {
    const response = await send(request.mail);
    accepted = response?.accepted === true;
    status = accepted ? 'smtp_accepted' : 'acceptance_unverified';
  } catch {
    // Do not persist SMTP errors: providers may embed credentials or recipients.
  }
  try {
    db.prepare('UPDATE email_smoke_attempts SET status=?,smtp_accepted=?,completed_at=? WHERE scope=?')
      .run(status, accepted ? 1 : 0, now(), scope);
  } finally { db.close(); }
  const result = Object.freeze({ deliveryAttempted: true, attemptsConsumed: 1, status, smtpAccepted: accepted,
    inboxDelivery: 'UNVERIFIED', fingerprint: request.fingerprint });
  writeFileSync(path.join(prepared.directory, 'result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  return result;
}
