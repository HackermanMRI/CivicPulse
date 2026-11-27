// A tiny history router (no dependency).
// Route changes switch at once. They used to run inside document.startViewTransition, but React renders the new page
// in a later task, so the browser cross-faded the OLD page into itself for ~250–300 ms before the new page even began
// to render (and paid a full style pass to snapshot it). The new page now fades in with a CSS animation on <main>
// (.cp-page-in), which never delays rendering. The card → pop-up photo still uses a View Transition (it renders
// synchronously inside it, see GreenGuard.jsx).
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
  history[replace ? "replaceState" : "pushState"](null, "", to);
  window.dispatchEvent(new Event("cp:navigate"));
  window.scrollTo({ top: 0 });
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
