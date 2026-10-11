// Shared UI parts, styled after the "City Pulse" design-system board.
// Overlays and pickers use Radix primitives (B11: Dialog, Popover, Tabs, Select, Toast, Tooltip): they bring focus
// trapping, Esc, scroll lock, keyboard navigation and ARIA wiring. Motion for React animates them (B5).
import * as RDialog from "@radix-ui/react-dialog";
import * as RPopover from "@radix-ui/react-popover";
import * as RSelect from "@radix-ui/react-select";
import * as RTabs from "@radix-ui/react-tabs";
import * as RToast from "@radix-ui/react-toast";
import * as RTooltip from "@radix-ui/react-tooltip";
import { AnimatePresence, m } from "motion/react";
import { Children, createContext, isValidElement, useContext, useEffect, useState } from "react";
import { photoUrl } from "../lib/api.js";
import { STATUS } from "../lib/format.js";
import { useApp } from "../lib/store.jsx";
import { Icon } from "./icons.jsx";

export function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

// Motion tokens (design-system board): enter 220 ms on the enter curve, exit ~70 % of that on the exit curve.
export const EASE_ENTER = [0.2, 0, 0, 1];
export const EASE_EXIT = [0.3, 0, 1, 1];
export const enter = (duration = 0.22) => ({ duration, ease: EASE_ENTER });
export const exit = (duration = 0.15) => ({ duration, ease: EASE_EXIT });

// Radix renders overlays in a portal on <body>, outside the page's data-module wrapper. The Shell provides the
// current module so every portal can carry the same colour roles.
const ModuleCtx = createContext("shell");
export const ModuleProvider = ModuleCtx.Provider;
export const useModule = () => useContext(ModuleCtx);

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

export function DemoBadge({ className, explain = false }) {
  const badge = "inline-flex shrink-0 rounded-md bg-err px-1.5 py-px text-[11px] font-bold tracking-wide text-white";
  if (!explain)
    return (
      <span title="Synthetic DEMO data. Never used for research results." className={cx(badge, className)}>
        DEMO
      </span>
    );
  return (
    <Popover
      label="What DEMO means"
      trigger={
        <button type="button" className={cx(badge, "cursor-help", className)} aria-label="DEMO data: what does this mean?">
          DEMO
        </button>
      }
    >
      <p className="font-bold">Synthetic DEMO data</p>
      <p className="mt-1">It fills the screens for the demonstration. It is never used for training, testing or any reported result.</p>
    </Popover>
  );
}

// Score bar (credibility / uncertainty). Fills once (vote reveal), the number never counts up.
export function ScoreBar({ value, color = "bg-primary", track = "bg-soft", className, animate = true }) {
  const width = `${Math.max(0, Math.min(100, value ?? 0))}%`;
  return (
    <span className={cx("block h-2 overflow-hidden rounded-full", track, className)} aria-hidden>
      <m.span
        className={cx("block h-full origin-left rounded-full", color)}
        style={{ width }}
        initial={animate ? { scaleX: 0 } : false}
        animate={{ scaleX: 1 }}
        transition={enter(0.32)}
      />
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

// Toasts (Radix Toast: announced to screen readers, swipe or Esc to dismiss): success on the dark text colour,
// errors outlined in red (design-system board).
export function Toasts() {
  const { toasts, dismiss } = useApp();
  const module = useModule();
  return (
    <RToast.Provider swipeDirection="down" duration={4500} label="Notification">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <RToast.Root key={t.id} asChild forceMount type={t.kind === "error" ? "foreground" : "background"} duration={4500} onOpenChange={(open) => !open && dismiss(t.id)}>
            <m.li
              layout
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0, transition: enter() }}
              exit={{ opacity: 0, y: 8, transition: exit() }}
              className={cx(
                "pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-xl px-4 py-3 text-[15px] font-medium shadow-3",
                t.kind === "error" ? "border-[1.5px] border-err bg-white text-err" : t.kind === "warn" ? "border-[1.5px] border-warn bg-white text-warn-ink" : "bg-ink text-white",
              )}
            >
              <Icon name={t.kind === "error" || t.kind === "warn" ? "alert" : "check"} className="mt-0.5 size-5 shrink-0" />
              <RToast.Description className="flex-1">{t.text}</RToast.Description>
              <RToast.Close className="-my-1 -mr-2 grid size-8 shrink-0 place-items-center rounded-full opacity-70 hover:opacity-100" aria-label="Dismiss">
                <Icon name="x" className="size-4" />
              </RToast.Close>
            </m.li>
          </RToast.Root>
        ))}
      </AnimatePresence>
      <RToast.Viewport data-module={module} className="pointer-events-none fixed inset-x-0 bottom-28 z-[60] m-0 flex list-none flex-col items-center gap-2 px-4 outline-none md:bottom-6" />
    </RToast.Provider>
  );
}

// Modal dialog (Radix Dialog: focus trap, Esc, scroll lock, outside click). Phones: a sheet from the bottom.
// Motion: fade + rise, 220 ms in / 150 ms out; reduced motion turns it into a short fade (MotionConfig in main.jsx).
export function Dialog({ open, onClose, title, children, size = "md", bare = false }) {
  const module = useModule();
  const width = { md: "md:max-w-xl", lg: "md:max-w-3xl", xl: "md:max-w-[1240px]" }[size];
  return (
    <RDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <AnimatePresence>
        {open && (
          <RDialog.Portal forceMount>
            <RDialog.Overlay asChild forceMount>
              <m.div
                data-module={module}
                className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 md:items-center md:p-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: enter() }}
                exit={{ opacity: 0, transition: exit() }}
              >
                <RDialog.Content asChild forceMount aria-describedby={undefined}>
                  <m.div
                    className={cx("flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[20px] bg-bg text-ink shadow-3 focus:outline-none md:max-h-[min(92dvh,900px)] md:rounded-[20px]", width)}
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0, transition: enter() }}
                    exit={{ opacity: 0, y: 16, transition: exit() }}
                  >
                    {bare ? (
                      <>
                        <RDialog.Title className="sr-only">{title}</RDialog.Title>
                        {children}
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
                          <RDialog.Title className="display text-xl">{title}</RDialog.Title>
                          <CloseButton onClick={onClose} />
                        </div>
                        <div className="overflow-y-auto px-5 pb-5">{children}</div>
                      </>
                    )}
                  </m.div>
                </RDialog.Content>
              </m.div>
            </RDialog.Overlay>
          </RDialog.Portal>
        )}
      </AnimatePresence>
    </RDialog.Root>
  );
}

// Popover (Radix): small explanations that must work on touch too, where a title tooltip never shows.
export function Popover({ trigger, label, children, side = "bottom" }) {
  const module = useModule();
  return (
    <RPopover.Root>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content data-module={module} side={side} sideOffset={8} collisionPadding={12} aria-label={label} className="z-[70] max-w-72 rounded-xl border border-line bg-white p-3.5 text-sm text-ink shadow-3 focus:outline-none">
          {children}
          <RPopover.Arrow className="fill-white" />
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

// Tooltip (Radix) for icon-only buttons: shows on hover and keyboard focus. The button keeps its aria-label.
export function Tip({ label, children, side = "left" }) {
  const module = useModule();
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content data-module={module} side={side} sideOffset={6} className="z-[70] rounded-lg bg-ink px-2.5 py-1.5 text-[13px] font-semibold text-white shadow-2">
          {label}
          <RTooltip.Arrow className="fill-ink" />
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
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

// Select (Radix): pages keep writing <option> children and onChange(e) like a native select; this wrapper turns
// them into Radix items. Radix reserves "" for "no value", so an enabled "" option (e.g. "All categories") is
// stored under a sentinel, and a disabled "" option becomes the placeholder.
const EMPTY = "__empty__";
const textOf = (node) =>
  typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(textOf).join("") : isValidElement(node) ? textOf(node.props.children) : "";

export function Select({ className, children, compact, value, onChange, id, disabled, required, name, ...rest }) {
  const module = useModule();
  let placeholder;
  const items = [];
  Children.toArray(children).forEach((o) => {
    if (!isValidElement(o) || o.type !== "option") return;
    const v = String(o.props.value ?? "");
    const label = textOf(o.props.children);
    if (v === "" && o.props.disabled) placeholder = label;
    else items.push({ value: v === "" ? EMPTY : v, label, disabled: o.props.disabled });
  });
  const current = value === undefined || value === null ? undefined : String(value) === "" ? (items.some((i) => i.value === EMPTY) ? EMPTY : "") : String(value);
  return (
    <RSelect.Root value={current} onValueChange={(v) => onChange?.({ target: { value: v === EMPTY ? "" : v } })} disabled={disabled} required={required} name={name}>
      <span className={cx("relative block", className)}>
      <RSelect.Trigger
        id={id}
        aria-label={rest["aria-label"]}
        className={cx(inputBase, "relative flex items-center gap-2 pr-10 text-left data-[placeholder]:text-ink/55", compact ? "min-h-11 py-1.5 pl-3 text-sm" : "min-h-[52px] py-2.5 text-[17px]")}
      >
        <span className="min-w-0 flex-1 truncate">
          <RSelect.Value placeholder={placeholder} />
        </span>
        <RSelect.Icon className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ink/80">
          <Icon name="chevronDown" className="size-5" />
        </RSelect.Icon>
      </RSelect.Trigger>
      </span>
      <RSelect.Portal>
        <RSelect.Content
          data-module={module}
          position="popper"
          sideOffset={6}
          collisionPadding={12}
          className="z-[70] max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-line bg-white text-ink shadow-3"
        >
          <RSelect.ScrollUpButton className="grid h-7 place-items-center text-ink/70">
            <Icon name="chevronUp" className="size-4" />
          </RSelect.ScrollUpButton>
          <RSelect.Viewport className="p-1.5">
            {items.map((it) => (
              <RSelect.Item
                key={it.value}
                value={it.value}
                disabled={it.disabled}
                className="relative flex min-h-11 cursor-pointer select-none items-center rounded-lg py-2 pl-9 pr-3 text-[15px] outline-none data-[disabled]:cursor-not-allowed data-[disabled]:text-ink/40 data-[highlighted]:bg-soft/60 data-[state=checked]:font-bold"
              >
                <RSelect.ItemIndicator className="absolute left-2.5 inline-flex">
                  <Icon name="check" className="size-4 text-primary" strokeWidth={2.6} />
                </RSelect.ItemIndicator>
                <RSelect.ItemText>{it.label}</RSelect.ItemText>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
          <RSelect.ScrollDownButton className="grid h-7 place-items-center text-ink/70">
            <Icon name="chevronDown" className="size-4" />
          </RSelect.ScrollDownButton>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
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

// Tabs with counts (Radix Tabs: arrow keys move between tabs). Pass the panel as children so the tab and its
// panel are linked for screen readers.
export function Tabs({ tabs, value, onChange, className, label, children }) {
  return (
    <RTabs.Root value={value} onValueChange={onChange} activationMode="automatic">
      <RTabs.List aria-label={label} className={cx("grid auto-cols-fr grid-flow-col gap-1 rounded-2xl border border-line bg-white p-1", className)}>
        {tabs.map((t) => {
          const on = value === t.value;
          return (
            <RTabs.Trigger key={t.value} value={t.value} className={cx("relative flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-base font-bold", on ? "text-white" : "text-ink hover:bg-soft/40")}>
              {on && <m.span layoutId={`tab-${label || "tabs"}`} className="absolute inset-0 rounded-xl bg-primary" transition={enter()} />}
              <span className="relative">{t.label}</span>
              {t.badge ? (
                <span className={cx("num relative grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[13px] font-bold", on ? "bg-white text-ink" : "bg-err text-white")}>{t.badge}</span>
              ) : null}
            </RTabs.Trigger>
          );
        })}
      </RTabs.List>
      {children !== undefined && (
        <RTabs.Content value={value} className="focus-visible:outline-none" forceMount>
          {children}
        </RTabs.Content>
      )}
    </RTabs.Root>
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
