// Appearance preferences (UI v2): theme, glass and motion. Saved on this device only (localStorage), applied as
// attributes on <html> so plain CSS can react: data-theme="light|dark", data-glass="on|off", data-motion="reduce".
// "System" follows the phone's own setting and updates live when it changes.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const KEY = "cp_appearance";
const DEFAULTS = { theme: "system", glass: "on", motion: "system" };
const META_COLOR = { light: "#eef6f5", dark: "#151b22" };

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    return {
      theme: ["system", "light", "dark"].includes(saved.theme) ? saved.theme : DEFAULTS.theme,
      glass: ["on", "off"].includes(saved.glass) ? saved.glass : DEFAULTS.glass,
      motion: ["system", "reduce"].includes(saved.motion) ? saved.motion : DEFAULTS.motion,
    };
  } catch {
    return { ...DEFAULTS }; // storage blocked (private mode): defaults, nothing saved
  }
}

const media = (q) => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(q) : null);
const systemDark = () => Boolean(media("(prefers-color-scheme: dark)")?.matches);
// Safari has no prefers-reduced-transparency, which is why the in-app switch exists (Liquid Glass rule 8).
const systemNoGlass = () => Boolean(media("(prefers-reduced-transparency: reduce)")?.matches);

export function resolve(prefs) {
  return {
    theme: prefs.theme === "system" ? (systemDark() ? "dark" : "light") : prefs.theme,
    glass: prefs.glass === "off" || systemNoGlass() ? "off" : "on",
    reduceMotion: prefs.motion === "reduce",
  };
}

export function applyAppearance(prefs) {
  const r = resolve(prefs);
  const root = document.documentElement;
  root.dataset.theme = r.theme;
  root.dataset.glass = r.glass;
  if (r.reduceMotion) root.dataset.motion = "reduce";
  else delete root.dataset.motion;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", META_COLOR[r.theme]);
  return r;
}

// Called once before the first render, so the first paint already has the right theme.
export const initialAppearance = () => applyAppearance(load());

const Ctx = createContext({ prefs: DEFAULTS, resolved: resolve(DEFAULTS), set: () => {} });
export const useAppearance = () => useContext(Ctx);

export function AppearanceProvider({ children }) {
  const [prefs, setPrefs] = useState(load);
  const [resolved, setResolved] = useState(() => resolve(prefs));

  useEffect(() => {
    setResolved(applyAppearance(prefs));
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* not saved; still applied for this visit */
    }
  }, [prefs]);

  // Follow the system live while the person uses "System".
  useEffect(() => {
    const queries = [media("(prefers-color-scheme: dark)"), media("(prefers-reduced-transparency: reduce)")].filter(Boolean);
    const onChange = () => setResolved(applyAppearance(prefs));
    queries.forEach((q) => q.addEventListener?.("change", onChange));
    return () => queries.forEach((q) => q.removeEventListener?.("change", onChange));
  }, [prefs]);

  const set = useCallback((patch) => setPrefs((p) => ({ ...p, ...patch })), []);
  const value = useMemo(() => ({ prefs, resolved, set }), [prefs, resolved, set]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
