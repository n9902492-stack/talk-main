import { clientIpResolver } from './client-ip.mjs';

export function productionConfig(env) {
  const url = new URL(env.APP_URL || 'http://invalid');
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Production APP_URL must be one HTTPS origin.');
  for (const name of ['GOOGLE_CLIENT_ID', 'FIREBASE_PROJECT_ID', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'AUTH_COOKIE_SECRET', 'TRUSTED_PROXY_CIDRS']) {
    if (!env[name]?.trim()) throw new Error(`Missing production backend setting: ${name}.`);
  }
  if (env.AUTH_DB_DRIVER !== 'postgres' || env.AUTH_COOKIE_MODE !== 'hosting') throw new Error('Production requires PostgreSQL storage and Hosting-compatible cookies.');
  if (env.SMTP_PORT !== '587') throw new Error('Production SMTP must use STARTTLS on port 587.');
  if (env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Firebase emulator credentials are forbidden in production.');
  clientIpResolver(env.TRUSTED_PROXY_CIDRS);
  return { origin: url.origin, secureCookies: true };
}
