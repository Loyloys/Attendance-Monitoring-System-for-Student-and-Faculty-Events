import { useEffect, useRef, useState } from 'react';

const GSI_SRC = 'https://accounts.google.com/gsi/client';

type CredentialResponse = { credential?: string };
type GsiApi = {
  accounts: {
    id: {
      initialize: (config: Record<string, unknown>) => void;
      renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
    };
  };
};

declare global {
  interface Window {
    google?: GsiApi;
  }
}

/**
 * Loads the official Google Identity Services client once per page.
 * Rejects rather than hanging when the script cannot be fetched, so the card can
 * show an unavailable state instead of an endless spinner.
 */
let gsiPromise: Promise<GsiApi> | null = null;
function loadGsiClient(): Promise<GsiApi> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise<GsiApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => (window.google ? resolve(window.google) : reject(new Error('Google sign-in is unavailable.'))));
      existing.addEventListener('error', () => reject(new Error('Google sign-in is unavailable.')));
      return;
    }
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => (window.google ? resolve(window.google) : reject(new Error('Google sign-in is unavailable.')));
    script.onerror = () => reject(new Error('Google sign-in is unavailable.'));
    document.head.appendChild(script);
  });
  gsiPromise = gsiPromise.catch(() => { gsiPromise = null; throw new Error('Google sign-in is unavailable.'); });
  return gsiPromise;
}

type GoogleButtonProps = {
  clientId: string;
  nonce: string;
  text: 'signin' | 'signup' | 'continue';
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
};

const CANCELLED = new Set(['popup_closed_by_user', 'popup_closed_user_cancels', 'user_cancelled_popup', 'unknown']);

/**
 * The official Google button, rendered by Google Identity Services. Only the
 * supported styling options are used, and the theme follows the app's dark card
 * rather than any third-party brand colours.
 */
export default function GoogleSignInButton({ clientId, nonce, text, onCredential, onError }: GoogleButtonProps) {
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!container.current) return undefined;

    loadGsiClient()
      .then(google => {
        if (cancelled || !container.current) return;
        google.accounts.id.initialize({
          client_id: clientId,
          nonce,
          // The popup returns a credential to this exact page. No redirect, no
          // additional Google data scopes, and no Google password is ever handled
          // by this application.
          ux_mode: 'popup',
          callback: (response: CredentialResponse) => {
            if (response?.credential) onCredential(response.credential);
            else onError('Google did not return a credential. Please try again.');
          },
          error_callback: (error: { type?: string; message?: string }) => {
            const type = error?.type || '';
            onError(CANCELLED.has(type) ? 'Google sign-in was cancelled.' : (error?.message || 'Google sign-in could not be completed.'));
          },
        });
        container.current.innerHTML = '';
        google.accounts.id.renderButton(container.current, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          width: Math.min(container.current.clientWidth || 400, 400),
          text,
          logo_alignment: 'left',
        });
        setReady(true);
      })
      .catch((error: Error) => onError(error.message));

    return () => { cancelled = true; };
  }, [clientId, nonce, text, onCredential, onError]);

  return <div ref={container} className={`flex min-h-[44px] justify-center ${ready ? '' : 'opacity-0'}`} aria-busy={!ready} />;
}