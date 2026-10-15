import { getApps, initializeApp } from 'firebase/app';
import { initializeAuth, inMemoryPersistence, type Auth } from 'firebase/auth';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || '',
};

let phoneAuth: Auth | undefined;
export const isFirebasePhoneConfigured = () => Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
export const peekPhoneFirebaseAuth = () => phoneAuth;
export const isPhoneTestMode = () => import.meta.env.DEV && import.meta.env.VITE_FIREBASE_PHONE_TESTING === 'true' && typeof window !== 'undefined' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);

/** Firebase proves phone ownership. Talk's existing backend remains the session authority. */
export function getPhoneFirebaseAuth(): Auth {
  if (phoneAuth) return phoneAuth;
  if (!isFirebasePhoneConfigured()) throw new Error('Phone sign-in is not configured.');
  const name = 'talk-phone-auth';
  const app = getApps().find(candidate => candidate.name === name) || initializeApp(config, name);
  // Never persist a Firebase ID/refresh token in browser storage. The verified
  // token is exchanged for Talk's existing HttpOnly session, then signed out.
  phoneAuth = initializeAuth(app, { persistence: inMemoryPersistence });
  // This Firebase-supported local test mode accepts configured fictional test
  // numbers only. It is impossible to enable in a production Vite build or on
  // any non-loopback host, even if the environment flag was accidentally set.
  phoneAuth.settings.appVerificationDisabledForTesting = isPhoneTestMode();
  phoneAuth.useDeviceLanguage();
  return phoneAuth;
}
