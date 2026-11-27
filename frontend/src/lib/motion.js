import { useEffect, useRef, useState } from "react";
// Motion tokens (design-system board + UI v2). One place for every timing, so the app moves as one system.
// Durations: instant 100 ms, fast 150, base 220, slow 320, hero 700. Exits run at ~70 % of their entry.
// Springs are for things a finger touches (they can be interrupted mid-way and still look natural).
export const EASE_ENTER = [0.2, 0, 0, 1];
export const EASE_EXIT = [0.3, 0, 1, 1];

export const enter = (duration = 0.22) => ({ duration, ease: EASE_ENTER });
export const exit = (duration = 0.15) => ({ duration, ease: EASE_EXIT });

// Snappy, almost no overshoot: sheets, nav pills, cards settling.
export const spring = { type: "spring", stiffness: 520, damping: 40, mass: 0.9 };
// Gentle: big surfaces (bottom sheet, the floating nav sliding back in).
export const springSoft = { type: "spring", stiffness: 320, damping: 34 };
// A little bounce for small rewards: a pin popping, a status chip landing.
export const pop = { type: "spring", stiffness: 640, damping: 20, mass: 0.8 };

// List entrance: 40 ms apart, at most 6 items delayed; later items appear without waiting.
export const stagger = (i, base = 0) => ({ ...enter(), delay: base + Math.min(i, 5) * 0.04 });

// Tap feedback for motion elements (`whileTap`). CSS `.press` does the same for plain elements.
export const tap = { scale: 0.96 };

// Vote reveal timeline (seconds from the moment the server says OK). See UI v2 plan, "Card spec".
export const REVEAL = { unlock: 0, ring: 0.12, ringDuration: 0.32, details: 0.3, step: 0.04 };

// Sliding active pill for bars that are rebuilt on every page change (top and bottom nav). Motion's shared-layout
// (layoutId) did this by measuring the whole new page in the middle of the switch, which was the biggest lag cost.
// Here the pill remembers where it was on screen; on the new page it waits until that page has painted (two
// frames, so reading its position costs nothing), then glides from the old spot with the Web Animations API
// (transform only, on the compositor). Returns a ref for the pill and whether it starts hidden for those frames.
const pillRects = new Map(); // group -> last DOMRect on screen
const motionReduced = () =>
  document.documentElement.dataset.motion === "reduce" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
export function useGlidePill(group) {
  const ref = useRef(null);
  const [waiting] = useState(() => pillRects.has(group) && !motionReduced());
  useEffect(() => {
    let f2 = 0;
    const f1 = requestAnimationFrame(() => {
      f2 = requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        const to = el.getBoundingClientRect();
        const from = pillRects.get(group);
        pillRects.set(group, to);
        el.style.opacity = "";
        if (!waiting || !from || !to.width || (Math.abs(from.left - to.left) < 1 && Math.abs(from.top - to.top) < 1)) return;
        const t = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
        el.animate([{ transform: t, transformOrigin: "0 0" }, { transform: "none", transformOrigin: "0 0" }], { duration: 340, easing: "cubic-bezier(0.2, 0, 0, 1)" });
      });
    });
    return () => {
      cancelAnimationFrame(f1);
      cancelAnimationFrame(f2);
    };
  }, [group, waiting]);
  return [ref, waiting];
}
