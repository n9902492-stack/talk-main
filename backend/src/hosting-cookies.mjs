import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const names = new Set(['talk_session', 'talk_auth_challenge', 'talk_email_verification', 'talk_phone_verification', 'talk_password_reset']);
const cookieName = '__session';
const maxAge = 24 * 60 * 60 * 1000;
const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
function key(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('AUTH_COOKIE_SECRET must be a 32-byte base64url secret.');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== 32) throw new Error('Invalid authentication cookie secret.');
  return bytes;
}

/** One authenticated encrypted envelope; existing opaque auth tokens stay intact. */
export function hostingCookies({ secret, previousSecret, origin, now = Date.now }) {
  const keys = [key(secret), ...(previousSecret ? [key(previousSecret)] : [])];
  const aad = Buffer.from(`talk-hosting-cookie:v1:${new URL(origin).origin}`);
  const seal = state => {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', keys[0], iv);
    cipher.setAAD(aad);
    const body = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()]);
    return `v1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')}`;
  };
  function unseal(value) {
    if (typeof value !== 'string' || value.length > 2500 || !/^v1\.[A-Za-z0-9_-]+$/.test(value)) return {};
    const body = Buffer.from(value.slice(3), 'base64url'); if (body.length < 29) return {};
    for (const candidate of keys) try {
      const decipher = createDecipheriv('aes-256-gcm', candidate, body.subarray(0, 12));
      decipher.setAAD(aad); decipher.setAuthTag(body.subarray(12, 28));
      const decoded = JSON.parse(Buffer.concat([decipher.update(body.subarray(28)), decipher.final()]).toString('utf8'));
      const valid = {};
      for (const [name, item] of Object.entries(decoded)) if (names.has(name) && validToken(item?.value) && Number.isFinite(item?.expiresAt) && item.expiresAt > now() && item.expiresAt <= now() + maxAge + 60000) valid[name] = item;
      return valid;
    } catch { /* Tampered, old, wrong-origin and wrong-key cookies are guests. */ }
    return {};
  }
  return (req, res, next) => {
    const incoming = (req.headers.cookie || '').split(';').map(part => part.trim()).filter(part => part.startsWith(cookieName + '='));
    const state = incoming.length === 1 ? unseal(incoming[0].slice(cookieName.length + 1)) : {};
    req.headers.cookie = Object.entries(state).map(([name, item]) => `${name}=${item.value}`).join('; ');
    const nativeCookie = res.cookie.bind(res); const nativeClear = res.clearCookie.bind(res);
    let changed = false;
    res.cookie = (name, value, options) => {
      if (!names.has(name)) return nativeCookie(name, value, options);
      if (!validToken(value) || !Number.isFinite(options?.maxAge) || options.maxAge <= 0 || options.maxAge > maxAge) throw new Error('Invalid internal authentication cookie.');
      state[name] = { value, expiresAt: now() + options.maxAge }; changed = true; return res;
    };
    res.clearCookie = (name, options) => {
      if (!names.has(name)) return nativeClear(name, options);
      // A concurrent guest /session response must not erase a new /config
      // challenge by overwriting an unchanged empty envelope.
      if (Object.hasOwn(state, name)) { delete state[name]; changed = true; }
      return res;
    };
    const writeHead = res.writeHead;
    res.writeHead = function (...args) {
      if (changed) {
        const remaining = Object.values(state);
        const options = { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/auth' };
        if (remaining.length) nativeCookie(cookieName, seal(state), { ...options, maxAge: Math.max(...remaining.map(item => item.expiresAt)) - now() });
        else nativeClear(cookieName, options);
        changed = false;
      }
      return writeHead.apply(this, args);
    };
    next();
  };
}
