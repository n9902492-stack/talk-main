import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

/**
 * Verification only: Firebase's public signing certificates validate ID tokens.
 * Explicit projectId avoids discovering credentials or sending privileged Admin
 * requests. Revocation/user-record lookups require additional Admin credentials
 * and are deliberately not represented as enabled here.
 */
export function createFirebaseTokenVerifier(projectId) {
  const configured = typeof projectId === 'string' && /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId);
  if (!configured) return { configured: false };
  // Never allow the Admin SDK's emulator mode to accept unsigned tokens on the
  // normal Talk backend, including in local development.
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) return { configured: false };
  const name = `talk-phone-${projectId}`;
  const app = getApps().find((candidate) => candidate.name === name) || initializeApp({ projectId }, name);
  const auth = getAuth(app);
  return {
    configured: true,
    verifyIdToken: (idToken) => {
      if (process.env.FIREBASE_AUTH_EMULATOR_HOST) return Promise.reject(new Error('Firebase emulator credentials are not accepted'));
      return auth.verifyIdToken(idToken, false);
    },
  };
}
