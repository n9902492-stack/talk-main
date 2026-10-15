import type { AuthUser } from './auth';
import type { EmailAuthResult } from './emailAuth';

type BrowserPassword = Credential & { readonly password: string };
type PasswordConstructor = new (data: { id: string; password: string; name?: string }) => BrowserPassword;
type PendingPassword = {
  credential: BrowserPassword;
  email: string;
  csrfToken: string;
  purpose: 'signup' | 'login' | 'link';
  expiresAt: number;
};

// Only a native credential, in this tab's memory, while verification is active.
// Never write passwords to application storage or send them to analytics/logs.
let pending: PendingPassword | null = null;
let expiryTimer: number | undefined;
const normalizedEmail = (email: string) => email.trim().toLowerCase();

export function clearPendingPassword() {
  pending = null;
  if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
  expiryTimer = undefined;
}

function credential(email: string, password: string, name?: string): BrowserPassword | null {
  try {
    const Constructor = (window as Window & { PasswordCredential?: PasswordConstructor }).PasswordCredential;
    if (!window.isSecureContext || !Constructor || typeof navigator.credentials?.store !== 'function' || !email || !password) return null;
    return new Constructor({ id: normalizedEmail(email), password, ...(name ? { name } : {}) });
  } catch { return null; }
}

function offer(credential: BrowserPassword) {
  // The browser owns the Save/Update UI. Declining, unsupported APIs, or a
  // password-manager error must never delay or reject a Talk sign-in.
  try { void Promise.resolve(navigator.credentials.store(credential)).catch(() => {}); }
  catch { /* Optional browser integration. Do not log credential errors. */ }
}

export function offerToSavePassword(email: string, password: string, user: AuthUser) {
  clearPendingPassword();
  if (user.provider !== 'email' || !user.emailVerified || !user.hasPassword || normalizedEmail(email) !== normalizedEmail(user.email)) return;
  const value = credential(user.email, password, user.name);
  if (value) offer(value);
}

export function stagePasswordForVerification(email: string, password: string, result: EmailAuthResult, source: 'signup' | 'login' | 'link') {
  const details = result.verification;
  const token = result.csrfToken;
  const matches = details && typeof token === 'string' && token.length > 0 && normalizedEmail(details.email) === normalizedEmail(email);
  // A login can resume a signup whose staged password differs from the login
  // password. Only the original signup credential belongs to that challenge.
  if (matches && source === 'login' && details.purpose === 'signup' && pending?.purpose === 'signup' && pending.csrfToken === token && pending.email === normalizedEmail(email) && pending.expiresAt > Date.now()) return;
  clearPendingPassword();
  if (!matches || details.purpose !== source) return;
  const value = credential(email, password);
  if (!value) return;
  pending = { credential: value, email: normalizedEmail(email), csrfToken: token, purpose: source, expiresAt: Date.now() + 10 * 60 * 1000 };
  expiryTimer = window.setTimeout(clearPendingPassword, 10 * 60 * 1000);
}

export function saveVerifiedPassword(user: AuthUser, verifiedChallengeToken?: string) {
  const value = pending;
  clearPendingPassword();
  if (!value || value.expiresAt <= Date.now() || value.csrfToken !== verifiedChallengeToken || value.email !== normalizedEmail(user.email) || !user.emailVerified || !user.hasPassword) return;
  if (user.provider !== 'email' && !(value.purpose === 'link' && user.provider === 'google')) return;
  offer(value.credential);
}
