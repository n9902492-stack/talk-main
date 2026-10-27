import { createHash, randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import { openAuthDatabase } from './database.mjs';
import { asyncDatabase } from './async-database.mjs';
import { hostingCookies } from './hosting-cookies.mjs';
import { clientIpResolver } from './client-ip.mjs';
import { validMeetingName } from './meetings.mjs';
import { createMeetingManagement, MeetingError } from './meeting-management.mjs';
import { createMeetingGateway } from './meeting-gateway.mjs';
import { createMeetingRecordings, mountRecordingRoutes } from './meeting-recordings.mjs';
import { createMeetingAssistant } from './meeting-assistant.mjs';
import { mountAssistantRoutes } from './assistant-routes.mjs';
import { createWhiteboards } from './whiteboards.mjs';
import { mountWhiteboardRoutes } from './whiteboard-routes.mjs';
import { createWhiteboardAI } from './whiteboard-ai.mjs';
import { mountWhiteboardAIRoutes } from './whiteboard-ai-routes.mjs';
import { mountPasswordReset } from './password-reset.mjs';
import { mountScheduling } from './scheduling/routes.mjs';
import { avatarDescriptor, avatarMaxBytes, normalizeAvatar, normalizeBackgroundImage, validAvatarChoice } from './avatars.mjs';
const CHALLENGE_COOKIE = 'talk_auth_challenge';
const SESSION_COOKIE = 'talk_session';
const VERIFICATION_COOKIE = 'talk_email_verification';
const PHONE_COOKIE = 'talk_phone_verification';
const PHONE_CHALLENGE_TTL = 10 * 60 * 1000;
const PHONE_PROOF_RECENCY = 5 * 60 * 1000;
const EMAIL_CODE_TTL = 5 * 60 * 1000;
const GOOGLE_CHALLENGE_TTL = 10 * 60 * 1000;
const LINK_RECENCY_TTL = 10 * 60 * 1000;
const RESEND_COOLDOWN = 60 * 1000;
const SESSION_TTL = 8 * 60 * 60 * 1000;
const FLOW_TTL = 24 * 60 * 60 * 1000;
const MAX_STORE_ENTRIES = 4000;
const token = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('hex');
const deriveKey = promisify(scrypt);
const SCRYPT_OPTIONS = {
  N: 32768,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024
};
const safeAsync = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function hashSecret(secret) {
  const salt = randomBytes(16).toString('hex');
  const key = await deriveKey(secret, salt, 32, SCRYPT_OPTIONS);
  return `scrypt$32768$8$1$${salt}$${key.toString('hex')}`;
}
async function verifySecret(secret, hash) {
  if (typeof hash !== 'string') return false;
  const parts = hash.split('$');
  if (parts.length !== 6 || parts.slice(0, 4).join('$') !== 'scrypt$32768$8$1' || !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{64}$/.test(parts[5])) return false;
  const actual = await deriveKey(secret, parts[4], 32, SCRYPT_OPTIONS);
  return timingSafeEqual(actual, Buffer.from(parts[5], 'hex'));
}
function readCookie(req, name) {
  if (typeof req.headers.cookie !== 'string') return undefined;
  const matches = req.headers.cookie.split(';').map(item => item.trim()).filter(item => item.startsWith(`${name}=`));
  if (matches.length !== 1) return undefined;
  const value = matches[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}
function cleanName(value, email) {
  const name = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 80) : '';
  return name || email.split('@')[0].slice(0, 80);
}
function normalizedEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+$/.test(email)) return null;
  const [local, domain] = email.split('@');
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..') || domain.length > 253 || domain.split('.').length < 2 || domain.split('.').some(part => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) return null;
  return email;
}
function validPassword(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 128 && Buffer.byteLength(value, 'utf8') <= 1024;
}
function normalizedPhone(value) {
  return typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value) ? value : null;
}
function validPhonePayload(payload, projectId, phoneNumber, startedAt, timestamp) {
  const seconds = Math.floor(timestamp / 1000);
  return Boolean(payload && typeof payload === 'object' && payload.aud === projectId && payload.iss === `https://securetoken.google.com/${projectId}` && typeof payload.sub === 'string' && payload.sub.length > 0 && payload.sub.length <= 128 && payload.uid === payload.sub && payload.firebase?.sign_in_provider === 'phone' && normalizedPhone(payload.phone_number) === phoneNumber && Number.isFinite(payload.exp) && payload.exp > seconds && Number.isFinite(payload.iat) && payload.iat <= seconds + 30 && Number.isFinite(payload.auth_time) && payload.auth_time <= seconds + 30 && payload.auth_time * 1000 > timestamp - PHONE_PROOF_RECENCY && payload.auth_time * 1000 >= startedAt - 5000);
}
function profilePicture(value) {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    const googleHost = url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com');
    return url.protocol === 'https:' && googleHost && !url.username && !url.password && !url.port ? url.href : undefined;
  } catch {
    return undefined;
  }
}
function validGooglePayload(payload, clientId, now) {
  if (!payload || typeof payload !== 'object') return false;
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) return false;
  if (payload.aud !== clientId && !(Array.isArray(payload.aud) && payload.aud.includes(clientId))) return false;
  if (payload.azp && payload.azp !== clientId) return false;
  if (!Number.isFinite(payload.exp) || payload.exp <= Math.floor(now / 1000)) return false;
  if (!Number.isFinite(payload.iat) || payload.iat > Math.floor(now / 1000) + 300) return false;
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255) return false;
  if (payload.email_verified !== true || typeof payload.email !== 'string' || payload.email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email);
}

/**
 * Same-origin auth with persistent SQLite and the existing opaque cookie contract.
 * @param {{clientId?:string, origins?:string[], secureCookies?:boolean,
 * verifyCredential?:(credential:string, options:{audience:string})=>Promise<any>,
 * now?:()=>number, databasePath?:string, dbFilename?:string,
 * database?:import('node:sqlite').DatabaseSync,
 * mailer?:{configured:boolean,sendVerification?:(mail:{to:string,code:string,expiresAt:Date})=>Promise<any>},
 * sendVerification?:(mail:{to:string,code:string,expiresAt:Date})=>Promise<any>,
 * emailConfigured?:boolean, generateCode?:()=>string, firebaseProjectId?:string,
 * phoneConfigured?:boolean, verifyFirebaseToken?:(idToken:string)=>Promise<any>}} [options]
 */
export function createAuthApp({
  clientId,
  origins = [],
  secureCookies = false,
  verifyCredential,
  now = Date.now,
  databasePath,
  dbFilename = ':memory:',
  database,
  mailer,
  sendVerification,
  emailConfigured,
  generateCode = () => String(randomInt(0, 1000000)).padStart(6, '0'),
  firebaseProjectId,
  phoneConfigured = false,
  verifyFirebaseToken,
  cookieMode = 'native',
  cookieSecret,
  previousCookieSecret,
  trustedProxyCidrs = '',
  meetings,
  recordings: recordingRuntime,
  assistant: assistantRuntime,
  whiteboards: whiteboardRuntime = true,
  whiteboardIntelligence: whiteboardAIRuntime = {},
  scheduling: schedulingRuntime = false
} = {}) {
  const db = asyncDatabase(database || openAuthDatabase(databasePath || dbFilename));
  const resolveClientIp = clientIpResolver(trustedProxyCidrs);
  const emailMailer = mailer || {
    configured: Boolean(emailConfigured),
    sendVerification
  };
  const googleClientId = typeof clientId === 'string' ? clientId.trim() : '';
  const firebaseReady = Boolean(phoneConfigured && firebaseProjectId && typeof verifyFirebaseToken === 'function');
  const trustedOrigins = new Set(origins.map(origin => new URL(origin).origin));
  const googleClient = new OAuth2Client(googleClientId || undefined);
  const verifyGoogle = verifyCredential || (async (credential, {
    audience
  }) => {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience
    });
    return ticket.getPayload();
  });
  const dummyPassword = hashSecret(token());
  const app = express();
  let passwordReset;
  const meetingManagement = meetings ? createMeetingManagement({ db, service: meetings, now }) : null;
  const recordingService = meetings ? createMeetingRecordings({ db, service: meetings, manager: meetingManagement, runtime: recordingRuntime, now }) : null;
  meetingManagement?.setRecordingGuard(recordingService);
  app.locals.recordings = recordingService;
  const assistantService = meetings && assistantRuntime !== false ? createMeetingAssistant({ db, manager: meetingManagement, now, ...assistantRuntime }) : null;
  recordingService?.setAssistantGuard(assistantService);
  app.locals.assistant = assistantService;
  const whiteboardService = meetings && whiteboardRuntime !== false ? createWhiteboards({ db, manager: meetingManagement, service: meetings, now }) : null;
  app.locals.whiteboards = whiteboardService;
  const whiteboardIntelligence = whiteboardService && whiteboardAIRuntime !== false ? createWhiteboardAI({db,whiteboards:whiteboardService,now,...whiteboardAIRuntime}) : null;
  app.locals.whiteboardIntelligence = whiteboardIntelligence;
  const meetingGateway = meetings ? createMeetingGateway({ db, manager: meetingManagement, service: meetings, origins: trustedOrigins }) : null;
  app.locals.attachMeetingGateway = server => meetingGateway?.attach(server);
  app.locals.closeAuthDatabase = async () => {
    await app.locals.schedulingShutdown?.();
    await passwordReset?.shutdown();
    await whiteboardIntelligence?.shutdown();
    whiteboardService?.shutdown();
    await assistantService?.shutdown();
    await recordingService?.shutdown();
    meetingGateway?.shutdown();
    if (!database) return db.close();
  };
  const cookieOptions = {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    path: '/api/auth'
  };
  const fail = (res, status, error, message, extra = {}) => res.status(status).json({
    error,
    message,
    ...extra
  });
  const clearChallenge = res => res.clearCookie(CHALLENGE_COOKIE, cookieOptions);
  const clearSession = res => res.clearCookie(SESSION_COOKIE, cookieOptions);
  const clearPending = res => res.clearCookie(VERIFICATION_COOKIE, cookieOptions);
  const clearPhone = res => res.clearCookie(PHONE_COOKIE, cookieOptions);
  const query = (sql, ...params) => db.prepare(sql).get(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  const cookieHash = (req, name) => {
    const key = readCookie(req, name);
    return key ? digest(key) : undefined;
  };
  const getSession = async req => {
    const key = cookieHash(req, SESSION_COOKIE);
    return key ? await query('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?', key, now()) : undefined;
  };
  const getGoogleChallenge = async req => {
    const key = cookieHash(req, CHALLENGE_COOKIE);
    return key ? await query('SELECT * FROM google_challenges WHERE token_hash = ? AND expires_at > ?', key, now()) : undefined;
  };
  const getPhoneChallenge = async req => {
    const key = cookieHash(req, PHONE_COOKIE);
    return key ? await query('SELECT * FROM phone_challenges WHERE token_hash=? AND consumed_at IS NULL', key) : undefined;
  };
  const invalidatePhone = async (req, res) => {
    const key = cookieHash(req, PHONE_COOKIE);
    if (key) await run('UPDATE phone_challenges SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL', now(), key);
    clearPhone(res);
  };
  const getPending = async req => {
    const key = cookieHash(req, VERIFICATION_COOKIE);
    const pending = key ? await query("SELECT * FROM email_challenges WHERE token_hash = ? AND flow_expires_at > ? AND delivery_state != 'used'", key, now()) : undefined;
    if (!pending) return undefined;
    // Each generation's resend deadline records its send time plus the cooldown.
    // Cap persisted codes from the previous ten-minute policy as well as new codes.
    const expiresAt = Math.min(pending.expires_at, pending.resend_at - RESEND_COOLDOWN + EMAIL_CODE_TTL);
    if (expiresAt < pending.expires_at) {
      await run('UPDATE email_challenges SET expires_at=? WHERE id=? AND generation=?', expiresAt, pending.id, pending.generation);
      pending.expires_at = expiresAt;
    }
    return pending;
  };
  const userProfile = async (accountId, method) => {
    const account = await query('SELECT * FROM accounts WHERE id = ?', accountId);
    if (!account) return null;
    const google = await query("SELECT 1 FROM identities WHERE account_id = ? AND provider = 'google'", accountId);
    const password = await query("SELECT verified_at FROM identities WHERE account_id = ? AND provider = 'password'", accountId);
    const phone = await query('SELECT phone_number FROM phone_profiles WHERE account_id=?', accountId);
    return {
      id: account.id,
      name: account.name,
      email: account.email,
      avatar: avatarDescriptor(await query('SELECT * FROM account_avatars WHERE account_id=?', accountId)),
      ...(account.picture ? {
        picture: account.picture
      } : {}),
      provider: method === 'phone' ? 'phone' : method === 'password' ? 'email' : google ? 'google' : phone ? 'phone' : 'email',
      hasPassword: Boolean(password?.verified_at),
      hasPhone: Boolean(phone),
      ...(phone ? {
        phoneNumber: phone.phone_number
      } : {}),
      emailVerified: Boolean(account.email_verified)
    };
  };
  const issueSession = async (req, res, accountId, method, requiresConfirmation = false) => {
    await invalidatePhone(req, res);
    const publicChallenge = cookieHash(req, CHALLENGE_COOKIE);
    if (publicChallenge && (await run('DELETE FROM google_challenges WHERE token_hash=?', publicChallenge)).changes) clearChallenge(res);
    const previous = cookieHash(req, SESSION_COOKIE);
    if (previous) await run('DELETE FROM sessions WHERE token_hash = ?', previous);
    const key = token();
    const csrfToken = token();
    await run('INSERT INTO sessions(token_hash, account_id, csrf_token, auth_method, authenticated_at, expires_at, requires_confirmation) VALUES (?, ?, ?, ?, ?, ?, ?)', digest(key), accountId, csrfToken, method, now(), now() + SESSION_TTL, requiresConfirmation ? 1 : 0);
    res.cookie(SESSION_COOKIE, key, {
      ...cookieOptions,
      maxAge: SESSION_TTL
    });
    return {
      user: await userProfile(accountId, method),
      csrfToken,
      requiresConfirmation
    };
  };
  const rateLimited = async (req, res, namespace, email, limits) => {
    // Forwarded addresses are untrusted; clients cannot pick their rate-limit IP.
    const ip = resolveClientIp(req);
    const buckets = [[`${namespace}:ip:${digest(ip)}`, limits.ip, limits.window], ...(email ? [[`${namespace}:email:${digest(email)}`, limits.email, limits.window]] : [])];
    let retryAfter = 0;
    for (const [bucket, max, window] of buckets) {
      const entry = await query('INSERT INTO rate_limits(bucket,count,resets_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN rate_limits.resets_at<=? THEN 1 ELSE rate_limits.count+1 END,resets_at=CASE WHEN rate_limits.resets_at<=? THEN excluded.resets_at ELSE rate_limits.resets_at END RETURNING count,resets_at', bucket, now() + window, now(), now());
      if (entry.count > max) retryAfter = Math.max(retryAfter, Math.ceil((entry.resets_at - now()) / 1000));
    }
    if (!retryAfter) return false;
    res.set('Retry-After', String(retryAfter));
    fail(res, 429, 'rate_limited', 'Too many attempts. Please wait before trying again.', {
      retryAfter
    });
    return true;
  };
  const deliveryRate = async (req, res, email) => await rateLimited(req, res, 'email-delivery', email, {
    email: 5,
    ip: 30,
    window: 60 * 60 * 1000
  });
  const verificationBody = pending => ({
    verification: {
      email: pending.email,
      expiresAt: new Date(pending.expires_at).toISOString(),
      resendAt: new Date(pending.resend_at).toISOString(),
      purpose: pending.purpose === 'existing' ? 'signup' : pending.purpose,
      deliveryState: pending.delivery_state,
      attemptsRemaining: Math.max(0, 5 - pending.attempts)
    },
    csrfToken: pending.csrf_token,
    serverTime: new Date(now()).toISOString()
  });
  const pendingResponse = (res, pending) => res.status(202).json({
    ...verificationBody(pending),
    message: 'Check your inbox for a Talk verification code. It expires in 5 minutes.'
  });
  const coolingDown = (res, resendAt) => {
    if (resendAt <= now()) return false;
    const retryAfter = Math.ceil((resendAt - now()) / 1000);
    res.set('Retry-After', String(retryAfter));
    fail(res, 429, 'resend_cooldown', 'Please wait before requesting another verification code.', {
      retryAfter
    });
    return true;
  };
  const emailCooldown = async (res, email) => coolingDown(res, (await query('SELECT MAX(resend_at) AS resend_at FROM email_challenges WHERE email = ?', email))?.resend_at || 0);
  const deliver = async (pending, res) => {
    const code = generateCode();
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new Error('Invalid verification code generator');
    // Salted, memory-hard hashes also protect the low-entropy one-time codes.
    const codeHash = await hashSecret(`${pending.id}:${pending.generation}:${code}`);
    const staged = await run("UPDATE email_challenges SET code_hash = ? WHERE id = ? AND generation = ? AND delivery_state = 'sending'", codeHash, pending.id, pending.generation);
    if (!staged.changes) return fail(res, 409, 'verification_changed', 'This verification attempt changed. Please try again.');
    try {
      await emailMailer.sendVerification({
        to: pending.email,
        code,
        expiresAt: new Date(pending.expires_at)
      });
    } catch {
      await run("UPDATE email_challenges SET delivery_state='failed',code_hash=NULL WHERE id=? AND generation=? AND delivery_state='sending'", pending.id, pending.generation);
      return fail(res, 503, 'email_delivery_failed', 'We could not send your verification email. Please wait a minute and try again.', {
        retryAfter: 60,
        ...verificationBody({
          ...pending,
          delivery_state: 'failed'
        })
      });
    }
    const activated = await run("UPDATE email_challenges SET delivery_state='active' WHERE id=? AND generation=? AND delivery_state='sending'", pending.id, pending.generation);
    if (!activated.changes) return fail(res, 409, 'verification_changed', 'This verification attempt changed. Please try again.');
    return pendingResponse(res, await query('SELECT * FROM email_challenges WHERE id=?', pending.id));
  };
  const newPending = async (req, res, {
    accountId,
    email,
    purpose,
    passwordHash = null,
    name = null,
    boundSessionHash = null
  }) => {
    const old = cookieHash(req, VERIFICATION_COOKIE);
    if (old) await run("UPDATE email_challenges SET delivery_state='used',code_hash=NULL,staged_password_hash=NULL WHERE token_hash=?", old);
    await run("UPDATE email_challenges SET delivery_state='used',code_hash=NULL,staged_password_hash=NULL WHERE email=? AND delivery_state!='used'", email);
    const key = token();
    const id = randomUUID();
    await run("INSERT INTO email_challenges(id,token_hash,account_id,email,purpose,staged_name,staged_password_hash,bound_session_hash,csrf_token,delivery_state,expires_at,resend_at,created_at,flow_expires_at) VALUES (?,?,?,?,?,?,?,?,?,'sending',?,?,?,?)", id, digest(key), accountId, email, purpose, name, passwordHash, boundSessionHash, token(), now() + EMAIL_CODE_TTL, now() + RESEND_COOLDOWN, now(), now() + FLOW_TTL);
    res.cookie(VERIFICATION_COOKIE, key, {
      ...cookieOptions,
      maxAge: FLOW_TTL
    });
    return await query('SELECT * FROM email_challenges WHERE id=?', id);
  };
  const requireMailer = res => {
    if (emailMailer.configured && typeof emailMailer.sendVerification === 'function') return true;
    fail(res, 503, 'email_not_configured', 'Email verification is temporarily unavailable. Please try again later.');
    return false;
  };
  app.disable('x-powered-by');
  app.use('/api/auth', db.middleware);
  if (cookieMode === 'hosting') {
    if (!secureCookies || trustedOrigins.size !== 1 || new URL([...trustedOrigins][0]).protocol !== 'https:') throw new Error('Hosting cookies require one HTTPS application origin.');
    app.use('/api/auth', hostingCookies({ secret: cookieSecret, previousSecret: previousCookieSecret, origin: [...trustedOrigins][0], now }));
  } else if (cookieMode !== 'native') throw new Error('Unknown authentication cookie mode.');
  app.use('/api/auth', safeAsync(async (_req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    await run('DELETE FROM sessions WHERE expires_at <= ?', now());
    await run('DELETE FROM google_challenges WHERE expires_at <= ?', now());
    await run('DELETE FROM email_challenges WHERE flow_expires_at <= ?', now());
    await run('DELETE FROM rate_limits WHERE resets_at <= ?', now());
    await run('DELETE FROM phone_challenges WHERE created_at <= ?', now() - FLOW_TTL);
    await run('DELETE FROM phone_token_uses WHERE expires_at <= ?', now());
    next();
  }));
  const validOrigin = (req, res, next) => {
    if (typeof req.headers.origin !== 'string' || !trustedOrigins.has(req.headers.origin)) return fail(res, 403, 'invalid_origin', 'This request did not come from the Talk website.');
    next();
  };
  const requireJson = (req, res, next) => {
    if (!req.is('application/json')) return fail(res, 415, 'invalid_content_type', 'Send this request as JSON.');
    next();
  };
  const json = express.json({
    limit: '12kb',
    strict: true
  });
  const publicCsrf = async (req, res, next) => {
    const challenge = await getGoogleChallenge(req);
    if (!challenge || !constantTimeEqual(req.get('X-CSRF-Token'), challenge.csrf_token)) return fail(res, 403, 'invalid_challenge', 'Your sign-in attempt expired. Please try again.');
    next();
  };
  const pendingCsrf = async (req, res, next) => {
    const pending = await getPending(req);
    if (!pending || !constantTimeEqual(req.get('X-CSRF-Token'), pending.csrf_token)) return fail(res, 403, 'invalid_verification', 'Your verification attempt expired. Please sign in or sign up again.');
    req.emailPending = pending;
    next();
  };
  const ensurePublicChallenge = async (req, res) => {
    let challenge = await getGoogleChallenge(req);
    if (!challenge) {
      if ((await query('SELECT COUNT(*) AS total FROM google_challenges')).total >= MAX_STORE_ENTRIES) {
        fail(res, 429, 'capacity', 'Please try signing in again shortly.');
        return null;
      }
      const key = token();
      await run('INSERT INTO google_challenges(token_hash,csrf_token,nonce,expires_at) VALUES (?,?,?,?)', digest(key), token(), token(), now() + GOOGLE_CHALLENGE_TTL);
      challenge = await query('SELECT * FROM google_challenges WHERE token_hash=?', digest(key));
      res.cookie(CHALLENGE_COOKIE, key, {
        ...cookieOptions,
        maxAge: GOOGLE_CHALLENGE_TTL
      });
    }
    return challenge;
  };
  const phoneBody = pending => ({
    challenge: pending ? {
      phoneNumber: pending.phone_number,
      intent: pending.intent,
      expiresAt: new Date(pending.expires_at).toISOString(),
      resendAt: new Date(pending.resend_at).toISOString()
    } : null,
    csrfToken: pending?.csrf_token || null,
    serverTime: new Date(now()).toISOString()
  });
  const phoneCsrf = async (req, res, next) => {
    const pending = await getPhoneChallenge(req);
    if (!pending || !constantTimeEqual(req.get('X-CSRF-Token'), pending.csrf_token)) return fail(res, 403, 'invalid_phone_challenge', 'Your phone verification attempt changed. Please enter your number again.');
    req.phonePending = pending;
    next();
  };
  const phoneLinkSession = async (req, pending) => {
    const session = await getSession(req);
    return session && !session.requires_confirmation && session.token_hash === pending.bound_session_hash && session.account_id === pending.account_id && session.authenticated_at + LINK_RECENCY_TTL > now() ? session : null;
  };
  app.get('/api/auth/config', safeAsync(async (req, res) => {
    const challenge = await ensurePublicChallenge(req, res);
    if (!challenge) return;
    res.json({
      configured: Boolean(googleClientId),
      emailConfigured: Boolean(emailMailer.configured),
      whiteboardConfigured: Boolean(whiteboardService),
      ...(googleClientId ? {
        clientId: googleClientId
      } : {}),
      csrfToken: challenge.csrf_token,
      nonce: challenge.nonce
    });
  }));
  app.get('/api/auth/phone/config', safeAsync(async (req, res) => {
    const challenge = await ensurePublicChallenge(req, res);
    if (challenge) res.json({
      configured: firebaseReady,
      csrfToken: challenge.csrf_token,
      serverTime: new Date(now()).toISOString()
    });
  }));
  app.get('/api/auth/phone/challenge', safeAsync(async (req, res) => {
    const pending = await getPhoneChallenge(req);
    if (!pending) clearPhone(res);
    res.json(phoneBody(pending));
  }));
  app.post('/api/auth/phone/start', validOrigin, requireJson, json, safeAsync(async (req, res) => {
    if (!firebaseReady) return fail(res, 503, 'phone_not_configured', 'Phone sign-in is temporarily unavailable. Please use another sign-in option.');
    const phoneNumber = normalizedPhone(req.body?.phoneNumber);
    const intent = req.body?.intent;
    if (await rateLimited(req, res, 'phone-start', phoneNumber, {
      email: 10,
      ip: 40,
      window: 60 * 60 * 1000
    })) return;
    if (!phoneNumber || !['signin', 'link'].includes(intent)) return fail(res, 400, 'invalid_phone_number', 'Enter a valid mobile number including its country code.');
    const session = await getSession(req);
    if (intent === 'link') {
      if (!session || session.requires_confirmation || !constantTimeEqual(req.get('X-CSRF-Token'), session.csrf_token) || session.authenticated_at + LINK_RECENCY_TTL <= now()) return fail(res, 403, 'link_session_expired', 'Sign in again before linking a phone number to your Talk account.');
    } else {
      if (session) return fail(res, 409, 'sign_out_required', 'Sign out before signing in with a phone number, or choose to link your number.');
      const challenge = await getGoogleChallenge(req);
      if (!challenge || !constantTimeEqual(req.get('X-CSRF-Token'), challenge.csrf_token)) return fail(res, 403, 'invalid_challenge', 'Your sign-in attempt expired. Please try again.');
    }
    const resendAt = (await query('SELECT MAX(resend_at) AS resend_at FROM phone_challenges WHERE phone_number=?', phoneNumber))?.resend_at || 0;
    if (coolingDown(res, resendAt)) return;
    if (await rateLimited(req, res, 'phone-delivery', phoneNumber, {
      email: 5,
      ip: 30,
      window: 60 * 60 * 1000
    })) return;
    if ((await query('SELECT COUNT(*) AS n FROM phone_challenges WHERE consumed_at IS NULL')).n >= MAX_STORE_ENTRIES) return fail(res, 429, 'capacity', 'Please try phone sign-in again shortly.');
    await invalidatePhone(req, res);
    const key = token();
    await run('INSERT INTO phone_challenges(token_hash,csrf_token,phone_number,intent,account_id,bound_session_hash,created_at,resend_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)', digest(key), token(), phoneNumber, intent, intent === 'link' ? session.account_id : null, intent === 'link' ? session.token_hash : null, now(), now() + RESEND_COOLDOWN, now() + PHONE_CHALLENGE_TTL);
    res.cookie(PHONE_COOKIE, key, {
      ...cookieOptions,
      maxAge: FLOW_TTL
    });
    res.status(202).json(phoneBody(await query('SELECT * FROM phone_challenges WHERE token_hash=?', digest(key))));
  }));
  app.post('/api/auth/phone/verify', validOrigin, requireJson, json, safeAsync(phoneCsrf), safeAsync(async (req, res) => {
    if (!firebaseReady) return fail(res, 503, 'phone_not_configured', 'Phone sign-in is temporarily unavailable. Please use another sign-in option.');
    const pending = req.phonePending;
    if (await rateLimited(req, res, 'phone-verify', pending.phone_number, {
      email: 20,
      ip: 60,
      window: 10 * 60 * 1000
    })) return;
    if (pending.expires_at <= now()) return fail(res, 410, 'phone_challenge_expired', 'Your phone verification attempt expired. Please request a new SMS.');
    if (pending.intent === 'link' && !(await phoneLinkSession(req, pending))) return fail(res, 403, 'link_session_expired', 'Sign in again before linking a phone number to your Talk account.');
    if (pending.intent === 'signin' && (await getSession(req))) return fail(res, 409, 'sign_out_required', 'Your signed-in account changed. Start phone sign-in again.');
    const idToken = req.body?.idToken;
    if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 10000) return fail(res, 400, 'invalid_phone_credential', 'Firebase did not provide a valid phone sign-in credential.');
    const attempted = await run('UPDATE phone_challenges SET attempts=attempts+1 WHERE token_hash=? AND consumed_at IS NULL AND attempts<5 AND expires_at>?', pending.token_hash, now());
    if (!attempted.changes) return fail(res, 429, 'phone_attempt_limit', 'This phone verification attempt reached its limit. Please request a new SMS.', {
      retryAfter: Math.max(0, Math.ceil((pending.resend_at - now()) / 1000))
    });
    let payload;
    try {
      payload = await verifyFirebaseToken(idToken);
    } catch {
      return fail(res, 401, 'invalid_phone_credential', 'Phone sign-in could not be verified. Please request a new SMS and try again.');
    }
    if (!validPhonePayload(payload, firebaseProjectId, pending.phone_number, pending.created_at, now())) return fail(res, 401, 'invalid_phone_credential', 'Phone sign-in could not be verified. Please request a new SMS and try again.');
    const current = await getPhoneChallenge(req);
    if (!current || current.token_hash !== pending.token_hash || current.expires_at <= now()) return fail(res, 409, 'phone_challenge_changed', 'This phone verification attempt changed. Please request a new SMS.');
    if (pending.intent === 'link' && !(await phoneLinkSession(req, pending))) return fail(res, 403, 'link_session_expired', 'Sign in again before linking a phone number to your Talk account.');
    if (pending.intent === 'signin' && (await getSession(req))) return fail(res, 409, 'sign_out_required', 'Your signed-in account changed. Start phone sign-in again.');
    await db.exec('BEGIN IMMEDIATE');
    try {
      await db.lockIdentity(`phone:${payload.uid}`);
      const lockedChallenge = await getPhoneChallenge(req);
      if (!lockedChallenge || lockedChallenge.token_hash !== pending.token_hash || lockedChallenge.expires_at <= now()) {
        await db.exec('ROLLBACK');
        return fail(res, 409, 'phone_challenge_changed', 'This phone verification attempt changed. Please request a new SMS.');
      }
      if (pending.intent === 'link') {
        await db.lockSession(pending.bound_session_hash);
        if (!(await phoneLinkSession(req, pending))) {
          await db.exec('ROLLBACK');
          return fail(res, 403, 'link_session_expired', 'Sign in again before linking a phone number to your Talk account.');
        }
      } else if (await getSession(req)) {
        await db.exec('ROLLBACK');
        return fail(res, 409, 'sign_out_required', 'Your signed-in account changed. Start phone sign-in again.');
      }
      if (await query('SELECT 1 FROM phone_token_uses WHERE token_hash=?', digest(idToken))) {
        await db.exec('ROLLBACK');
        return fail(res, 401, 'phone_credential_used', 'This phone sign-in credential has already been used. Please request a new SMS.');
      }
      const byUid = await query("SELECT i.account_id,p.phone_number FROM identities i JOIN phone_profiles p ON p.firebase_uid=i.provider_id AND p.account_id=i.account_id WHERE i.provider='phone' AND i.provider_id=?", payload.uid);
      const byNumber = await query('SELECT * FROM phone_profiles WHERE phone_number=?', pending.phone_number);
      const linked = pending.intent === 'link' ? await query('SELECT * FROM phone_profiles WHERE account_id=?', pending.account_id) : null;
      // Neither matching profile/email claims nor a matching phone with a
      // different Firebase UID authorizes merging two Talk accounts.
      if (byUid && byUid.phone_number !== pending.phone_number || byNumber && byNumber.firebase_uid !== payload.uid || pending.intent === 'link' && (byUid && byUid.account_id !== pending.account_id || linked && linked.firebase_uid !== payload.uid)) {
        await run('UPDATE phone_challenges SET consumed_at=? WHERE token_hash=?', now(), pending.token_hash);
        await db.exec('COMMIT');
        clearPhone(res);
        return fail(res, 409, 'phone_account_conflict', 'We could not complete this request. Sign in using your existing account method.');
      }
      const consumed = await run('UPDATE phone_challenges SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL AND expires_at>?', now(), pending.token_hash, now());
      if (!consumed.changes) {
        await db.exec('ROLLBACK');
        return fail(res, 409, 'phone_challenge_changed', 'This phone verification attempt changed. Please request a new SMS.');
      }
      let accountId = byUid?.account_id || (pending.intent === 'link' ? pending.account_id : null);
      if (!accountId) {
        accountId = `phone_${randomUUID()}`;
        await run("INSERT INTO accounts(id,name,email,email_verified,created_at) VALUES (?,?,'',0,?)", accountId, cleanName(payload.name, '') || 'Talk member', now());
      }
      if (!byUid) {
        await run("INSERT INTO identities(provider,provider_id,account_id,verified_at) VALUES ('phone',?,?,?)", payload.uid, accountId, now());
        await run('INSERT INTO phone_profiles(firebase_uid,account_id,phone_number,verified_at) VALUES (?,?,?,?)', payload.uid, accountId, pending.phone_number, now());
      }
      await run('INSERT INTO phone_token_uses(token_hash,expires_at) VALUES (?,?)', digest(idToken), payload.exp * 1000);
      const emailPending = cookieHash(req, VERIFICATION_COOKIE);
      if (emailPending) await run("UPDATE email_challenges SET delivery_state='used',code_hash=NULL,staged_password_hash=NULL WHERE token_hash=?", emailPending);
      const result = await issueSession(req, res, accountId, 'phone');
      await db.exec('COMMIT');
      clearPending(res);
      res.json(result);
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  }));
  app.post('/api/auth/phone/cancel', validOrigin, requireJson, json, safeAsync(phoneCsrf), safeAsync(async (req, res) => {
    await invalidatePhone(req, res);
    res.json(phoneBody(null));
  }));
  app.get('/api/auth/email/config', (_req, res) => res.json({
    configured: Boolean(emailMailer.configured),
    serverTime: new Date(now()).toISOString()
  }));
  app.post('/api/auth/google', validOrigin, requireJson, json, safeAsync(publicCsrf), safeAsync(async (req, res) => {
    if (!googleClientId) return fail(res, 503, 'not_configured', 'Google sign-in has not been configured for this website.');
    const challenge = await getGoogleChallenge(req);
    const credential = req.body?.credential;
    if (typeof credential !== 'string' || !credential || credential.length > 10000) return fail(res, 400, 'invalid_credential', 'Google did not provide a valid sign-in credential.');
    let payload;
    try {
      payload = await verifyGoogle(credential, {
        audience: googleClientId
      });
    } catch {
      return fail(res, 401, 'invalid_credential', 'Google sign-in could not be verified. Please try again.');
    }
    if (!validGooglePayload(payload, googleClientId, now()) || !constantTimeEqual(payload.nonce, challenge.nonce)) return fail(res, 401, 'invalid_credential', 'Google sign-in could not be verified. Please try again.');
    if (!(await getGoogleChallenge(req)) || !(await run('DELETE FROM google_challenges WHERE token_hash=? AND expires_at>?', challenge.token_hash, now())).changes) return fail(res, 403, 'invalid_challenge', 'Your sign-in attempt expired. Please try again.');
    clearChallenge(res);
    const picture = profilePicture(payload.picture);
    await db.exec('BEGIN IMMEDIATE');
    try {
    await db.lockIdentity(`google:${payload.sub}`);
    let identity = await query("SELECT * FROM identities WHERE provider='google' AND provider_id=?", payload.sub);
    if (!identity) {
      // Google sub, never email, identifies an account. Equal emails do not link.
      const accountId = (await query('SELECT id FROM accounts WHERE id=?', payload.sub)) ? `google_${randomUUID()}` : payload.sub;
      await run('INSERT INTO accounts(id,name,email,picture,email_verified,created_at) VALUES (?,?,?,?,1,?)', accountId, cleanName(payload.name, payload.email), payload.email, picture || null, now());
      await run("INSERT INTO identities(provider,provider_id,account_id,verified_at) VALUES ('google',?,?,?)", payload.sub, accountId, now());
      identity = {
        account_id: accountId
      };
    } else await run('UPDATE accounts SET name=?,email=?,picture=?,email_verified=1 WHERE id=?', cleanName(payload.name, payload.email), payload.email, picture || null, identity.account_id);
    const pendingHash = cookieHash(req, VERIFICATION_COOKIE);
    if (pendingHash) await run("UPDATE email_challenges SET delivery_state='used',code_hash=NULL,staged_password_hash=NULL WHERE token_hash=?", pendingHash);
    clearPending(res);
    const result = await issueSession(req, res, identity.account_id, 'google', true);
    await db.exec('COMMIT');
    res.json(result);
    } catch (error) { await db.exec('ROLLBACK'); throw error; }
  }));
  app.get('/api/auth/session', safeAsync(async (req, res) => {
    const session = await getSession(req);
    if (!session) {
      if (req.headers.cookie) clearSession(res);
      return res.json({
        user: null,
        csrfToken: null
      });
    }
    res.json({
      user: await userProfile(session.account_id, session.auth_method),
      csrfToken: session.csrf_token,
      requiresConfirmation: Boolean(session.requires_confirmation)
    });
  }));
  app.post('/api/auth/google/confirm', validOrigin, requireJson, json, safeAsync(async (req, res) => {
    const session = await getSession(req);
    if (!session || !constantTimeEqual(req.get('X-CSRF-Token'), session.csrf_token)) return fail(res, 403, 'invalid_session', 'Your session expired. Please sign in again.');
    if (session.auth_method !== 'google') return fail(res, 403, 'google_confirmation_unavailable', 'Sign in with Google before continuing.');
    // This is Talk's own continuation after Google has already verified the
    // credential. No OAuth permissions are granted or changed by this step.
    await db.exec('BEGIN IMMEDIATE');
    try {
      await run("UPDATE sessions SET requires_confirmation=0 WHERE token_hash=? AND auth_method='google' AND expires_at>? AND requires_confirmation=1", session.token_hash, now());
      const confirmed = await query("SELECT * FROM sessions WHERE token_hash=? AND auth_method='google' AND expires_at>? AND requires_confirmation=0", session.token_hash, now());
      if (!confirmed) {
        await db.exec('ROLLBACK');
        return fail(res, 403, 'invalid_session', 'Your session expired. Please sign in again.');
      }
      const result = {
        user: await userProfile(confirmed.account_id, confirmed.auth_method),
        csrfToken: confirmed.csrf_token,
        requiresConfirmation: false
      };
      await db.exec('COMMIT');
      res.json(result);
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  }));
  passwordReset=mountPasswordReset({app,db,now,token,digest,cookieHash,cookieOptions,hashSecret,verifySecret,normalizedEmail,validPassword,generateCode,emailMailer,validOrigin,requireJson,json,publicCsrf,safeAsync,constantTimeEqual,rateLimited,fail});
  app.locals.passwordReset=passwordReset;
  app.post('/api/auth/email/signup', validOrigin, requireJson, json, safeAsync(publicCsrf), safeAsync(async (req, res) => {
    const email = normalizedEmail(req.body?.email);
    if (await rateLimited(req, res, 'signup', email, {
      email: 10,
      ip: 40,
      window: 60 * 60 * 1000
    })) return;
    if (!email || !validPassword(req.body?.password) || typeof req.body?.name !== 'string' || !req.body.name.trim() || req.body.name.trim().length > 80) return fail(res, 400, 'invalid_signup', 'Enter a valid name and email, and a password between 8 and 128 characters.');
    if (!requireMailer(res) || (await emailCooldown(res, email)) || (await deliveryRate(req, res, email))) return;
    const passwordHash = await hashSecret(req.body.password);
    let pending;
    await db.exec('BEGIN IMMEDIATE');
    try {
    await db.lockIdentity(`password:${email}`);
    if (!(await getGoogleChallenge(req))) { await db.exec('ROLLBACK'); return fail(res, 403, 'invalid_challenge', 'Your sign-in attempt expired. Please try again.'); }
    if (await emailCooldown(res, email)) { await db.exec('ROLLBACK'); return; }
    let identity = await query("SELECT * FROM identities WHERE provider='password' AND provider_id=?", email);
    if (!identity) {
      const accountId = `email_${randomUUID()}`;
      await run('INSERT INTO accounts(id,name,email,email_verified,created_at) VALUES (?,?,?,0,?)', accountId, cleanName(req.body.name, email), email, now());
      await run("INSERT INTO identities(provider,provider_id,account_id,password_hash) VALUES ('password',?,?,?)", email, accountId, passwordHash);
      identity = {
        account_id: accountId,
        verified_at: null
      };
    }
    pending = await newPending(req, res, {
      accountId: identity.account_id,
      email,
      purpose: identity.verified_at ? 'existing' : 'signup',
      passwordHash,
      name: cleanName(req.body.name, email)
    });
    await db.exec('COMMIT');
    } catch (error) { await db.exec('ROLLBACK'); throw error; }
    await deliver(pending, res);
  }));
  const emailLogin = safeAsync(async (req, res) => {
    const email = normalizedEmail(req.body?.email);
    if (await rateLimited(req, res, 'login', email, {
      email: 10,
      ip: 40,
      window: 15 * 60 * 1000
    })) return;
    if (!email || !validPassword(req.body?.password)) return fail(res, 401, 'invalid_credentials', 'The email or password is incorrect. Please try again.');
    const identity = await query("SELECT * FROM identities WHERE provider='password' AND provider_id=?", email);
    const matches = await verifySecret(req.body.password, identity?.password_hash || (await dummyPassword));
    if (!matches || !identity) return fail(res, 401, 'invalid_credentials', 'The email or password is incorrect. Please try again.');
    if (!(await getGoogleChallenge(req))) return fail(res, 403, 'invalid_challenge', 'Your sign-in attempt expired. Please try again.');
    if (identity.verified_at) return res.json(await issueSession(req, res, identity.account_id, 'password'));
    const previous = await getPending(req);
    if (previous && previous.account_id === identity.account_id && ['signup', 'login'].includes(previous.purpose) && previous.delivery_state === 'active' && previous.expires_at > now() && previous.attempts < 5) return pendingResponse(res, previous);
    if (!requireMailer(res) || (await emailCooldown(res, email)) || (await deliveryRate(req, res, email))) return;
    await deliver(await newPending(req, res, {
      accountId: identity.account_id,
      email,
      purpose: 'login'
    }), res);
  });
  app.post('/api/auth/email/login', validOrigin, requireJson, json, safeAsync(publicCsrf), emailLogin);
  app.post('/api/auth/email/resume', validOrigin, requireJson, json, safeAsync(publicCsrf), emailLogin);
  app.get('/api/auth/email/verification', safeAsync(async (req, res) => {
    const pending = await getPending(req);
    if (!pending) {
      clearPending(res);
      return res.json({
        verification: null,
        csrfToken: null,
        serverTime: new Date(now()).toISOString()
      });
    }
    res.json(verificationBody(pending));
  }));
  app.post('/api/auth/email/verify', validOrigin, requireJson, json, safeAsync(pendingCsrf), safeAsync(async (req, res) => {
    const pending = req.emailPending;
    if (await rateLimited(req, res, 'verify', pending.email, {
      email: 20,
      ip: 50,
      window: 10 * 60 * 1000
    })) return;
    if (typeof req.body?.code !== 'string' || !/^\d{6}$/.test(req.body.code)) return fail(res, 400, 'invalid_code_format', 'Enter the 6-digit code from your email.');
    if (pending.purpose === 'link') {
      const session = await getSession(req);
      if (!session || session.requires_confirmation || session.token_hash !== pending.bound_session_hash || session.account_id !== pending.account_id || session.auth_method !== 'google' || session.authenticated_at + LINK_RECENCY_TTL <= now()) return fail(res, 403, 'link_session_expired', 'Sign in with Google again before linking email sign-in.');
    }
    if (pending.attempts >= 5) return fail(res, 429, 'attempt_limit', 'This code has reached its attempt limit. Please request another code.', {
      retryAfter: Math.max(0, Math.ceil((pending.resend_at - now()) / 1000))
    });
    if (pending.expires_at <= now()) return fail(res, 410, 'code_expired', 'This verification code expired. Please request another code.');
    if (pending.delivery_state !== 'active' || !pending.code_hash) return fail(res, 409, 'code_unavailable', 'This code is unavailable. Please request another code.');
    const attempted = await run("UPDATE email_challenges SET attempts=attempts+1 WHERE id=? AND generation=? AND delivery_state='active' AND attempts<5 AND expires_at>?", pending.id, pending.generation, now());
    if (!attempted.changes) return fail(res, 409, 'verification_changed', 'This verification attempt changed. Please try again.');
    const matches = await verifySecret(`${pending.id}:${pending.generation}:${req.body.code}`, pending.code_hash);
    const current = await query('SELECT * FROM email_challenges WHERE id=?', pending.id);
    if (!current || current.generation !== pending.generation || current.delivery_state !== 'active') return fail(res, 409, 'verification_changed', 'This verification attempt changed. Please try again.');
    if (current.expires_at <= now()) return fail(res, 410, 'code_expired', 'This verification code expired. Please request another code.');
    if (!matches) {
      if (current.attempts >= 5) {
        await run('UPDATE email_challenges SET code_hash=NULL WHERE id=? AND generation=?', pending.id, pending.generation);
        return fail(res, 429, 'attempt_limit', 'This code has reached its attempt limit. Please request another code.', {
          retryAfter: Math.max(0, Math.ceil((current.resend_at - now()) / 1000))
        });
      }
      return fail(res, 400, 'incorrect_code', 'That code is incorrect. Please check your email and try again.', {
        attemptsRemaining: 5 - current.attempts
      });
    }
    if (pending.purpose === 'link') {
      const session = await getSession(req);
      if (!session || session.requires_confirmation || session.token_hash !== pending.bound_session_hash || session.account_id !== pending.account_id || session.auth_method !== 'google' || session.authenticated_at + LINK_RECENCY_TTL <= now()) return fail(res, 403, 'link_session_expired', 'Sign in with Google again before linking email sign-in.');
    }
    // Consume plus account update is atomic; parallel submissions create one session.
    await db.exec('BEGIN IMMEDIATE');
    try {
      if (pending.purpose === 'link') {
        await db.lockSession(pending.bound_session_hash);
        const session = await getSession(req);
        if (!session || session.requires_confirmation || session.token_hash !== pending.bound_session_hash || session.account_id !== pending.account_id || session.auth_method !== 'google' || session.authenticated_at + LINK_RECENCY_TTL <= now()) {
          await db.exec('ROLLBACK');
          return fail(res, 403, 'link_session_expired', 'Sign in with Google again before linking email sign-in.');
        }
      }
      const consumed = await run("UPDATE email_challenges SET delivery_state='used',code_hash=NULL,staged_password_hash=NULL WHERE id=? AND generation=? AND delivery_state='active' AND expires_at>?", pending.id, pending.generation, now());
      if (!consumed.changes) {
        await db.exec('ROLLBACK');
        return fail(res, 409, 'verification_changed', 'This verification attempt changed. Please try again.');
      }
      const identity = await query("SELECT * FROM identities WHERE provider='password' AND provider_id=?", pending.email);
      if (pending.purpose === 'existing' || pending.purpose === 'link' && identity) {
        await db.exec('COMMIT');
        clearPending(res);
        return fail(res, 409, 'account_action_unavailable', 'We could not complete this request. Sign in using your existing account method.');
      }
      if (pending.purpose === 'link') await run("INSERT INTO identities(provider,provider_id,account_id,password_hash,verified_at) VALUES ('password',?,?,?,?)", pending.email, pending.account_id, pending.staged_password_hash, now());else if (identity && identity.account_id === pending.account_id) {
        if (identity.verified_at && pending.purpose === 'signup') {
          await db.exec('COMMIT');
          clearPending(res);
          return fail(res, 409, 'account_action_unavailable', 'We could not complete this request. Sign in using your existing account method.');
        }
        // Mailbox possession authorizes the staged password only for an unverified account.
        await run("UPDATE identities SET password_hash=?,verified_at=? WHERE provider='password' AND provider_id=?", pending.staged_password_hash || identity.password_hash, now(), pending.email);
        if (pending.staged_name) await run('UPDATE accounts SET name=? WHERE id=?', pending.staged_name, pending.account_id);
      } else throw new Error('Verification identity mismatch');
      await run('UPDATE accounts SET email_verified=1 WHERE id=?', pending.account_id);
      const result = await issueSession(req, res, pending.account_id, pending.purpose === 'link' ? 'google' : 'password');
      await db.exec('COMMIT');
      clearPending(res);
      res.json(result);
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  }));
  app.post('/api/auth/email/resend', validOrigin, requireJson, json, safeAsync(pendingCsrf), safeAsync(async (req, res) => {
    const pending = req.emailPending;
    if (!requireMailer(res) || coolingDown(res, pending.resend_at) || (await emailCooldown(res, pending.email)) || (await deliveryRate(req, res, pending.email))) return;
    if (pending.purpose === 'link') {
      const session = await getSession(req);
      if (!session || session.requires_confirmation || session.token_hash !== pending.bound_session_hash || session.auth_method !== 'google' || session.authenticated_at + LINK_RECENCY_TTL <= now()) return fail(res, 403, 'link_session_expired', 'Sign in with Google again before linking email sign-in.');
    }
    // Invalidate the old code before hashing or attempting SMTP delivery.
    await run("UPDATE email_challenges SET delivery_state='used',code_hash=NULL,staged_password_hash=NULL WHERE email=? AND id!=? AND delivery_state!='used'", pending.email, pending.id);
    const replaced = await run("UPDATE email_challenges SET code_hash=NULL,generation=generation+1,attempts=0,delivery_state='sending',expires_at=?,resend_at=? WHERE id=? AND generation=? AND delivery_state!='used'", now() + EMAIL_CODE_TTL, now() + RESEND_COOLDOWN, pending.id, pending.generation);
    if (!replaced.changes) return fail(res, 409, 'verification_changed', 'This verification attempt changed. Please try again.');
    await deliver(await query('SELECT * FROM email_challenges WHERE id=?', pending.id), res);
  }));
  app.post('/api/auth/email/change', validOrigin, requireJson, json, safeAsync(pendingCsrf), safeAsync(async (req, res) => {
    await run("UPDATE email_challenges SET delivery_state='used',code_hash=NULL,staged_password_hash=NULL WHERE id=?", req.emailPending.id);
    clearPending(res);
    res.json({
      verification: null,
      csrfToken: null
    });
  }));
  app.post('/api/auth/email/link/start', validOrigin, requireJson, json, safeAsync(async (req, res) => {
    const session = await getSession(req);
    if (!session || session.requires_confirmation || !constantTimeEqual(req.get('X-CSRF-Token'), session.csrf_token) || session.auth_method !== 'google' || session.authenticated_at + LINK_RECENCY_TTL <= now()) return fail(res, 403, 'link_session_expired', 'Sign in with Google again before linking email sign-in.');
    const profile = await userProfile(session.account_id);
    const email = normalizedEmail(profile.email);
    if (await rateLimited(req, res, 'link', email, {
      email: 10,
      ip: 40,
      window: 60 * 60 * 1000
    })) return;
    if (!email || !validPassword(req.body?.password)) return fail(res, 400, 'invalid_signup', 'Enter a password between 8 and 128 characters.');
    if (profile.hasPassword) return fail(res, 409, 'account_action_unavailable', 'Email sign-in is already enabled for this account.');
    if (!requireMailer(res) || (await emailCooldown(res, email)) || (await deliveryRate(req, res, email))) return;
    const passwordHash = await hashSecret(req.body.password);
    const currentSession = await getSession(req);
    if (!currentSession || currentSession.requires_confirmation || currentSession.token_hash !== session.token_hash || currentSession.auth_method !== 'google' || currentSession.authenticated_at + LINK_RECENCY_TTL <= now()) return fail(res, 403, 'link_session_expired', 'Sign in with Google again before linking email sign-in.');
    if (await emailCooldown(res, email)) return;
    await deliver(await newPending(req, res, {
      accountId: session.account_id,
      email,
      purpose: 'link',
      passwordHash,
      boundSessionHash: session.token_hash
    }), res);
  }));
  app.post('/api/auth/logout', validOrigin, requireJson, json, safeAsync(async (req, res) => {
    const session = await getSession(req);
    if (!session || !constantTimeEqual(req.get('X-CSRF-Token'), session.csrf_token)) return fail(res, 403, 'invalid_session', 'Your session expired. Please sign in again.');
    await run('DELETE FROM sessions WHERE token_hash=?', session.token_hash);
    clearSession(res);
    const challenge = cookieHash(req, CHALLENGE_COOKIE);
    if (challenge) await run('DELETE FROM google_challenges WHERE token_hash=?', challenge);
    clearChallenge(res);
    const pending = cookieHash(req, VERIFICATION_COOKIE);
    if (pending) await run("UPDATE email_challenges SET delivery_state='used',code_hash=NULL,staged_password_hash=NULL WHERE token_hash=?", pending);
    await invalidatePhone(req, res);
    clearPending(res);
    res.json({
      user: null,
      csrfToken: null
    });
  }));
  const meetingSession = async (req, res) => {
    const session = await getSession(req);
    if (!session) { fail(res, 401, 'sign_in_required', 'Sign in to Talk before joining this meeting.'); return null; }
    if (session.requires_confirmation) { fail(res, 403, 'confirmation_required', 'Finish confirming your Talk sign-in before joining.'); return null; }
    const profile = await userProfile(session.account_id, session.auth_method);
    if (!profile || !profile.emailVerified && !profile.hasPhone) { fail(res, 403, 'verification_required', 'Verify your Talk account before joining.'); return null; }
    if (!meetings) { fail(res, 404, 'meeting_not_found', 'Meeting service is unavailable.'); return null; }
    return session;
  };
  if (schedulingRuntime !== false && meetingManagement) mountScheduling({app,db,manager:meetingManagement,now,origins:trustedOrigins,secureCookies,hostSession:meetingSession,validOrigin,safeAsync,rateLimited,...schedulingRuntime});
  app.get('/api/auth/meetings/:meetingId', safeAsync(async (req, res) => {
    const session = await meetingSession(req, res);
    if (!session) return;
    res.json({ ...await meetingManagement.details(req.params.meetingId, session), configured: meetings.configured, csrfToken: session.csrf_token });
  }));
  app.post('/api/auth/meetings/:meetingId/token', validOrigin, requireJson, json, safeAsync(async (req, res) => {
    const session = await meetingSession(req, res);
    if (!session) return;
    if (!constantTimeEqual(req.get('X-CSRF-Token'), session.csrf_token)) return fail(res, 403, 'invalid_session', 'Your session changed. Please sign in again.');
    if (await rateLimited(req, res, 'meeting-token', session.account_id, { email: 20, ip: 60, window: 60000 })) return;
    if (!validMeetingName(req.body?.displayName)) return fail(res, 400, 'invalid_display_name', 'Enter a display name between 1 and 80 characters.');
    if (!meetings.configured) return fail(res, 503, 'meeting_not_configured', 'The meeting server is not configured yet. Please try again later.');
    const result = await meetingManagement.access(req.params.meetingId, session, req.body.displayName, [...trustedOrigins][0]);
    res.status(result.joinState ? 202 : 200).json(result);
  }));
  app.get('/api/auth/meetings/:meetingId/state', safeAsync(async (req, res) => {
    const session = await meetingSession(req, res); if (!session) return;
    if (await rateLimited(req, res, 'meeting-state', session.account_id, { email: 600, ip: 4000, window: 60000 })) return;
    res.json({ ...await meetingManagement.snapshot(req.params.meetingId, session), csrfToken: session.csrf_token });
  }));
  const meetingWrite = handler => [validOrigin, requireJson, json, safeAsync(async (req, res) => {
    const session = await meetingSession(req, res); if (!session) return;
    if (!constantTimeEqual(req.get('X-CSRF-Token'), session.csrf_token)) return fail(res, 403, 'invalid_session', 'Your Talk session changed. Please sign in again.');
    if (await rateLimited(req, res, 'meeting-action', session.account_id, { email: 120, ip: 1200, window: 60000 })) return;
    await handler(req, res, session);
  })];
  if (recordingService) mountRecordingRoutes({ app, recordings: recordingService, meetingSession, meetingWrite, safeAsync, rateLimited });
  const assistantWrite = handler => [validOrigin, requireJson, express.json({ limit: '1mb' }), safeAsync(async (req, res) => {
    const session = await meetingSession(req, res); if (!session) return;
    if (!constantTimeEqual(req.get('X-CSRF-Token'), session.csrf_token)) return fail(res, 403, 'invalid_session', 'Your Talk session changed. Please sign in again.');
    if (await rateLimited(req, res, 'assistant-write', session.account_id, { email: 30, ip: 120, window: 60000 })) return;
    await handler(req, res, session);
  })];
  mountAssistantRoutes({ app, assistant: assistantService, meetingSession, assistantWrite, safeAsync });
  const whiteboardWrite = (handler, category = 'edit') => [validOrigin, requireJson, express.json({ limit: '256kb' }), safeAsync(async (req,res) => {
    const session = await meetingSession(req,res); if (!session) return;
    res.set('Cache-Control','no-store');
    if (!constantTimeEqual(req.get('X-CSRF-Token'), session.csrf_token)) return fail(res,403,'invalid_session','Refresh Talk before changing this whiteboard.');
    if (await rateLimited(req,res,`whiteboard-${category}`,session.account_id,{email:category === 'cursor' ? 360 : 120,ip:category === 'cursor' ? 2400 : 800,window:60000})) return;
    await handler(req,res,session);
  })];
  mountWhiteboardRoutes({app,whiteboards:whiteboardService,meetingSession,write:whiteboardWrite,validOrigin,safeAsync,rateLimited,constantTimeEqual,fail});
  mountWhiteboardAIRoutes({app,intelligence:whiteboardIntelligence,meetingSession,write:whiteboardWrite,safeAsync,rateLimited,fail});
  app.post('/api/auth/meetings', ...meetingWrite(async (req, res, session) => {
    if (await rateLimited(req, res, 'meeting-create', session.account_id, { email: 10, ip: 40, window: 60000 })) return;
    res.status(201).json(await meetingManagement.create(session, { title: req.body?.title, approvalRequired: req.body?.approvalRequired }));
  }));
  app.post('/api/auth/meetings/:meetingId/create', ...meetingWrite(async (req, res, session) => {
    if (req.params.meetingId !== 'talk-workshop') return fail(res, 404, 'meeting_not_found', 'Create a new meeting instead.');
    res.status(201).json(await meetingManagement.create(session, { id: req.params.meetingId, title: req.body?.title, approvalRequired: req.body?.approvalRequired }));
  }));
  app.post('/api/auth/meetings/:meetingId/actions', ...meetingWrite(async (req, res, session) => {
    if (req.body?.action === 'reaction' && await rateLimited(req, res, `meeting-reaction:${req.params.meetingId}`, session.account_id, { email: 5, ip: 100, window: 10000 })) return;
    res.json(await meetingManagement.action(req.params.meetingId, session, req.body));
  }));
  const profileWrite = safeAsync(async (req, res, next) => {
    const session = await getSession(req);
    if (!session || session.requires_confirmation) return fail(res, 401, 'sign_in_required', 'Sign in to update your profile.');
    if (!constantTimeEqual(req.get('X-CSRF-Token'), session.csrf_token)) return fail(res, 403, 'invalid_csrf', 'Refresh Talk and try again.');
    if (await rateLimited(req, res, req.path.startsWith('/api/auth/profile/background') ? 'background-update' : 'avatar-update', session.account_id, { email: 20, ip: 100, window: 60000 })) return;
    req.avatarSession = session; next();
  });
  const saveAvatar = async (req, res, kind, presetId = null, image = null) => {
    const session = req.avatarSession;
    await run('INSERT INTO account_avatars(account_id,kind,preset_id,image_data,version,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET kind=excluded.kind,preset_id=excluded.preset_id,image_data=excluded.image_data,version=excluded.version,updated_at=excluded.updated_at', session.account_id, kind, presetId, image, randomUUID(), now());
    if (meetingManagement) await meetingManagement.notifyProfileChange(session.account_id);
    res.json({ user: await userProfile(session.account_id, session.auth_method) });
  };
  app.post('/api/auth/profile/avatar', validOrigin, profileWrite, requireJson, json, safeAsync(async (req, res) => {
    if (!validAvatarChoice(req.body)) return fail(res, 400, 'invalid_avatar', 'Choose an available Talk avatar.');
    await saveAvatar(req, res, req.body.kind, req.body.kind === 'preset' ? req.body.presetId : null);
  }));
  app.post('/api/auth/profile/avatar/image', validOrigin, profileWrite, express.raw({ type: () => true, limit: avatarMaxBytes }), safeAsync(async (req, res) => {
    let image;
    try { image = await normalizeAvatar(req.body, req.get('Content-Type')); }
    catch { return fail(res, 400, 'invalid_avatar_image', 'Choose a still JPEG, PNG or WebP image under 2 MB and 10 megapixels.'); }
    await saveAvatar(req, res, 'upload', null, image);
  }));
  app.get('/api/auth/avatars/:accountId/image', safeAsync(async (req, res) => {
    const session = await getSession(req);
    if (!session || session.requires_confirmation) return fail(res, 401, 'sign_in_required', 'Sign in to view this avatar.');
    // Uploaded images are private to the owner and admitted peers in active meetings.
    const peer = req.params.accountId === session.account_id || await query("SELECT 1 FROM talk_meeting_members a JOIN talk_meeting_members b ON a.meeting_id=b.meeting_id JOIN talk_meetings m ON m.id=a.meeting_id WHERE a.account_id=? AND b.account_id=? AND a.admission='admitted' AND b.admission='admitted' AND m.status='active' LIMIT 1", session.account_id, req.params.accountId);
    const avatar = peer && await query("SELECT image_data FROM account_avatars WHERE account_id=? AND kind='upload'", req.params.accountId);
    if (!avatar?.image_data) return fail(res, 404, 'avatar_unavailable', 'This avatar is unavailable.');
    res.type('image/webp').send(Buffer.from(avatar.image_data, 'base64'));
  }));
  app.post('/api/auth/profile/background/image', validOrigin, profileWrite, express.raw({ type: () => true, limit: avatarMaxBytes }), safeAsync(async (req, res) => {
    let image;
    try { image = await normalizeBackgroundImage(req.body, req.get('Content-Type')); }
    catch { return fail(res, 400, 'invalid_background_image', 'Choose a still JPEG, PNG or WebP background under 2 MB and 10 megapixels.'); }
    const version = randomUUID();
    await run('INSERT INTO account_backgrounds(account_id,image_data,version,updated_at) VALUES (?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET image_data=excluded.image_data,version=excluded.version,updated_at=excluded.updated_at', req.avatarSession.account_id, image, version, now());
    res.json({ version, imageUrl: `/api/auth/profile/background/image?v=${version}` });
  }));
  app.get('/api/auth/profile/background', safeAsync(async (req, res) => {
    const session = await getSession(req);
    if (!session || session.requires_confirmation) return fail(res, 401, 'sign_in_required', 'Sign in to use a custom background.');
    const image = await query('SELECT version FROM account_backgrounds WHERE account_id=?', session.account_id);
    res.json(image ? { version: image.version, imageUrl: `/api/auth/profile/background/image?v=${image.version}` } : { version: null });
  }));
  app.get('/api/auth/profile/background/image', safeAsync(async (req, res) => {
    const session = await getSession(req);
    if (!session || session.requires_confirmation) return fail(res, 401, 'sign_in_required', 'Sign in to use a custom background.');
    const image = await query('SELECT image_data FROM account_backgrounds WHERE account_id=?', session.account_id);
    if (!image) return fail(res, 404, 'background_unavailable', 'Upload a background first.');
    res.type('image/webp').send(Buffer.from(image.image_data, 'base64'));
  }));
  app.get('/api/auth/meeting-signal/*', (_req, res) => fail(res, 403, 'meeting_access_denied', 'The meeting connection is unavailable. Return to Talk to request access.'));
  app.use('/api/auth', (_req, res) => fail(res, 404, 'not_found', 'This authentication route does not exist.'));
  app.use('/api/auth', (error, _req, res, next) => {
    if (!error) return next();
    if (error instanceof MeetingError) return fail(res, error.status, error.code, error.message);
    if (error.type === 'entity.too.large') return fail(res, 413, 'payload_too_large', ['/api/auth/profile/avatar/image','/api/auth/profile/background/image'].includes(_req.path) ? 'The image is too large. Choose a picture under 2 MB.' : 'The sign-in request was too large.');
    if (error.type === 'entity.parse.failed') return fail(res, 400, 'invalid_json', 'The sign-in request could not be read.');
    // Never echo/log request bodies, passwords, codes or transport error details.
    return fail(res, 500, 'server_error', 'The sign-in request could not be completed. Please try again.');
  });
  return app;
}
