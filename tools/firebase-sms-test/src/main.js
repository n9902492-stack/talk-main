import { initializeApp } from 'firebase/app';
import {
  initializeAuth,
  inMemoryPersistence,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut,
} from 'firebase/auth';
import './styles.css';

const elements = Object.fromEntries([
  'phone', 'consent', 'send', 'recaptcha', 'code', 'verify', 'status',
  'request-section', 'verification-section',
].map(id => [id, document.getElementById(id)]));

const runId = import.meta.env.VITE_SMS_TEST_RUN_ID || '';
const storageKey = `talk:one-sms-test:${runId}`;
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};
const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

let auth;
let captcha;
let confirmation;
let captchaSolved = false;
let ready = false;
let busy = false;
let sendLocked = false;
let verified = false;
let verificationAttempts = 0;
let verificationEnded = false;

function showStatus(message, kind = 'info') {
  elements.status.textContent = message;
  elements.status.dataset.kind = kind;
}

function validNumber() {
  return /^[6-9][0-9]{9}$/.test(elements.phone.value);
}

function updateControls() {
  elements.phone.disabled = !ready || busy || sendLocked;
  elements.consent.disabled = !ready || busy || sendLocked;
  elements.send.disabled = !ready || busy || sendLocked || !validNumber()
    || !elements.consent.checked || !captchaSolved;
  elements.code.disabled = busy || !confirmation || verified || verificationEnded;
  elements.verify.disabled = busy || !confirmation || verified || verificationEnded
    || !/^[0-9]{6}$/.test(elements.code.value);
}

function readSendLock() {
  if (!navigator.locks?.request) throw new Error('storage-unavailable');
  // No phone number, verification code, ID token, or user ID goes into storage.
  const probeKey = `${storageKey}:storage-check`;
  localStorage.setItem(probeKey, '1');
  localStorage.removeItem(probeKey);
  return localStorage.getItem(storageKey) !== null;
}

async function claimOneRequest() {
  // Serialize across same-origin tabs before touching Firebase. Persist before
  // asking Firebase: even a network failure must not re-enable sending.
  if (!navigator.locks?.request) throw new Error('storage-unavailable');
  return navigator.locks.request(storageKey, { mode: 'exclusive' }, () => {
    if (localStorage.getItem(storageKey) !== null) return false;
    localStorage.setItem(storageKey, 'requested');
    if (localStorage.getItem(storageKey) !== 'requested') {
      throw new Error('storage-unavailable');
    }
    return true;
  });
}

function firebaseErrorMessage(error, operation) {
  // Firebase messages can contain request details. Only map known codes to
  // fixed messages; never display or log the original exception or payload.
  switch (error?.code) {
    case 'auth/invalid-phone-number':
      return 'The mobile number was rejected. Use your own valid 10-digit Indian mobile number.';
    case 'auth/invalid-verification-code':
      return 'That code is incorrect. Check the SMS and enter its six digits.';
    case 'auth/code-expired':
    case 'auth/session-expired':
      return 'This SMS code has expired. This test cannot resend. A new SMS requires a fresh, separately approved test.';
    case 'auth/too-many-requests':
      return 'Firebase temporarily blocked this request to prevent abuse. Wait before planning another approved test.';
    case 'auth/quota-exceeded':
      return 'The Firebase SMS quota has been reached. Check the project quota and billing before another approved test.';
    case 'auth/billing-not-enabled':
      return 'Firebase requires an eligible billing account for this SMS request. Check project billing before another approved test.';
    case 'auth/unauthorized-domain':
    case 'auth/app-not-authorized':
      return 'This HTTPS domain or app is not authorized for Firebase phone verification. Check Firebase authorized domains and API key restrictions.';
    case 'auth/captcha-check-failed':
    case 'auth/missing-app-credential':
    case 'auth/invalid-app-credential':
      return 'Firebase could not validate reCAPTCHA. Check the authorized domain and browser settings before another approved test.';
    case 'auth/operation-not-allowed':
      return 'Firebase rejected phone sign-in. Check that Phone Authentication and the India SMS region policy are enabled.';
    case 'auth/network-request-failed':
      if (operation === 'initialize') return 'Firebase or reCAPTCHA could not load. Check your connection and browser settings. No SMS was requested.';
      return operation === 'send'
        ? 'The network request failed. An SMS may still have been requested. Sending remains locked to avoid requesting a second SMS.'
        : 'The verification request could not reach Firebase. Check your connection before trying the same code again.';
    default:
      if (operation === 'initialize') return 'Firebase or reCAPTCHA could not be prepared. Check the test deployment configuration. No SMS was requested.';
      return operation === 'send'
        ? 'Firebase could not complete the SMS request. Sending remains locked; an SMS may still arrive. Review the configuration before a fresh, separately approved test.'
        : 'Firebase could not verify the code. Try the code again if it is still valid.';
  }
}

async function sendOneSms() {
  // A synchronous lock also prevents double-clicks while the SDK is pending.
  if (!ready || busy || sendLocked || !validNumber()
    || !elements.consent.checked || !captchaSolved) return;
  busy = true;
  sendLocked = true;
  updateControls();

  try {
    if (!await claimOneRequest()) {
      showStatus('This browser has already used this test release. No SMS was requested again. A fresh test requires separate approval.', 'warning');
      return;
    }
  } catch {
    showStatus('The browser could not save the one-request safety lock. No SMS was requested. Use a current browser with site storage enabled before planning a fresh approved test.', 'error');
    return;
  } finally {
    // Do not unlock sending when claiming or storage fails.
    updateControls();
  }

  showStatus('Requesting one SMS from Firebase. Please wait…');
  try {
    confirmation = await signInWithPhoneNumber(auth, `+91${elements.phone.value}`, captcha);
    elements['verification-section'].hidden = false;
    elements.phone.value = '';
    showStatus('Firebase accepted the SMS request. If this is a real number, check your phone. No additional SMS will be requested.', 'success');
    elements.code.focus();
  } catch (error) {
    showStatus(firebaseErrorMessage(error, 'send'), 'error');
  } finally {
    busy = false;
    captchaSolved = false;
    captcha?.clear();
    captcha = undefined;
    updateControls();
    if (confirmation) elements.code.focus();
  }
}

async function verifyCode() {
  if (busy || !confirmation || verified || verificationEnded
    || !/^[0-9]{6}$/.test(elements.code.value)) return;
  busy = true;
  verificationAttempts += 1;
  updateControls();
  showStatus('Verifying the code with Firebase…');
  try {
    await confirmation.confirm(elements.code.value);
    verified = true;
    elements.code.value = '';
    confirmation = undefined;
    await signOut(auth);
    elements['verification-section'].hidden = true;
    showStatus('SMS code verified successfully. The temporary Firebase session has been cleared. You are not signed into Talk.', 'success');
  } catch (error) {
    if (verified) {
      showStatus('SMS code verified successfully. Close this tab to discard the temporary in-memory session. You are not signed into Talk.', 'warning');
      elements['verification-section'].hidden = true;
    } else {
      verificationEnded = verificationAttempts >= 5
        || ['auth/code-expired', 'auth/session-expired'].includes(error?.code);
      showStatus(verificationEnded
        ? `${firebaseErrorMessage(error, 'verify')} Verification is now closed for this test.`
        : `${firebaseErrorMessage(error, 'verify')} ${5 - verificationAttempts} verification attempts remain on this page.`, 'error');
    }
  } finally {
    busy = false;
    updateControls();
  }
}

async function initialize() {
  if (location.protocol !== 'https:' || loopbackHosts.has(location.hostname)) {
    showStatus('Real SMS sending is disabled here. This test must run on the separately approved, authorized HTTPS deployment.', 'warning');
    return;
  }
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(runId)
    || !Object.values(firebaseConfig).every(Boolean)) {
    showStatus('This test release is missing its Firebase configuration or safety identifier. No SMS can be requested.', 'error');
    return;
  }
  try {
    sendLocked = readSendLock();
  } catch {
    showStatus('Browser storage or safe tab locking is unavailable. Use a current browser with site storage enabled. No SMS can be requested without the one-request safety lock.', 'error');
    return;
  }
  if (sendLocked) {
    showStatus('This browser has already used this test release. Sending remains locked. Do not clear storage to retry; a new SMS needs separate approval.', 'warning');
    return;
  }

  try {
    const app = initializeApp(firebaseConfig, `talk-isolated-sms-test-${runId}`);
    auth = initializeAuth(app, { persistence: inMemoryPersistence });
    auth.settings.appVerificationDisabledForTesting = false;
    auth.useDeviceLanguage();
    await signOut(auth);
    captcha = new RecaptchaVerifier(auth, 'recaptcha', {
      size: 'normal',
      callback: () => {
        captchaSolved = true;
        updateControls();
      },
      'expired-callback': () => {
        captchaSolved = false;
        if (!sendLocked) showStatus('reCAPTCHA expired. Complete the challenge again before requesting your one SMS.', 'warning');
        updateControls();
      },
      'error-callback': () => {
        captchaSolved = false;
        if (!sendLocked) showStatus('reCAPTCHA could not load. Check your connection and browser settings. No SMS was requested.', 'error');
        updateControls();
      },
    });
    await captcha.render();
    ready = true;
    showStatus('Enter your number, read the consent, and complete reCAPTCHA. Nothing is sent until you press Send ONE SMS.');
    updateControls();
  } catch (error) {
    showStatus(firebaseErrorMessage(error, 'initialize'), 'error');
    captcha?.clear();
    captcha = undefined;
  }
}

elements.phone.addEventListener('input', () => {
  elements.phone.value = elements.phone.value.replace(/[^0-9]/g, '').slice(0, 10);
  updateControls();
});
elements.consent.addEventListener('change', updateControls);
elements.code.addEventListener('input', () => {
  elements.code.value = elements.code.value.replace(/[^0-9]/g, '').slice(0, 6);
  updateControls();
});
elements.send.addEventListener('click', sendOneSms);
elements.verify.addEventListener('click', verifyCode);
window.addEventListener('storage', event => {
  if (event.key === storageKey && event.newValue !== null) {
    sendLocked = true;
    updateControls();
  }
});
window.addEventListener('pagehide', () => {
  elements.code.value = '';
  elements.phone.value = '';
  confirmation = undefined;
  captcha?.clear();
  if (auth) void signOut(auth).catch(() => {});
});

void initialize();
