// Shared UI parts. Native elements only (dialog, select, details) for accessibility without extra libraries.
import { useEffect, useRef, useState } from "react";
import { photoUrl } from "../lib/api.js";
import { STATUS } from "../lib/format.js";
import { useApp } from "../lib/store.jsx";

export function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

export function Button({ kind = "primary", size = "md", className, busy, children, ...rest }) {
  const base = "inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed min-h-11";
  const kinds = {
    primary: "bg-primary text-white hover:brightness-110",
    soft: "bg-soft text-ink hover:brightness-95",
    ghost: "text-primary hover:bg-soft/60",
    outline: "border-2 border-line text-ink hover:bg-soft/50",
    danger: "bg-err text-white hover:brightness-110",
  };
  const sizes = { sm: "px-3 text-sm min-h-9", md: "px-4 text-base", lg: "px-6 text-lg min-h-12" };
  return (
    <button className={cx(base, kinds[kind], sizes[size], className)} disabled={busy || rest.disabled} {...rest}>
      {busy && <span className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ className, children, ...rest }) {
  return (
    <div className={cx("rounded-lg border border-line/70 bg-white shadow-1", className)} {...rest}>
      {children}
    </div>
  );
}

export function StatusChip({ status, className }) {
  const s = STATUS[status] || STATUS.pending;
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-semibold text-white", s.color, className)}>
      <span aria-hidden className="num text-xs">{s.icon}</span>
      {s.label}
    </span>
  );
}

const FLAG_STYLE = {
  category_mismatch: "bg-st-mismatch text-white",
  requires_more_verification: "bg-st-verify text-white",
  duplicate: "bg-soft text-ink",
  price_outlier: "bg-warn text-white",
  suspicious: "bg-err text-white",
};

export function FlagChip({ flag }) {
  return <span className={cx("inline-flex rounded-full px-2.5 py-0.5 text-sm font-medium", FLAG_STYLE[flag.code] || "bg-soft")}>{flag.label}</span>;
}

export function DemoBadge({ className }) {
  return (
    <span title="Synthetic DEMO data. Never used for research results." className={cx("inline-flex rounded-sm border border-err/60 bg-err/10 px-1.5 text-xs font-bold tracking-wide text-err", className)}>
      DEMO
    </span>
  );
}

export function Skeleton({ className }) {
  return <div className={cx("cp-skeleton rounded-md", className)} aria-hidden />;
}

export function CardSkeleton() {
  return (
    <Card className="overflow-hidden" aria-busy="true">
      <Skeleton className="h-48 rounded-none" />
      <div className="space-y-2 p-4">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </Card>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="relative grid size-16 place-items-center rounded-full bg-soft">
        <span className="size-3 rounded-full bg-primary" />
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <p className="max-w-sm text-ink/75">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="grid size-14 place-items-center rounded-full bg-err/10 text-2xl font-bold text-err">!</div>
      <p className="max-w-sm font-medium">{error?.message || "Something went wrong."}</p>
      {onRetry && (
        <Button kind="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function OfflineBanner() {
  const { online } = useApp();
  if (online) return null;
  return (
    <div role="status" className="sticky top-0 z-40 bg-warn px-4 py-2 text-center text-sm font-semibold text-white">
      You are offline. You can look around, but posting and voting need a connection.
    </div>
  );
}

export function Toasts() {
  const { toasts } = useApp();
  const color = { info: "bg-info", ok: "bg-ok", error: "bg-err", warn: "bg-warn" };
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
      {toasts.map((t) => (
        <div key={t.id} className={cx("pointer-events-auto max-w-md rounded-md px-4 py-3 font-medium text-white shadow-3", color[t.kind] || color.info)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Dialog({ open, onClose, title, children, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={cx("cp-dialog", wide && "md:max-w-3xl")}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
    >
      {open && (
        <div className="flex max-h-[inherit] flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-line/60 px-5 py-3">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button className="grid size-11 place-items-center rounded-full text-2xl hover:bg-soft" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          <div className="overflow-y-auto">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function Field({ label, hint, error, children, id }) {
  return (
    <label className="block space-y-1.5" htmlFor={id}>
      <span className="block font-semibold">{label}</span>
      {children}
      {hint && !error && <span className="block text-sm text-ink/70">{hint}</span>}
      {error && <span className="block text-sm font-medium text-err">{error}</span>}
    </label>
  );
}

export const inputCls = "block w-full min-h-11 rounded-md border-2 border-line bg-white px-3 py-2 text-base text-ink placeholder:text-ink/45 focus:border-primary focus:outline-none";

export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div role="tablist" className={cx("flex gap-1 rounded-lg bg-soft/60 p-1", className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cx("flex-1 rounded-md px-3 py-2 text-sm font-semibold min-h-10", value === t.value ? "bg-white text-ink shadow-1" : "text-ink/70")}
        >
          {t.label}
          {t.badge ? <span className="num ml-1.5 rounded-full bg-primary px-1.5 text-xs text-white">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Photo({ src, alt, className }) {
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
  if (!src || failed) return <div className={cx("grid place-items-center bg-soft text-sm text-ink/60", className)}>No photo</div>;
  if (!url) return <Skeleton className={cx("rounded-none", className)} />;
  return <img src={url} alt={alt} className={cx("object-cover", className)} loading="lazy" decoding="async" />;
}

export function Score({ label, value, hint }) {
  return (
    <div className="min-w-0">
      <div className="text-sm text-ink/70">{label}</div>
      <div className="num text-2xl font-bold">{value ?? "—"}</div>
      {hint && <div className="text-xs text-ink/60">{hint}</div>}
    </div>
  );
}

export function PageTitle({ title, subtitle, action }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-ink/70">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
