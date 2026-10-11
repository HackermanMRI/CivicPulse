// Session and app-wide state: the signed-in user, toasts, online status and live notification counts.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, clearPhotoCache, onToken, refresh, setToken } from "./api.js";
import { openStream } from "./stream.js";

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [toasts, setToasts] = useState([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [unread, setUnread] = useState({ alerts: 0, notifications: 0 });
  const [live, setLive] = useState(null); // last live notification (drives the ripple on the dashboard)
  const toastId = useRef(0);

  const toast = useCallback((text, kind = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const loadMe = useCallback(async () => {
    const me = await api("/api/me");
    setUser(me);
    return me;
  }, []);

  // On start: a valid refresh cookie gives a new access token, so users stay signed in (U1: 30 days).
  useEffect(() => {
    refresh()
      .then(loadMe)
      .catch(() => setUser(null))
      .finally(() => setBooting(false));
    const off = onToken((t) => {
      if (!t) setUser(null);
    });
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      off();
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [loadMe]);

  const refreshUnread = useCallback(() => {
    api("/api/notifications/unread-count").then(setUnread).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user || user.role !== "citizen") return undefined;
    refreshUnread();
    let poll = null;
    const stop = openStream((ev) => {
      if (ev.type === "notification") {
        setLive(ev.data);
        refreshUnread();
      }
      if (ev.type === "unavailable" && !poll) poll = setInterval(refreshUnread, 60000); // fall back to polling
    });
    return () => {
      stop();
      if (poll) clearInterval(poll);
    };
  }, [user, refreshUnread]);

  const signIn = useCallback(
    async (session) => {
      setToken(session.access_token);
      return loadMe();
    },
    [loadMe],
  );

  const signOut = useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* the session ends locally anyway */
    }
    setToken(null);
    clearPhotoCache();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, setUser, loadMe, booting, signIn, signOut, toast, toasts, online, unread, refreshUnread, live }),
    [user, loadMe, booting, signIn, signOut, toast, toasts, online, unread, refreshUnread, live],
  );
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

// Small data hook: loads once (and again when `deps` change); exposes loading / error / reload.
export function useData(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    loader()
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState({ data: null, error, loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { ...state, reload: () => setN((x) => x + 1), setData: (data) => setState((s) => ({ ...s, data })) };
}
