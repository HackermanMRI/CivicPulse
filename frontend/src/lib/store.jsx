// Session and app-wide state: the signed-in user, toasts, online status and live notification counts.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, clearPhotoCache, lastLoadedAt, onToken, readDataCache, refresh, setToken, writeDataCache } from "./api.js";
import { fmtTime } from "./format.js";
import { openStream } from "./stream.js";

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [toasts, setToasts] = useState([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [offlineSince, setOfflineSince] = useState(null);
  const [unread, setUnread] = useState({ gg: { alerts: 0, notifications: 0 }, pp: { alerts: 0, notifications: 0 } });
  const [live, setLive] = useState(null); // last live notification (drives the ripple on the dashboard)
  const toastId = useRef(0);

  // Radix Toast closes each toast after its duration (paused on hover/focus) and calls dismiss().
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((text, kind = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
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
    const down = () => {
      const t = lastLoadedAt();
      setOfflineSince(t ? fmtTime(t.toISOString()) : null);
      setOnline(false);
    };
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      off();
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [loadMe]);

  const refreshUnread = useCallback(() => {
    // One count per module: the Green Guard bell never counts price alerts, and the other way round.
    Promise.all(["green_guard", "price_patrol"].map((module) => api("/api/notifications/unread-count", { query: { module } })))
      .then(([gg, pp]) => setUnread({ gg, pp }))
      .catch(() => {});
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
    () => ({ user, setUser, loadMe, booting, signIn, signOut, toast, dismiss, toasts, online, offlineSince, unread, refreshUnread, live }),
    [user, loadMe, booting, signIn, signOut, toast, dismiss, toasts, online, offlineSince, unread, refreshUnread, live],
  );
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

// Small data hook: loads once (and again when `deps` change); exposes loading / error / reload.
// With a `key`, the last answer is kept in memory (lib/api.js): a revisit shows it at once, with no skeleton, and
// is refreshed in the background (stale-while-revalidate). An identical answer doesn't re-render anything.
export function useData(loader, deps = [], key = null) {
  const [state, setState] = useState(() => {
    const cached = key ? readDataCache(key) : undefined;
    return cached !== undefined ? { data: cached, error: null, loading: false } : { data: null, error: null, loading: true };
  });
  const [n, setN] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    let alive = true;
    const cached = key ? readDataCache(key) : undefined;
    if (cached !== undefined) {
      if (!first.current) setState({ data: cached, error: null, loading: false }); // deps changed to a cached key
    } else setState((s) => ({ ...s, loading: true, error: null }));
    first.current = false;
    loader()
      .then((data) => {
        if (key) writeDataCache(key, data);
        if (!alive) return;
        setState((s) => (s.data !== null && !s.loading && !s.error && same(s.data, data) ? s : { data, error: null, loading: false }));
      })
      .catch((error) => alive && setState((s) => (cached !== undefined && error?.status === 0 ? s : { data: null, error, loading: false })));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n, key]);
  return { ...state, reload: () => setN((x) => x + 1), setData: (data) => setState((s) => ({ ...s, data })) };
}

// Cheap deep-equality for JSON answers (a few KB): keeps a background refresh with no news from re-rendering.
function same(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
