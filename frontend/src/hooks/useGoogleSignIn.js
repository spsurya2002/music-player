import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api/client";

// Google Identity Services: the script is loaded on demand (only the login
// screen needs it, and it's third-party — no reason to pull it into every page
// load), initialised with the client ID the server hands out, and asked to draw
// its own button. We never see a password or run a redirect; the callback gets
// one ID token, which goes straight to the backend to be verified.

const GIS_SRC = "https://accounts.google.com/gsi/client";

const BLOCKED =
  "Google's sign-in script didn't load — an extension or network blocker is " +
  "the usual reason.";

let loading = null;

function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = GIS_SRC;
      el.async = true;
      el.defer = true;
      el.onload = () => resolve();
      el.onerror = () => {
        // Clear the cache so a retry (reload, or coming back after unblocking
        // it) actually tries again instead of replaying the failure.
        loading = null;
        reject(new Error(BLOCKED));
      };
      document.head.appendChild(el);
    });
  }
  return loading;
}

/**
 * Draws Google's button into `buttonRef` and calls `onCredential(idToken)`.
 *
 * `configured` is false when the server has no GOOGLE_CLIENT_ID — the screen
 * then explains the one setup step instead of showing a button that can't work.
 */
export default function useGoogleSignIn(onCredential) {
  const buttonRef = useRef(null);
  const [state, setState] = useState({ ready: false, configured: true, error: "" });

  // Keep the newest callback without re-initialising GIS on every render. It's
  // only ever read from Google's callback, which can't fire before mount.
  const callbackRef = useRef(onCredential);
  useEffect(() => {
    callbackRef.current = onCredential;
  }, [onCredential]);

  const render = useCallback(() => {
    const el = buttonRef.current;
    if (!el || !window.google?.accounts?.id) return;
    el.innerHTML = "";
    window.google.accounts.id.renderButton(el, {
      theme: "filled_black",
      size: "large",
      shape: "pill",
      text: "continue_with",
      logo_alignment: "left",
      width: 280,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let clientId = "";
      try {
        const cfg = await api.authConfig();
        clientId = cfg.google_client_id || "";
      } catch (err) {
        if (!cancelled) setState({ ready: false, configured: true, error: err.message });
        return;
      }
      if (cancelled) return;
      if (!clientId) {
        setState({ ready: false, configured: false, error: "" });
        return;
      }

      try {
        await loadGis();
      } catch (err) {
        if (!cancelled) setState({ ready: false, configured: true, error: err.message });
        return;
      }
      if (cancelled) return;

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => callbackRef.current?.(response?.credential || ""),
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      render();
      setState({ ready: true, configured: true, error: "" });
    })();

    return () => {
      cancelled = true;
    };
  }, [render]);

  return { buttonRef, ...state };
}
