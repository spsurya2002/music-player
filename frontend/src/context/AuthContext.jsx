import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as api from "../api/client";
import { emitSignedOut, onLimitsChanged, onUnauthorized } from "../utils/bus";

// Who is using the app. One call to /api/auth/me on load decides whether the
// shell or the login screen renders, and `loading` keeps both off the screen
// until it answers — flashing the login page at someone who is already signed
// in is worse than a blank moment.
//
// The session itself is an HttpOnly cookie, so nothing here holds a token; this
// context holds the *profile*, which is only ever used for display.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState(null);
  // What's left of the two paid features: {reel: {used, limit, left}, file, is_admin}.
  const [quota, setQuota] = useState(null);
  const [loading, setLoading] = useState(true);
  // Set when a session ends on its own rather than by choice, so the login
  // screen can say why it's asking again.
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((d) => {
        if (cancelled) return;
        setUser(d.user || null);
        setStats(d.stats || null);
        setQuota(d.quota || null);
      })
      .catch(() => {
        // Server down, or no session. Either way there's nobody to greet; the
        // login screen's own Google button will report anything that persists.
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Any 401 from anywhere in the app means this session is over.
  useEffect(
    () =>
      onUnauthorized(() => {
        setUser((current) => {
          if (current) {
            setNotice("Your session has expired — sign in again.");
            emitSignedOut();
          }
          return null;
        });
        setStats(null);
        setQuota(null);
      }),
    []
  );

  const signIn = useCallback(async (credential) => {
    const d = await api.signInWithGoogle(credential);
    setNotice("");
    setStats(d.stats || null);
    setQuota(d.quota || null);
    setUser(d.user || null);
    return d.user;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.signOut();
    } finally {
      // The cookie is gone whatever the server said; keeping the shell up after
      // that would just show a library every request now refuses to serve.
      setUser(null);
      setStats(null);
      setQuota(null);
      setNotice("");
      emitSignedOut();
      // Otherwise Google's One Tap signs the same account straight back in,
      // which makes the sign-out button look broken.
      window.google?.accounts?.id?.disableAutoSelect?.();
    }
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      const d = await api.me();
      setStats(d.stats || null);
      if (d.user) setUser(d.user);
    } catch {
      // Stats are decoration; a failed refresh just leaves the last numbers.
    }
  }, []);

  // Re-read after anything that could move it: a use spent or refunded, an
  // answer from the admin. Cheap, and it's what every meter in the app reads.
  const refreshQuota = useCallback(async () => {
    try {
      const d = await api.getQuota();
      setQuota(d.quota || null);
    } catch {
      // Leave the last numbers; the server has the final say on every use anyway.
    }
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    return onLimitsChanged(refreshQuota);
  }, [user, refreshQuota]);

  const isAdmin = Boolean(user && user.is_admin);

  const value = useMemo(
    () => ({ user, stats, quota, isAdmin, loading, notice, signIn, signOut, refreshStats, refreshQuota, setNotice }),
    [user, stats, quota, isAdmin, loading, notice, signIn, signOut, refreshStats, refreshQuota]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
