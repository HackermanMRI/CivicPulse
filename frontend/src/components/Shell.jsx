// App frame. Phone: a glass top bar (module mark or page title + a pill that switches module) and a floating glass
// bottom bar with 5 items, Report raised in the middle (B10). The bottom bar slides away while you scroll down to read
// and comes back the moment you scroll up. Desktop: one floating glass bar with the same items.
// Glass only on this floating layer (Liquid Glass rule 1); pages and cards stay solid.
// The module wrapper sets the colour roles (data-module), so every part below uses the same tokens.
import { m } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Link, navigate, useRoute } from "../lib/router.jsx";
import { spring, springSoft } from "../lib/motion.js";
import { useApp } from "../lib/store.jsx";
import { Icon, Logo } from "./icons.jsx";
import { Avatar, ModuleProvider, OfflineBanner, Toasts, cx } from "./ui.jsx";
import { initials } from "../lib/format.js";

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
      { to: "/pp/alerts", label: "Alerts", icon: "bell" },
      { to: "/pp/profile", label: "Profile", icon: "user" },
    ];
  return [
    { to: "/gg/dashboard", label: "Dashboard", icon: "map" },
    { to: "/gg/feed", label: "Feed", icon: "feed" },
    { to: "/gg/report", label: "Report", icon: "plus", raised: true },
    { to: "/gg/alerts", label: "Alerts", icon: "bell" },
    { to: "/gg/profile", label: "Profile", icon: "user" },
  ];
}

// The pill at the top right: always in the OTHER module's colour, so it reads as a door to that area.
export function SwitchPill({ module, className }) {
  const other = MODULE[MODULE[module].other];
  return (
    <button
      data-module={MODULE[module].other}
      onClick={() => navigate(other.home)}
      className={cx(
        "press inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-primary px-4 text-[15px] font-bold text-on-primary shadow-[0_6px_16px_-8px_color-mix(in_srgb,var(--primary)_80%,transparent)] hover:brightness-105",
        className,
      )}
    >
      <Icon name="swap" className="size-4" strokeWidth={2.4} />
      {other.name}
    </button>
  );
}

function Badge({ n, className }) {
  if (!n) return null;
  return (
    <m.span
      key={n}
      initial={{ scale: 0.4 }}
      animate={{ scale: 1 }}
      transition={{ type: "spring", stiffness: 700, damping: 18 }}
      className={cx("num grid h-5 min-w-5 place-items-center rounded-full bg-err px-1 text-[12px] font-bold leading-none text-white ring-2 ring-surface", className)}
    >
      {n > 99 ? "99+" : n}
    </m.span>
  );
}

// Hide the phone bottom bar while the person scrolls down to read; bring it back on any scroll up, near the top,
// or when focus moves into it (keyboard users never lose it). rAF-throttled, passive listener, transform only.
function useHideOnScroll() {
  const [hidden, setHidden] = useState(false);
  const last = useRef(null);
  const ticking = useRef(false);
  useEffect(() => {
    // No scroll read here: reading scrollY right after a route renders forces an early layout (measured: ~18 ms
    // on a 4x slower CPU). The first scroll event sets the starting point instead.
    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        if (last.current === null) last.current = y;
        const dy = y - last.current;
        if (y < 80) setHidden(false);
        else if (dy > 10) setHidden(true);
        else if (dy < -6) setHidden(false);
        if (Math.abs(dy) > 6) last.current = y;
        ticking.current = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return [hidden, setHidden];
}

function DesktopBar({ module, items, active, badge }) {
  const mod = MODULE[module];
  const { user } = useApp();
  return (
    <div className="sticky top-0 z-30 hidden md:block">
      <div className="mx-auto max-w-[1360px] px-5 pb-2 pt-4">
        <div className="glass flex items-center gap-4 rounded-[22px] px-4 py-2.5">
          <Link to={mod.home} className="flex items-center gap-3">
            <Logo icon={mod.icon} />
            <span className="display text-lg">{mod.name}</span>
          </Link>
          <nav aria-label="Main" className={cx("flex flex-1 items-center gap-1", module === "pp" ? "ml-4" : "justify-center")}>
            <div className="flex items-center gap-1 rounded-2xl p-1">
              {items.map((it) =>
                it.icon === "user" && module === "gg" ? (
                  <Link
                    key={it.to}
                    to={it.to}
                    aria-current={active(it.to) ? "page" : undefined}
                    aria-label="Profile"
                    className={cx("press ml-1 grid size-11 place-items-center rounded-full", active(it.to) ? "bg-primary text-on-primary ring-2 ring-primary ring-offset-2 ring-offset-surface" : "bg-soft text-primary")}
                  >
                    {user?.avatar_url ? <Avatar src={user.avatar_url} text={initials(user.display_name)} className="size-11" /> : <Icon name="user" className="size-5" />}
                  </Link>
                ) : (
                  <Link
                    key={it.to}
                    to={it.to}
                    aria-current={active(it.to) ? "page" : undefined}
                    className={cx("relative flex min-h-11 items-center gap-2 rounded-xl px-4 text-base font-bold transition-colors duration-150", active(it.to) ? "text-on-primary" : "text-ink hover:bg-soft/60")}
                  >
                    {active(it.to) && <m.span layoutId="desk-pill" className="absolute inset-0 rounded-xl bg-primary shadow-[0_6px_16px_-8px_var(--primary)]" transition={spring} />}
                    {module === "gg" && <Icon name={it.icon === "plus" ? "plusCircle" : it.icon} className="relative size-5" />}
                    <span className="relative">{it.desk || it.label}</span>
                    {it.icon === "bell" && <Badge n={badge} className="relative" />}
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
    </div>
  );
}

// Phone top bar. Feed-like pages show the module mark; other pages show their own title (Alerts → "Green Guard").
function PhoneBar({ module, title }) {
  const mod = MODULE[module];
  return (
    <header className="glass sticky top-0 z-30 rounded-b-[26px] border-t-0 pt-[env(safe-area-inset-top)] md:hidden">
      <div className="flex min-h-16 items-center gap-3 px-4">
        {title ? (
          <span className="display text-lg">{title}</span>
        ) : (
          <Link to={mod.home} className="flex items-center gap-3">
            <Logo icon={mod.icon} size="sm" />
            <span className="leading-tight">
              <span className="display block text-[17px]">{mod.name}</span>
              <span className="block text-xs font-semibold text-muted">CivicPulse</span>
            </span>
          </Link>
        )}
        <SwitchPill module={module} className="ml-auto" />
      </div>
    </header>
  );
}

function BottomBar({ items, active, badge }) {
  const [hidden, setHidden] = useHideOnScroll();
  const { user } = useApp();
  return (
    <m.nav
      className="fixed inset-x-3 bottom-[calc(10px+env(safe-area-inset-bottom))] z-30 md:hidden"
      aria-label="Main"
      animate={{ y: hidden ? 120 : 0 }}
      transition={springSoft}
      onFocusCapture={() => setHidden(false)}
    >
      <ul className="glass mx-auto grid h-[70px] max-w-lg grid-cols-5 items-stretch rounded-[26px] px-1">
        {items.map((it) => {
          const on = active(it.to);
          return (
            <li key={it.to} className="flex justify-center">
              <Link to={it.to} aria-current={on ? "page" : undefined} className="press relative flex w-full flex-col items-center justify-end gap-0.5 pb-2 text-[12.5px]">
                {it.raised ? (
                  <span className="absolute -top-7 grid size-[58px] place-items-center rounded-[20px] bg-primary text-on-primary shadow-[0_10px_24px_-6px_color-mix(in_srgb,var(--primary)_70%,transparent)] ring-[5px] ring-bg">
                    <Icon name="plus" className="size-7" strokeWidth={2.4} />
                  </span>
                ) : (
                  <span className={cx("relative grid h-8 w-14 place-items-center rounded-full", on ? "text-ink" : "text-muted")}>
                    {on && <m.span layoutId="nav-pill" className="absolute inset-0 rounded-full bg-primary/15" transition={spring} />}
                    {it.icon === "user" && user?.avatar_url ? (
                      <Avatar src={user.avatar_url} text={initials(user.display_name)} className={cx("relative size-7 text-[11px]", on && "ring-2 ring-primary ring-offset-1 ring-offset-surface")} />
                    ) : (
                      <Icon name={it.icon} className="relative size-6" strokeWidth={on ? 2.3 : 1.9} />
                    )}
                    {it.icon === "bell" && <Badge n={badge} className="absolute -top-1 right-2" />}
                  </span>
                )}
                <span className={cx(on || it.raised ? "font-extrabold text-ink" : "font-semibold text-muted")}>{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </m.nav>
  );
}

export function Shell({ module, children, wide, title, bare }) {
  const { path } = useRoute();
  const { unread } = useApp();
  const items = navItems(module);
  const badge = (unread?.[module]?.alerts || 0) + (unread?.[module]?.notifications || 0);
  const active = (to) => (to === "/pp" ? path === "/pp" : path === to || path.startsWith(to + "/"));
  return (
    <ModuleProvider value={module}>
      <div data-module={module} className="relative min-h-dvh bg-bg text-ink">
        <div className="ambient" aria-hidden />
        <OfflineBanner />
        <DesktopBar module={module} items={items} active={active} badge={badge} />
        {!bare && <PhoneBar module={module} title={title} />}
        <main className={cx("relative mx-auto px-4 pb-36 md:px-5 md:pb-14 md:pt-6", bare ? "pt-4" : "pt-3", wide ? "max-w-[1360px]" : "max-w-2xl")}>{children}</main>
        <BottomBar items={items} active={active} badge={badge} />
        <Toasts />
      </div>
    </ModuleProvider>
  );
}

export function Plain({ children, module = "shell", className }) {
  return (
    <ModuleProvider value={module}>
      <div data-module={module} className={cx("relative min-h-dvh bg-bg text-ink", className)}>
        <OfflineBanner />
        <main className="relative mx-auto flex min-h-dvh max-w-md flex-col px-5 py-6">{children}</main>
        <Toasts />
      </div>
    </ModuleProvider>
  );
}

export { MODULE };
