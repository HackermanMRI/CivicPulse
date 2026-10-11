// Shared UI parts, styled after the "City Pulse" design-system board. Native elements (dialog, select, input)
// keep the pages accessible without extra libraries.
import { useEffect, useRef, useState } from "react";
import { photoUrl } from "../lib/api.js";
import { STATUS } from "../lib/format.js";
import { useApp } from "../lib/store.jsx";
import { Icon } from "./icons.jsx";

export function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

// Buttons: radius 12, 48 px tall (44 px small). Disabled buttons use the soft fill, never just opacity.
export function Button({ kind = "primary", size = "md", className, busy, busyLabel, icon, children, ...rest }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl font-bold transition-[background-color,filter,box-shadow] duration-150 " +
    "disabled:cursor-not-allowed active:brightness-90";
  const kinds = {
    primary: "bg-primary text-white hover:brightness-90 disabled:bg-soft disabled:text-ink/50",
    soft: "border border-line bg-soft text-ink hover:brightness-95 disabled:opacity-60",
    outline: "border-[1.5px] border-ink/80 bg-white text-ink hover:bg-soft/40 disabled:border-line disabled:text-ink/45",
    line: "border-[1.5px] border-line bg-white text-ink hover:bg-soft/40 disabled:text-ink/45",
    text: "text-primary underline-offset-4 hover:underline disabled:text-ink/45",
    danger: "bg-err text-white hover:brightness-90 disabled:opacity-50",
    dangerText: "text-err hover:underline underline-offset-4",
  };
  const sizes = { sm: "min-h-11 px-3.5 text-sm", md: "min-h-12 px-5 text-base", lg: "min-h-[52px] px-6 text-[17px]" };
  return (
    <button className={cx(base, kinds[kind], kind === "text" || kind === "dangerText" ? "min-h-11 px-1" : sizes[size], className)} disabled={busy || rest.disabled} aria-busy={busy || undefined} {...rest}>
      {busy ? <Icon name="loader" className="size-5 animate-spin" /> : icon ? <Icon name={icon} className="size-5" /> : null}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

export function Card({ className, children, as: Tag = "div", ...rest }) {
  return (
    <Tag className={cx("rounded-2xl border border-line/80 bg-white", className)} {...rest}>
      {children}
    </Tag>
  );
}

// Status chips: filled, white text, each with its own icon so colour is never the only signal.
export function StatusChip({ status, className, size = "md" }) {
  const s = STATUS[status] || STATUS.pending;
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-bold text-white", size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-sm", s.color, className)}>
      <Icon name={s.icon} className={cx(size === "sm" ? "size-3.5" : "size-4", status === "pending" && "animate-spin")} strokeWidth={2.6} />
      {s.label}
    </span>
  );
}

const FLAG_STYLE = {
  category_mismatch: ["bg-st-mismatch text-white", "imageOff"],
  requires_more_verification: ["bg-st-verify text-white", "clock"],
  duplicate: ["bg-soft text-ink", "feed"],
  price_outlier: ["bg-warn-soft text-warn-ink", "alert"],
  suspicious: ["bg-err text-white", "alert"],
};

export function FlagChip({ flag, className }) {
  const [cls, icon] = FLAG_STYLE[flag.code] || ["bg-soft text-ink", "info"];
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-sm font-bold", cls, className)}>
      <Icon name={icon} className="size-4" strokeWidth={2.4} />
      {flag.label}
    </span>
  );
}

export function DemoBadge({ className }) {
  return (
    <span title="Synthetic DEMO data. Never used for research results." className={cx("inline-flex shrink-0 rounded-md bg-err px-1.5 py-px text-[11px] font-bold tracking-wide text-white", className)}>
      DEMO
    </span>
  );
}

// Score bar (credibility / uncertainty). Fills once (vote reveal), the number never counts up.
export function ScoreBar({ value, color = "bg-primary", track = "bg-soft", className, animate = true }) {
  return (
    <span className={cx("block h-2 overflow-hidden rounded-full", track, className)} aria-hidden>
      <span className={cx("block h-full rounded-full", color, animate && "cp-bar")} style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
    </span>
  );
}

export function Skeleton({ className }) {
  return <div className={cx("cp-skeleton", !/\brounded-/.test(className || "") && "rounded-md", className)} aria-hidden />;
}

// Same shape as a feed card, so nothing hints at a score before the vote.
export function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-line/70 bg-white" aria-busy="true" aria-label="Loading">
      <div className="flex items-center gap-3 p-4">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      </div>
      <Skeleton className="h-14 rounded-none opacity-70" />
      <div className="space-y-2 p-4">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-3/4" />
      </div>
      <Skeleton className="h-56 rounded-none opacity-60" />
      <div className="grid grid-cols-3 gap-2 p-4">
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-12 rounded-xl" />
      </div>
    </div>
  );
}

// Empty / error states: an icon disc, a title, one or two next steps (board "States").
export function StateBlock({ icon, tone = "soft", title, children, actions, note }) {
  const disc = {
    soft: "bg-soft text-primary",
    error: "bg-err-soft text-err",
  }[tone];
  return (
    <div className="flex flex-col items-center px-4 py-12 text-center">
      <div className={cx("relative grid size-28 place-items-center rounded-full", disc)}>
        {tone === "soft" && <span className="absolute inset-4 rounded-full border-2 border-dashed border-primary/40" aria-hidden />}
        <Icon name={icon} className="relative size-12" strokeWidth={2.2} />
      </div>
      <h2 className="display mt-6 text-[22px] leading-7">{title}</h2>
      {children && <p className="mt-3 max-w-sm text-[17px] leading-relaxed text-ink/85">{children}</p>}
      {actions && <div className="mt-6 flex w-full max-w-sm flex-col gap-3">{actions}</div>}
      {note && <p className="mt-4 text-sm text-primary">{note}</p>}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = "Couldn't load this", note }) {
  const offline = error?.status === 0;
  return (
    <div role="alert">
      <StateBlock
        icon={offline ? "wifiOff" : "alert"}
        tone="error"
        title={title}
        note={note}
        actions={onRetry && <Button onClick={onRetry}>Try again</Button>}
      >
        {offline ? "The server didn't answer in time. Check your internet connection, then try again." : error?.message || "Something went wrong."}
      </StateBlock>
    </div>
  );
}

export function OfflineBanner() {
  const { online, offlineSince } = useApp();
  if (online) return null;
  return (
    <div role="status" className="sticky top-0 z-40 flex items-center gap-3 bg-ink px-4 py-3 text-[15px] font-medium text-white">
      <Icon name="wifiOff" className="size-5 shrink-0" />
      <span>Offline.{offlineSince ? ` Showing reports from ${offlineSince}.` : " Posting and voting come back when you reconnect."}</span>
    </div>
  );
}

// Toasts: success on the dark text colour, errors outlined in red (design-system board).
export function Toasts() {
  const { toasts } = useApp();
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-28 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            "pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-xl px-4 py-3 text-[15px] font-medium shadow-3",
            t.kind === "error" ? "border-[1.5px] border-err bg-white text-err" : t.kind === "warn" ? "border-[1.5px] border-warn bg-white text-warn-ink" : "bg-ink text-white",
          )}
        >
          <Icon name={t.kind === "error" || t.kind === "warn" ? "alert" : "check"} className="mt-0.5 size-5 shrink-0" />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

// Modal dialog (native <dialog>: focus trap, Esc, backdrop). On phones it fills the screen from the bottom.
export function Dialog({ open, onClose, title, children, size = "md", bare = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const width = { md: "md:max-w-xl", lg: "md:max-w-3xl", xl: "md:max-w-[1240px]" }[size];
  return (
    <dialog ref={ref} className={cx("cp-dialog", width)} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-label={title}>
      {open &&
        (bare ? (
          children
        ) : (
          <div className="flex max-h-[inherit] flex-col">
            <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
              <h2 className="display text-xl">{title}</h2>
              <CloseButton onClick={onClose} />
            </div>
            <div className="overflow-y-auto px-5 pb-5">{children}</div>
          </div>
        ))}
    </dialog>
  );
}

export function CloseButton({ onClick, className, label = "Close" }) {
  return (
    <button className={cx("grid size-11 shrink-0 place-items-center rounded-full bg-bg text-ink hover:bg-soft", className)} onClick={onClick} aria-label={label}>
      <Icon name="x" className="size-5" strokeWidth={2.4} />
    </button>
  );
}

export function Field({ label, hint, error, children, id, className, trailing }) {
  return (
    <div className={cx("space-y-2", className)}>
      {label && (
        <div className="flex items-center justify-between gap-2">
          <label className="block text-[15px] font-bold" htmlFor={id}>
            {label}
          </label>
          {trailing}
        </div>
      )}
      {children}
      {hint && !error && <p className="text-sm text-ink/75">{hint}</p>}
      {error && (
        <p className="flex items-start gap-1.5 text-sm font-medium text-err" role="alert">
          <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

// Inputs: radius 8, 52 px tall; focus = 2 px text-colour border; errors red.
// Size classes are kept apart from the base so a variant never carries two conflicting utilities
// (Tailwind orders same-property utilities by its own rules, not by class order).
export const inputBase =
  "block w-full rounded-lg border-[1.5px] border-line bg-white px-3.5 text-ink placeholder:text-ink/45 " +
  "focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink aria-[invalid=true]:border-err disabled:bg-bg disabled:text-ink/55";
export const inputCls = `${inputBase} min-h-[52px] py-2.5 text-[17px]`;
export const textareaCls = (minH = "min-h-28") => `${inputBase} ${minH} py-2.5 text-[17px] leading-relaxed`;

export function Select({ className, children, compact, ...rest }) {
  return (
    <span className={cx("relative block", className)}>
      <select className={cx(inputBase, "appearance-none pr-10", compact ? "min-h-11 py-1.5 pl-3 text-sm" : "min-h-[52px] py-2.5 text-[17px]")} {...rest}>
        {children}
      </select>
      <Icon name="chevronDown" className="pointer-events-none absolute right-3.5 top-1/2 size-5 -translate-y-1/2 text-ink/80" />
    </span>
  );
}

// Segmented control (7 days / 30 days / This year, 2D / 3D, 30 / 90 days).
export function Segmented({ options, value, onChange, label, className, dark }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("inline-flex rounded-xl border border-line bg-white p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "min-h-10 rounded-lg px-3.5 text-[15px] font-bold transition-colors duration-150",
            value === o.value ? (dark ? "bg-ink text-white" : "bg-primary text-white") : "text-ink hover:bg-soft/50",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Tabs with counts (Alerts | Notifications).
export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div role="tablist" className={cx("grid auto-cols-fr grid-flow-col gap-1 rounded-2xl border border-line bg-white p-1", className)}>
      {tabs.map((t) => {
        const on = value === t.value;
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.value)}
            className={cx("flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-base font-bold", on ? "bg-primary text-white" : "text-ink hover:bg-soft/40")}
          >
            {t.label}
            {t.badge ? (
              <span className={cx("num grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[13px] font-bold", on ? "bg-white text-ink" : "bg-err text-white")}>{t.badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, id, className }) {
  return (
    <label className={cx("inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-[15px] font-semibold", className)} htmlFor={id}>
      <span className="relative grid size-6 place-items-center">
        <input id={id} type="checkbox" className="peer absolute inset-0 cursor-pointer appearance-none rounded-md border-[1.5px] border-line bg-white checked:border-primary checked:bg-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <Icon name="check" className="pointer-events-none relative size-4 text-white opacity-0 peer-checked:opacity-100" strokeWidth={3} />
      </span>
      {label}
    </label>
  );
}

export function Switch({ checked, onChange, label, sub, id }) {
  return (
    <label htmlFor={id} className="flex min-h-[68px] cursor-pointer items-center gap-4 rounded-2xl border border-line bg-white px-4 py-3">
      <span className="relative inline-flex h-7 w-12 shrink-0">
        <input id={id} type="checkbox" role="switch" className="peer absolute inset-0 z-10 cursor-pointer opacity-0" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="absolute inset-0 rounded-full bg-soft transition-colors duration-150 peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink" />
        <span className="absolute left-0.5 top-0.5 size-6 rounded-full bg-white shadow-1 transition-transform duration-150 peer-checked:translate-x-5" />
      </span>
      <span>
        <span className="block font-bold">{label}</span>
        {sub && <span className="block text-sm text-ink/75">{sub}</span>}
      </span>
    </label>
  );
}

export function Photo({ src, alt, className, placeholder = "No photo", children }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    setFailed(false);
    if (src) photoUrl(src).then((u) => alive && setUrl(u)).catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [src]);
  return (
    <div className={cx("relative overflow-hidden bg-soft", className)}>
      {!src || failed ? (
        <div className="grid size-full place-items-center gap-2 text-sm font-semibold text-primary">
          <span className="flex flex-col items-center gap-2">
            <Icon name="image" className="size-8" />
            {placeholder}
          </span>
        </div>
      ) : !url ? (
        <Skeleton className="size-full rounded-none" />
      ) : (
        <img src={url} alt={alt} className="size-full object-cover" loading="lazy" decoding="async" />
      )}
      {children}
    </div>
  );
}

// Section heading under a 2 px rule ("Cards are for actions; information panels sit on the page with a rule").
export function Panel({ title, action, children, className, rule = true }) {
  return (
    <section className={cx(rule && "border-t-2 border-ink/85 pt-3", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="display text-lg">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Avatar({ text, className, icon }) {
  return (
    <span className={cx("grid size-10 shrink-0 place-items-center rounded-full bg-soft text-base font-bold text-primary", className)} aria-hidden>
      {icon ? <Icon name="user" className="size-5" /> : text}
    </span>
  );
}

// Progress segments for the step-by-step flows.
export function StepBar({ step, total, className, currentFull = false }) {
  return (
    <ol className={cx("grid gap-1.5", className)} style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }} aria-label={`Step ${step} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <li key={i} className={cx("h-1.5 rounded-full", i < step - 1 || (currentFull && i === step - 1) ? "bg-primary" : i === step - 1 ? "bg-primary/70" : "bg-soft")} />
      ))}
    </ol>
  );
}

// Dark header used by the two posting flows (report a problem, report a price).
export function FormHeader({ title, note, onClose, stamp }) {
  return (
    <div className="rounded-2xl bg-ink px-5 pb-5 pt-4 text-white">
      <div className="flex items-center justify-between gap-3">
        <button onClick={onClose} className="-ml-2 grid size-11 place-items-center rounded-full hover:bg-white/10" aria-label="Close">
          <Icon name="x" className="size-6" strokeWidth={2.4} />
        </button>
        {stamp && <span className="num rounded-full bg-white/15 px-3 py-1.5 text-sm font-bold">{stamp}</span>}
      </div>
      <h1 className="display mt-2 text-[21px] leading-7 [text-wrap:pretty]">{title}</h1>
      {note && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-white/85">
          <Icon name="lock" className="size-4" />
          {note}
        </p>
      )}
    </div>
  );
}

// Live clock for the form headers (12-hour, Asia/Dhaka).
export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
