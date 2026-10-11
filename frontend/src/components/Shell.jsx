// App frame: desktop top bar + phone bottom bar with 5 items (B10). The module wrapper switches colour roles.
import { Link, useRoute } from "../lib/router.jsx";
import { useApp } from "../lib/store.jsx";
import { OfflineBanner, Toasts, cx } from "./ui.jsx";

const ICONS = {
  dashboard: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z",
  feed: "M4 5h16v3H4V5Zm0 6h16v3H4v-3Zm0 6h10v3H4v-3Z",
  report: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z",
  alerts: "M12 3a6 6 0 0 0-6 6v4l-2 3v1h16v-1l-2-3V9a6 6 0 0 0-6-6Zm0 19a2.5 2.5 0 0 0 2.4-2h-4.8A2.5 2.5 0 0 0 12 22Z",
  profile: "M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.4 0-8 2.2-8 5v2h16v-2c0-2.8-3.6-5-8-5Z",
  explore: "M10 3a7 7 0 1 0 4.2 12.6l5.1 5.1 1.4-1.4-5.1-5.1A7 7 0 0 0 10 3Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z",
};

export function Icon({ name, className = "size-6" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d={ICONS[name]} />
    </svg>
  );
}

function navItems(module) {
  if (module === "pp")
    return [
      { to: "/pp", label: "Prices", icon: "dashboard" },
      { to: "/pp/explore", label: "Explore", icon: "explore" },
      { to: "/pp/report", label: "Report", icon: "report", raised: true },
      { to: "/alerts", label: "Alerts", icon: "alerts" },
      { to: "/profile", label: "Profile", icon: "profile" },
    ];
  return [
    { to: "/gg/dashboard", label: "Dashboard", icon: "dashboard" },
    { to: "/gg/feed", label: "Feed", icon: "feed" },
    { to: "/gg/report", label: "Report", icon: "report", raised: true },
    { to: "/alerts", label: "Alerts", icon: "alerts" },
    { to: "/profile", label: "Profile", icon: "profile" },
  ];
}

export function Shell({ module, children, wide }) {
  const { path } = useRoute();
  const { user, unread } = useApp();
  const items = navItems(module);
  const badge = (unread?.alerts || 0) + (unread?.notifications || 0);
  const active = (to) => (to === "/pp" ? path === "/pp" : path === to || path.startsWith(to + "/"));
  return (
    <div data-module={module} className="min-h-dvh bg-bg text-ink">
      <OfflineBanner />
      <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link to={module === "pp" ? "/pp" : "/gg/feed"} className="flex items-center gap-2 font-bold">
            <span className="relative grid size-8 place-items-center rounded-full bg-primary">
              <span className="size-2.5 rounded-full bg-white" />
            </span>
            <span className="text-lg">CivicPulse</span>
            <span className="hidden text-sm font-semibold text-primary sm:inline">{module === "pp" ? "Price Patrol" : "Green Guard"}</span>
          </Link>
          <nav className="ml-6 hidden items-center gap-1 md:flex" aria-label="Main">
            {items.map((it) => (
              <Link key={it.to} to={it.to} className={cx("rounded-md px-3 py-2 font-semibold", active(it.to) ? "bg-soft" : "hover:bg-soft/60")}>
                {it.label}
                {it.icon === "alerts" && badge > 0 && <span className="num ml-1 rounded-full bg-primary px-1.5 text-xs text-white">{badge}</span>}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/modules" className="rounded-md border-2 border-line px-3 py-1.5 text-sm font-semibold hover:bg-soft/60">
              Switch to {module === "pp" ? "Green Guard" : "Price Patrol"}
            </Link>
            {user?.role === "admin" && (
              <Link to="/admin" className="rounded-md px-3 py-1.5 text-sm font-semibold hover:bg-soft/60">
                Admin
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className={cx("mx-auto px-4 pb-28 pt-5 md:pb-12", wide ? "max-w-6xl" : "max-w-3xl")}>{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line/60 bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Main">
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {items.map((it) => (
            <li key={it.to} className="flex justify-center">
              <Link
                to={it.to}
                aria-current={active(it.to) ? "page" : undefined}
                className={cx("relative flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-xs font-semibold", active(it.to) ? "text-primary" : "text-ink/70")}
              >
                {it.raised ? (
                  <span className="-mt-6 grid size-14 place-items-center rounded-full bg-primary text-white shadow-2">
                    <Icon name={it.icon} className="size-7" />
                  </span>
                ) : (
                  <Icon name={it.icon} />
                )}
                <span>{it.label}</span>
                {it.icon === "alerts" && badge > 0 && <span className="num absolute right-4 top-1.5 rounded-full bg-primary px-1.5 text-[11px] text-white">{badge}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <Toasts />
    </div>
  );
}

export function Plain({ children, module = "shell" }) {
  return (
    <div data-module={module} className="min-h-dvh bg-bg text-ink">
      <OfflineBanner />
      <main className="mx-auto max-w-md px-4 py-8">{children}</main>
      <Toasts />
    </div>
  );
}
