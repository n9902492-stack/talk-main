type GoogleCredentialResponse = { credential?: string; state?: string };

type GoogleIdentityApi = {
  initialize: (config: {
    client_id: string;
    nonce: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select: boolean;
    button_auto_select: boolean;
    ux_mode: 'popup';
  }) => void;
  renderButton: (element: HTMLElement, options: {
    type: 'standard' | 'icon';
    theme: 'outline';
    size: 'large';
    text: 'continue_with';
    shape: 'pill' | 'circle';
    logo_alignment?: 'left';
    width?: string;
    state: string;
  }) => void;
  disableAutoSelect: () => void;
};

type GoogleWindow = Window & { google?: { accounts?: { id?: GoogleIdentityApi } } };

const SCRIPT_URL = 'https://accounts.google.com/gsi/client';
let scriptPromise: Promise<GoogleIdentityApi> | undefined;
let initializedChallenge = '';
let ownerSerial = 0;
let activeOwner: { state: string; callback: (credential: string) => void } | undefined;

function identityApi() { return (window as GoogleWindow).google?.accounts?.id; }

/** Load Google's own button library once; a failed load can be retried. */
export function loadGoogleIdentity(): Promise<GoogleIdentityApi> {
  const existingApi = identityApi();
  if (existingApi) return Promise.resolve(existingApi);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<GoogleIdentityApi>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`);
    const script = existingScript || document.createElement('script');
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
      const api = identityApi();
      if (!error && api) resolve(api);
      else {
        script.remove();
        reject(error || new Error('Google sign-in could not load. Please try again.'));
      }
    };
    const onLoad = () => finish();
    const onError = () => finish(new Error('Google sign-in could not load. Check your connection and try again.'));
    const timeout = window.setTimeout(() => finish(new Error('Google sign-in took too long to load. Please try again.')), 15000);
    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);
    if (!existingScript) {
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }).catch(error => {
    scriptPromise = undefined;
    throw error;
  });
  return scriptPromise;
}

/** Keep callbacks attached to the visible auth page, including SPA navigation. */
export function activateGoogleIdentity(clientId: string, nonce: string, onCredential: (credential: string) => void) {
  const api = identityApi();
  if (!api) throw new Error('Google sign-in could not load. Please try again.');
  const state = `talk-google-${++ownerSerial}`;
  const owner = { state, callback: onCredential };
  activeOwner = owner;
  const challenge = `${clientId}:${nonce}`;
  if (initializedChallenge !== challenge) {
    try { api.initialize({
      client_id: clientId,
      nonce,
      auto_select: false,
      button_auto_select: false,
      ux_mode: 'popup',
      callback: response => {
        // Ignore a popup opened by a page that has since been left or retried.
        if (activeOwner && response.state === activeOwner.state && typeof response.credential === 'string' && response.credential) {
          activeOwner.callback(response.credential);
        }
      },
    }); } catch (error) {
      if (activeOwner === owner) activeOwner = undefined;
      throw error;
    }
    initializedChallenge = challenge;
  }
  return {
    render: (element: HTMLElement, width: number, variant: 'standard' | 'icon' = 'standard') => {
      if (activeOwner !== owner) return;
      element.replaceChildren();
      api.renderButton(element, {
        theme: 'outline', size: 'large', text: 'continue_with', state,
        ...(variant === 'icon'
          ? { type: 'icon', shape: 'circle' }
          : { type: 'standard', shape: 'pill', logo_alignment: 'left', width: String(Math.min(400, Math.max(1, Math.floor(width)))) }),
      });
    },
    dispose: () => { if (activeOwner === owner) activeOwner = undefined; },
  };
}

export function disableGoogleAutoSelect() { identityApi()?.disableAutoSelect(); }
