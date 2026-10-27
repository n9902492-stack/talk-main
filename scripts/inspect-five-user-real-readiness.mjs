// Read-only runtime/database inspection. Never prints verified identities or secrets.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import dotenv from 'dotenv';
import { createVerificationMailer } from '../backend/src/mailer.mjs';
const launch = JSON.parse(fs.readFileSync('artifacts/qa/five-user-public-launch.json'));
const server = JSON.parse(fs.readFileSync(launch.serverState)), connector = JSON.parse(fs.readFileSync(launch.connectorState));
const test = dotenv.parse(fs.readFileSync('.env.tunnel-test.local')), local = dotenv.parse(fs.readFileSync('.env.local'));
const emails = test.TUNNEL_TEST_EMAILS.split(',').map(v => v.trim().toLowerCase());
const hash = value => createHash('sha256').update(value).digest('hex');
const db = new DatabaseSync(launch.databasePath, { readOnly: true });
try {
  const now = Date.now(), accounts = db.prepare('SELECT id,email,email_verified FROM accounts').all();
  const verified = accounts.filter(a => emails.includes(a.email.toLowerCase()) && a.email_verified && db.prepare("SELECT 1 FROM identities WHERE account_id=? AND provider='password' AND verified_at IS NOT NULL AND password_hash IS NOT NULL").get(a.id));
  const pending = emails.filter(e => !verified.some(a => a.email.toLowerCase() === e)).map(email => {
    const account = accounts.find(a => a.email.toLowerCase() === email);
    const challenge = db.prepare('SELECT MAX(resend_at) AS resendAt,MAX(expires_at) AS expiresAt FROM email_challenges WHERE LOWER(email)=?').get(email);
    const buckets = ['signup', 'email-delivery'].map(ns => db.prepare('SELECT count,resets_at FROM rate_limits WHERE bucket=?').get(ns + ':email:' + hash(email))).filter(Boolean).map(r => ({ count: r.count, resetsAt: new Date(r.resets_at).toISOString(), currentlyActive: r.resets_at > now }));
    return { email, accountExists: Boolean(account), emailVerified: Boolean(account?.email_verified), eligible: true, reason: account ? 'Existing identity requires normal email proof' : 'No account/password identity exists in isolated database; normal signup required', cooldownSeconds: Math.max(0, Math.ceil(((challenge.resendAt || 0) - now) / 1000)), activeChallenge: challenge.expiresAt > now, rateBuckets: buckets };
  });
  const meeting = db.prepare('SELECT id,status,approval_required,owner_account_id FROM talk_meetings WHERE id=?').get(launch.meetingId);
  const data = { checkedAt: new Date(now).toISOString(), origin: server.origin, serverStatus: server.status, connectorConnected: connector.connected, serverPid: server.serverPid, connectorPid: connector.connectorPid, allowlistCount: emails.length, uniqueAllowlist: new Set(emails).size, verifiedAccounts: verified.length, independentSessions: verified.map((a, i) => ({ alias: 'Verified tester ' + (i + 1), host: a.id === meeting.owner_account_id, activeSessions: db.prepare('SELECT COUNT(*) n FROM sessions WHERE account_id=? AND expires_at>? AND requires_confirmation=0').get(a.id, now).n })), pendingAccounts: pending, meetingActive: meeting.status === 'active', admissionRequired: Boolean(meeting.approval_required), hostVerified: verified.some(a => a.id === meeting.owner_account_id), activeMeetingMembers: db.prepare("SELECT COUNT(*) n FROM talk_meeting_members WHERE meeting_id=? AND admission='admitted'").get(launch.meetingId).n, configuredGmailAdapter: createVerificationMailer(local).configured && (local.SMTP_HOST || 'smtp.gmail.com').toLowerCase() === 'smtp.gmail.com' && String(local.SMTP_PORT || '587') === '587', liveMailerInstalled: false, smtpConnectionTestedNow: false, realEmailsSent: 0, activeProcessesRestarted: false };
  const privateFile = path.join(launch.directory, 'real-public-readiness.private.json');
  fs.writeFileSync(privateFile, JSON.stringify(data, null, 2), { mode: 0o600 });
  const safe = { ...data, pendingAccounts: pending.map((p, i) => ({ ...p, email: undefined, alias: 'Pending tester ' + (i + 1) })) };
  fs.writeFileSync('artifacts/qa/five-user-real-readiness.json', JSON.stringify(safe, null, 2));
  if (process.argv.includes('--host-login')) {
    const [health, login] = await Promise.all(['/healthz', '/sign-in'].map(p => fetch(server.origin + p, { signal: AbortSignal.timeout(12000) })));
    const host = accounts.find(a => a.id === meeting.owner_account_id);
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), healthStatus: health.status, loginStatus: login.status, origin: server.origin, hostEmail: host.email, hostVerified: data.hostVerified, meetingActive: data.meetingActive, smtp: (await health.json()).smtp }));
  } else console.log(JSON.stringify(safe, null, 2));
} finally { db.close(); }
