import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuthApp } from './auth.mjs';
import { createVerificationMailer } from './mailer.mjs';
import { createFirebaseTokenVerifier } from './firebase-auth.mjs';
import { openPostgresDatabase } from './postgres-database.mjs';
import { productionConfig } from './production-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Shared backend configuration for Vite development and the production server. */
export function createRuntimeAuth(env, { origins, secureCookies = false }) {
  if (env.NODE_ENV === 'production' || env.AUTH_DB_DRIVER === 'postgres') throw new Error('Use the asynchronous production backend initializer for PostgreSQL.');
  const mailer = createVerificationMailer(env);
  const firebaseProjectId = env.FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID;
  const firebase = createFirebaseTokenVerifier(firebaseProjectId);
  const databasePath = path.resolve(root, env.AUTH_DATABASE_PATH || 'data/talk.sqlite');
  return createAuthApp({
    clientId: env.GOOGLE_CLIENT_ID,
    origins,
    secureCookies,
    databasePath,
    emailConfigured: mailer.configured,
    sendVerification: mailer.sendVerification,
    firebaseProjectId,
    phoneConfigured: firebase.configured,
    verifyFirebaseToken: firebase.verifyIdToken,
  });
}

export async function createProductionAuth(env) {
  const settings = productionConfig(env);
  const mailer = createVerificationMailer(env);
  const firebase = createFirebaseTokenVerifier(env.FIREBASE_PROJECT_ID);
  if (!mailer.configured || !firebase.configured) throw new Error('Production authentication providers are not configured.');
  const database = await openPostgresDatabase(env);
  try {
    const app = createAuthApp({
      clientId: env.GOOGLE_CLIENT_ID, origins: [settings.origin], secureCookies: true,
      database, cookieMode: 'hosting', cookieSecret: env.AUTH_COOKIE_SECRET,
      previousCookieSecret: env.AUTH_COOKIE_SECRET_PREVIOUS, trustedProxyCidrs: env.TRUSTED_PROXY_CIDRS,
      emailConfigured: true, sendVerification: mailer.sendVerification,
      firebaseProjectId: env.FIREBASE_PROJECT_ID, phoneConfigured: true, verifyFirebaseToken: firebase.verifyIdToken,
    });
    app.locals.closeAuthDatabase = () => database.close();
    app.locals.checkAuthDatabase = () => database.withContext(() => database.prepare('SELECT 1 AS ready').get());
    return app;
  } catch (error) { await database.close(); throw error; }
}
