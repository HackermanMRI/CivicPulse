// A tiny history router (no dependency). Route changes use the View Transitions API when the browser has it.
import { createContext, useContext, useEffect, useState } from "react";

const RouterCtx = createContext({ path: "/", query: new URLSearchParams() });

function snapshot() {
  return { path: location.pathname, query: new URLSearchParams(location.search) };
}

export function RouterProvider({ children }) {
  const [state, setState] = useState(snapshot);
  useEffect(() => {
    const onPop = () => setState(snapshot());
    window.addEventListener("popstate", onPop);
    window.addEventListener("cp:navigate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("cp:navigate", onPop);
    };
  }, []);
  return <RouterCtx.Provider value={state}>{children}</RouterCtx.Provider>;
}

export const useRoute = () => useContext(RouterCtx);

// Alerts and Profile exist once per module (/gg/alerts, /pp/alerts, …), so the page always knows which module the
// person is in from the URL, and a reload keeps them there.
export const moduleFromPath = (path) => (path.startsWith("/pp") ? "pp" : "gg");
export const MODULE_KEY = { gg: "green_guard", pp: "price_patrol" };

export function navigate(to, { replace = false } = {}) {
  const go = () => {
    history[replace ? "replaceState" : "pushState"](null, "", to);
    window.dispatchEvent(new Event("cp:navigate"));
    window.scrollTo({ top: 0 });
  };
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (document.startViewTransition && !reduce) document.startViewTransition(go);
  else go();
}

export function Link({ to, children, className, replace, ...rest }) {
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to, { replace });
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

export function Redirect({ to }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}
