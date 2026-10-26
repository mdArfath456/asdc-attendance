import { useEffect, useRef } from 'react';
import { useGoogleOAuth } from '@react-oauth/google';

let initializedClientId = null;
let currentHandlers = null;

function credentialCallback(response) {
  if (!response?.credential) {
    currentHandlers?.onError?.();
    return;
  }
  currentHandlers?.onSuccess?.({
    credential: response.credential,
    clientId: response.clientId ?? response.client_id,
    select_by: response.select_by,
  });
}

export default function GoogleSignInButton({ onSuccess, onError, text = 'signin_with', shape = 'rectangular' }) {
  const containerRef = useRef(null);
  const handlersRef = useRef({ onSuccess, onError });
  handlersRef.current = { onSuccess, onError };
  const { clientId, scriptLoadedSuccessfully } = useGoogleOAuth();

  useEffect(() => {
    if (!scriptLoadedSuccessfully || !window.google?.accounts?.id || !containerRef.current) return undefined;
    currentHandlers = {
      onSuccess: (response) => handlersRef.current.onSuccess?.(response),
      onError: () => handlersRef.current.onError?.(),
    };
    if (initializedClientId !== clientId) {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: credentialCallback,
      });
      initializedClientId = clientId;
    }
    containerRef.current.replaceChildren();
    window.google.accounts.id.renderButton(containerRef.current, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text,
      shape,
    });
    return () => {
      if (currentHandlers?.onSuccess) currentHandlers = null;
      containerRef.current?.replaceChildren();
    };
  }, [clientId, scriptLoadedSuccessfully, shape, text]);

  return <div className="google-button" ref={containerRef} />;
}
