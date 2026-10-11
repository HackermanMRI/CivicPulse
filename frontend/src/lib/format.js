// Display helpers. Every time is shown on a 12-hour clock in Asia/Dhaka (UI decisions).
const TZ = "Asia/Dhaka";
const time12 = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const shortDate = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" });

export const fmtTime = (iso) => (iso ? time12.format(new Date(iso)) : "");
export const fmtDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : "");
export const fmtShort = (iso) => (iso ? shortDate.format(new Date(iso)) : "");
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
  strongly_supported: { label: "Highly credible", color: "bg-st-high", icon: "✓✓" },
  supported: { label: "Credible", color: "bg-st-cred", icon: "✓" },
  uncertain: { label: "Needs more verification", color: "bg-st-verify", icon: "?" },
  not_supported: { label: "Low credibility", color: "bg-st-low", icon: "!" },
  pending: { label: "Checking…", color: "bg-st-cred", icon: "…" },
};

export const MODE = { on_spot: "On the spot", same_ward: "Nearby (same ward)", far_away: "Far away" };
export const DECISION = { confirm: "Issue confirmed", disagree: "Disagree", fixed_now: "Fixed now" };
export const COMPONENT = {
  text: "Description", image: "Photo", gps: "Location", metadata: "Capture time",
  reputation: "Reporter reputation", community: "Community", history: "Area history",
};
