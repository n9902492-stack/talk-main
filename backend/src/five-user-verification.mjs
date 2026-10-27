// Dormant until separately approved. Normal signup/OTP verification stays in auth.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import nodemailer from 'nodemailer';
import { createVerificationMailer } from './mailer.mjs';
import { schedulingEmailSmokeConfiguration } from './scheduling/email-smoke-test.mjs';
const adapters = new WeakMap(), hash = value => createHash('sha256').update(value).digest('hex');
const ensure = ok => { if (!ok) throw Error('Controlled account verification unavailable. Private details withheld.'); };
function binding(config, launchId, env) {
  ensure(/^[a-f\d-]{36}$/.test(launchId) && config.allowedEmails.length === 5);
  ensure(config.databasePath === path.join(config.directory, 'talk.sqlite') && !fs.lstatSync(config.directory).isSymbolicLink());
  const smtp = schedulingEmailSmokeConfiguration({ ...env, SCHEDULING_PUBLIC_URL: config.origin });
  ensure((env.SMTP_HOST || 'smtp.gmail.com').toLowerCase() === 'smtp.gmail.com' && (env.SMTP_PORT || '587') === '587' && smtp.sender.toLowerCase() === env.SMTP_USER.toLowerCase());
  return { format: 1, launchId, origin: config.origin, database: config.databasePath, sender: smtp.sender, subject: 'Your Talk verification code', configurationIdentity: smtp.configurationIdentity, allowlistIdentity: hash(JSON.stringify([...config.allowedEmails].sort())) };
}
function files(config) { return { policy: path.join(config.directory, 'account-verification-policy.private.json'), guard: path.join(config.directory, 'account-verification-guard.sqlite') }; }
function ledger(file) {
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS account_verification_attempts (
    recipient_hash TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN(0,1)),
    status TEXT NOT NULL, message_id TEXT NOT NULL UNIQUE, started_at INTEGER, completed_at INTEGER, smtp_code INTEGER)`);
  return db;
}
export function prepareFiveUserVerification({ config, launchId, env }) {
  const base = binding(config, launchId, env), f = files(config), raw = new DatabaseSync(config.databasePath, { readOnly: true });
  let policy;
  try {
    const verified = raw.prepare("SELECT a.email FROM accounts a JOIN identities i ON i.account_id=a.id AND i.provider='password' WHERE a.email_verified=1 AND i.verified_at IS NOT NULL").all().map(a => a.email.toLowerCase());
    const recipients = config.allowedEmails.filter(email => !verified.includes(email)); ensure(recipients.length === 2);
    policy = { ...base, recipients };
    if (fs.existsSync(f.policy)) ensure(fs.readFileSync(f.policy, 'utf8') === JSON.stringify(policy));
    else fs.writeFileSync(f.policy, JSON.stringify(policy), { flag: 'wx', mode: 0o600 });
  } finally { raw.close(); }
  const db = ledger(f.guard), fingerprint = hash(JSON.stringify(policy));
  try {
    for (const email of policy.recipients) {
      db.prepare("INSERT OR IGNORE INTO account_verification_attempts(recipient_hash,fingerprint,status,message_id) VALUES (?,?,'prepared',?)").run(hash(email), fingerprint, '<' + randomUUID() + '@talk.local>');
      ensure(db.prepare('SELECT fingerprint FROM account_verification_attempts WHERE recipient_hash=?').get(hash(email)).fingerprint === fingerprint);
    }
    return { policy, realDeliveryEnabled: false, proposedEmailCount: 2, attemptsConsumed: db.prepare('SELECT SUM(consumed) n FROM account_verification_attempts').get().n };
  } finally { db.close(); }
}
export function createFiveUserVerificationMailer({ config, launchId, env, approved = false, now = Date.now, createTransport = nodemailer.createTransport }) {
  const base = binding(config, launchId, env), f = files(config), policy = JSON.parse(fs.readFileSync(f.policy));
  for (const [key, value] of Object.entries(base)) ensure(policy[key] === value);
  ensure(policy.recipients.length === 2 && policy.recipients.every(e => config.allowedEmails.includes(e)));
  const fingerprint = hash(JSON.stringify(policy)); let armed = approved === true;
  const remaining = () => { const db = ledger(f.guard); try { return db.prepare('SELECT COUNT(*) n FROM account_verification_attempts WHERE fingerprint=? AND consumed=0').get(fingerprint).n; } finally { db.close(); } };
  const adapter = {
    get configured() { return armed && remaining() > 0; },
    disable() { armed = false; },
    permitsSignup(email) { return policy.recipients.includes(String(email).trim().toLowerCase()); },
    async sendVerification(mail) {
      ensure(armed && !mail.deliveryTest && (!mail.purpose || mail.purpose === 'verification'));
      const recipient = String(mail.to).trim().toLowerCase(), expiry = new Date(mail.expiresAt).getTime();
      ensure(policy.recipients.includes(recipient) && /^\d{6}$/.test(mail.code) && expiry > now() && expiry <= now() + 300000);
      const raw = new DatabaseSync(config.databasePath, { readOnly: true });
      try {
        const challenge = raw.prepare("SELECT c.*,a.email_verified,i.verified_at FROM email_challenges c JOIN accounts a ON a.id=c.account_id JOIN identities i ON i.account_id=a.id AND i.provider='password' WHERE c.email=? AND c.delivery_state='sending' ORDER BY c.created_at DESC LIMIT 1").get(recipient);
        ensure(challenge && !challenge.email_verified && !challenge.verified_at && challenge.purpose === 'signup' && challenge.expires_at === expiry && challenge.attempts === 0);
        const parts = String(challenge.code_hash).split('$');
        ensure(parts.length === 6 && parts.slice(0, 4).join('$') === 'scrypt$32768$8$1' && /^[a-f\d]{32}$/.test(parts[4]) && /^[a-f\d]{64}$/.test(parts[5]));
        const actual = scryptSync(challenge.id + ':' + challenge.generation + ':' + mail.code, parts[4], 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
        ensure(timingSafeEqual(actual, Buffer.from(parts[5], 'hex')));
      } finally { raw.close(); }
      const db = ledger(f.guard); let code = null, calls = 0;
      try {
        ensure(db.prepare("UPDATE account_verification_attempts SET consumed=1,status='reserved',started_at=? WHERE recipient_hash=? AND fingerprint=? AND consumed=0").run(now(), hash(recipient), fingerprint).changes === 1);
        const row = db.prepare('SELECT message_id FROM account_verification_attempts WHERE recipient_hash=?').get(hash(recipient));
        const mailer = createVerificationMailer(env, { createTransport: options => {
          const smtp = createTransport({ ...options, pool: false, maxRequeues: 0 });
          return { sendMail: async message => {
            ensure(++calls === 1 && message.to.address.toLowerCase() === recipient && message.from.address.toLowerCase() === policy.sender.toLowerCase() && message.subject === policy.subject && !message.cc && !message.bcc && !message.attachments);
            try { const result = await smtp.sendMail({ ...message, messageId: row.message_id }); code = /^250(?:[ -]|$)/.test(result?.response || '') ? 250 : null; return result; }
            finally { smtp.close?.(); }
          } };
        } });
        try {
          await mailer.sendVerification(mail);
          ensure(code === 250);
          db.prepare("UPDATE account_verification_attempts SET status='CONFIRMED_ACCEPTED',smtp_code=250,completed_at=? WHERE recipient_hash=?").run(now(), hash(recipient));
        } catch {
          db.prepare("UPDATE account_verification_attempts SET status='FAILED_OR_UNKNOWN_NO_RETRY',smtp_code=?,completed_at=? WHERE recipient_hash=? AND status='reserved'").run(code, now(), hash(recipient));
          throw Error('Controlled verification send failed or is ambiguous. Do not retry without separate approval.');
        }
      } finally { db.close(); }
    }
  };
  adapters.set(adapter, { origin: config.origin, database: config.databasePath }); return adapter;
}
export const matchesFiveUserVerification = (adapter, config) => { const b = adapters.get(adapter); return b?.origin === config.origin && b?.database === config.databasePath; };
