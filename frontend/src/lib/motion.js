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
