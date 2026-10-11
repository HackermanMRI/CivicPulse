// App frame. Phone: a slim top bar (module mark or page title + a pill that switches module) and a bottom bar with
// 5 items, Report raised in the middle (B10). Desktop: one floating bar with the same items.
// The module wrapper sets the colour roles (data-module), so every part below uses the same tokens.
import { Link, navigate, useRoute } from "../lib/router.jsx";
import { useApp } from "../lib/store.jsx";
import { Icon, Logo } from "./icons.jsx";
import { OfflineBanner, Toasts, cx } from "./ui.jsx";

const MODULE = {
  gg: { name: "Green Guard", home: "/gg/feed", icon: "pulse", other: "pp" },
  pp: { name: "Price Patrol", home: "/pp", icon: "tag", other: "gg" },
};

function navItems(module) {
  if (module === "pp")
    return [
      { to: "/pp", label: "Prices", desk: "Price Dashboard", icon: "tag" },
      { to: "/pp/explore", label: "Explore", desk: "Explore Prices", icon: "search" },
      { to: "/pp/report", label: "Report", desk: "Report a Price", icon: "plus", raised: true },
      { to: "/alerts", label: "Alerts", icon: "bell" },
      { to: "/profile", label: "Profile", icon: "user" },
    ];
  return [
    { to: "/gg/dashboard", label: "Dashboard", icon: "map" },
    { to: "/gg/feed", label: "Feed", icon: "feed" },
    { to: "/gg/report", label: "Report", icon: "plus", raised: true },
    { to: "/alerts", label: "Alerts", icon: "bell" },
    { to: "/profile", label: "Profile", icon: "user" },
  ];
}

// The pill at the top right: always in the OTHER module's colour, so it reads as a door to that area.
export function SwitchPill({ module, className }) {
  const other = MODULE[MODULE[module].other];
  return (
    <button
      data-module={MODULE[module].other}
      onClick={() => navigate(other.home)}
      className={cx("inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-primary px-4 text-[15px] font-bold text-white shadow-1 hover:brightness-95", className)}
    >
      <Icon name="swap" className="size-4" strokeWidth={2.4} />
      {other.name}
    </button>
  );
}

function Badge({ n, className }) {
  if (!n) return null;
  return <span className={cx("num grid h-5 min-w-5 place-items-center rounded-full bg-err px-1 text-[12px] font-bold leading-none text-white ring-2 ring-white", className)}>{n > 99 ? "99+" : n}</span>;
}

function DesktopBar({ module, items, active, badge }) {
  const m = MODULE[module];
  const { user } = useApp();
  return (
    <div className="mx-auto hidden max-w-[1360px] px-5 pt-4 md:block">
      <div className="flex items-center gap-4 rounded-2xl border border-line/80 bg-white px-4 py-3 shadow-1">
        <Link to={m.home} className="flex items-center gap-3">
          <Logo icon={m.icon} />
          <span className="display text-lg">{m.name}</span>
        </Link>
        <nav aria-label="Main" className={cx("flex flex-1 items-center gap-1", module === "pp" ? "ml-4" : "justify-center")}>
          <div className={cx("flex items-center gap-1", module === "pp" && "rounded-2xl border border-line/80 p-1")}>
            {items.map((it) =>
              it.to === "/profile" && module === "gg" ? (
                <Link key={it.to} to="/profile" aria-current={active(it.to) ? "page" : undefined} aria-label="Profile" className={cx("ml-1 grid size-11 place-items-center rounded-full", active(it.to) ? "bg-primary text-white" : "bg-soft text-primary")}>
                  <Icon name="user" className="size-5" />
                </Link>
              ) : (
                <Link
                  key={it.to}
                  to={it.to}
                  aria-current={active(it.to) ? "page" : undefined}
                  className={cx("flex min-h-11 items-center gap-2 rounded-xl px-4 text-base font-bold", active(it.to) ? "bg-primary text-white" : "text-ink hover:bg-soft/50")}
                >
                  {module === "gg" && <Icon name={it.icon === "plus" ? "plusCircle" : it.icon} className="size-5" />}
                  {it.desk || it.label}
                  {it.icon === "bell" && <Badge n={badge} />}
                </Link>
              ),
            )}
          </div>
        </nav>
        {user?.role === "admin" && (
          <Link to="/admin" className="rounded-xl px-3 py-2 text-sm font-bold text-primary hover:bg-soft/50">
            Admin
          </Link>
        )}
        <SwitchPill module={module} />
      </div>
    </div>
  );
}

// Phone top bar. Feed-like pages show the module mark; other pages show their own title (Alerts → "Green Guard").
function PhoneBar({ module, title }) {
  const m = MODULE[module];
  return (
    <header className="sticky top-0 z-30 bg-bg/95 backdrop-blur md:hidden">
      <div className="flex min-h-16 items-center gap-3 px-4">
        {title ? (
          <span className="display text-lg">{title}</span>
        ) : (
          <Link to={m.home} className="flex items-center gap-3">
            <Logo icon={m.icon} size="sm" />
            <span className="leading-tight">
              <span className="display block text-[17px]">{m.name}</span>
              <span className="block text-xs text-primary">CivicPulse</span>
            </span>
          </Link>
        )}
        <SwitchPill module={module} className="ml-auto" />
      </div>
    </header>
  );
}

function BottomBar({ items, active, badge }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-white pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Main">
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {items.map((it) => {
          const on = active(it.to);
          return (
            <li key={it.to} className="flex justify-center">
              <Link to={it.to} aria-current={on ? "page" : undefined} className="relative flex min-h-[68px] w-full flex-col items-center justify-end gap-1 pb-2 text-[13px]">
                {it.raised ? (
                  <span className="absolute -top-7 grid size-[60px] place-items-center rounded-full bg-primary text-white shadow-2 ring-4 ring-white">
                    <Icon name="plus" className="size-7" strokeWidth={2.4} />
                  </span>
                ) : (
                  <span className={cx("relative grid h-8 w-14 place-items-center rounded-full transition-colors duration-150", on ? "bg-soft text-ink" : "text-ink/80")}>
                    <Icon name={it.icon} className="size-6" strokeWidth={on ? 2.2 : 1.9} />
                    {it.icon === "bell" && <Badge n={badge} className="absolute -top-1 right-2.5" />}
                  </span>
                )}
                <span className={cx(on || it.raised ? "font-bold text-ink" : "font-semibold text-ink/85")}>{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Shell({ module, children, wide, title, bare }) {
  const { path } = useRoute();
  const { unread } = useApp();
  const items = navItems(module);
  const badge = (unread?.alerts || 0) + (unread?.notifications || 0);
  const active = (to) => (to === "/pp" ? path === "/pp" : path === to || path.startsWith(to + "/"));
  return (
    <div data-module={module} className="min-h-dvh bg-bg text-ink">
      <OfflineBanner />
      <DesktopBar module={module} items={items} active={active} badge={badge} />
      {!bare && <PhoneBar module={module} title={title} />}
      <main className={cx("mx-auto px-4 pb-32 md:px-5 md:pb-14 md:pt-6", bare ? "pt-4" : "pt-1", wide ? "max-w-[1360px]" : "max-w-2xl")}>{children}</main>
      <BottomBar items={items} active={active} badge={badge} />
      <Toasts />
    </div>
  );
}

export function Plain({ children, module = "shell", className }) {
  return (
    <div data-module={module} className={cx("min-h-dvh bg-bg text-ink", className)}>
      <OfflineBanner />
      <main className="relative mx-auto flex min-h-dvh max-w-md flex-col px-5 py-6">{children}</main>
      <Toasts />
    </div>
  );
}

export { MODULE };
