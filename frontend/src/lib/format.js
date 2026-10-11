// Display helpers. Every time is shown on a 12-hour clock in Asia/Dhaka (UI decisions).
const TZ = "Asia/Dhaka";
const time12 = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
// "11 Oct 2026" / "11 Oct". Month names are fixed so every browser shows "Sep", never "Sept".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
function parts(iso) {
  const d = typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00+06:00`) : new Date(iso);
  const [y, m, dd] = ymd.format(d).split("-").map(Number);
  return { y, m, d: dd };
}

export const fmtTime = (iso) => (iso ? time12.format(new Date(iso)) : "");
export const fmtDate = (iso) => {
  if (!iso) return "";
  const p = parts(iso);
  return `${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
};
export const fmtShort = (iso) => {
  if (!iso) return "";
  const p = parts(iso);
  return `${p.d} ${MONTHS[p.m - 1]}`;
};
export const fmtDateTime = (iso) => (iso ? `${fmtDate(iso)}, ${fmtTime(iso)}` : "");

export function ago(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(iso);
}

export const bdt = (v) => (v === null || v === undefined ? "—" : `৳${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

export function dhakaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return parts; // YYYY-MM-DD
}

export const STATUS = {
  strongly_supported: { label: "Highly credible", color: "bg-st-high", icon: "checks" },
  supported: { label: "Credible", color: "bg-st-cred", icon: "check" },
  uncertain: { label: "Needs more verification", color: "bg-st-verify", icon: "clock" },
  not_supported: { label: "Low credibility", color: "bg-st-low", icon: "arrowDown" },
  pending: { label: "Checking…", color: "bg-st-cred", icon: "loader" },
};

// "11 Oct 2026 · 8:42 AM" (card band) and "Sun, 11 Oct 2026 · 3:52 PM" (form header).
const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short" });
export const fmtStamp = (iso) => (iso ? `${fmtDate(iso)} · ${fmtTime(iso)}` : "");
export const fmtLongStamp = (iso) => (iso ? `${weekday.format(new Date(iso))}, ${fmtDate(iso)} · ${fmtTime(iso)}` : "");

// "Today, 8:42 AM" / "Yesterday, 6:05 PM" / "10 Oct, 6:15 PM"
export function fmtRelDay(iso) {
  if (!iso) return "";
  const day = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  const d = new Date(iso);
  const today = day(new Date());
  const yest = day(new Date(Date.now() - 86400000));
  const prefix = day(d) === today ? "Today" : day(d) === yest ? "Yesterday" : fmtShort(iso);
  return `${prefix}, ${fmtTime(iso)}`;
}

// "+880 1XXX-XXX-X42" style masking is done by the server; this only formats a local number for display.
export const initials = (name) =>
  (name || "?")
    .replace("(DEMO)", "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase() || "?";

export const MODE = { on_spot: "On the spot", same_ward: "Nearby", far_away: "Far away" };
export const MODE_SHORT = { on_spot: "On spot", same_ward: "Nearby", far_away: "Far away" };
export const DECISION = { confirm: "Issue confirmed", disagree: "Disagree", fixed_now: "Fixed now" };
export const DECISION_PAST = { confirm: "Confirmed", disagree: "Disagreed", fixed_now: "Fixed now" };
export const COMPONENT = {
  text: "Description", image: "Photo", gps: "Location", metadata: "Capture time",
  reputation: "Reporter reputation", community: "Community", history: "Area history",
};
