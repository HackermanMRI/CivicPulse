// Small SVG charts (no chart library). Every chart has a text alternative for screen readers.
import { fmtShort } from "../lib/format.js";
import { cx } from "./ui.jsx";

// Credible reports per day. Amber = a day with an emerging-issue alert, the last day in the primary colour.
export function DayBars({ data, height = 150 }) {
  if (!data?.length) return <p className="text-sm text-ink/70">No data in this window.</p>;
  const max = Math.max(1, ...data.map((d) => d.count));
  const gap = data.length > 40 ? 1 : 4;
  return (
    <figure>
      <div className="flex items-end border-b border-ink/70" style={{ height, gap }} role="img" aria-label={`Credible reports per day, ${fmtShort(data[0].date)} to ${fmtShort(data[data.length - 1].date)}. Highest ${max}.`}>
        {data.map((d, i) => (
          <span
            key={d.date}
            title={`${fmtShort(d.date)}: ${d.count}${d.alert ? " (emerging-issue alert)" : ""}`}
            className={cx("min-w-0 flex-1 rounded-t-[3px]", d.alert ? "bg-warn" : i === data.length - 1 ? "bg-primary" : "bg-line")}
            style={{ height: `${Math.max(d.count ? 4 : 0, (d.count / max) * 100)}%` }}
          />
        ))}
      </div>
      <figcaption className="mt-2 flex justify-between gap-3 text-[13px] text-primary">
        <span>{fmtShort(data[0].date)}</span>
        <span className="text-center">Amber bar: a day with an emerging-issue alert</span>
        <span>{fmtShort(data[data.length - 1].date)}</span>
      </figcaption>
    </figure>
  );
}

export function HBars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-3 text-[15px]">
          <span className="truncate">{r.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-soft/70">
            <span className="cp-bar block h-full rounded-full bg-primary" style={{ width: `${(100 * r.value) / max}%` }} />
          </span>
          <span className="num text-right font-bold">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function Sparkline({ points, className = "h-10 w-28" }) {
  if (!points || points.length < 2) return null;
  const ys = points.map((p) => p.price);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const d = points.map((p, i) => `${i ? "L" : "M"}${(i / (points.length - 1)) * 100},${36 - ((p.price - min) / span) * 32}`).join(" ");
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className={className} role="img" aria-label={`Verified prices from ${min} to ${max} taka`}>
      <path d={d} fill="none" strokeWidth="2.5" className="stroke-primary" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Price history: verified price (solid) vs the median of all reports (dashed, labelled as not verified), with the
// TCB/DAM reference band as information only (Q26) and a marker on the day a price alert fired.
export function PriceChart({ points, reference, alertDate, alertLabel }) {
  const vals = points.flatMap((p) => [p.verified_price, p.raw_median]).filter((v) => v != null);
  if (reference) vals.push(reference.min_bdt, reference.max_bdt);
  if (!vals.length) return <p className="py-10 text-center text-[15px] text-ink/75">No prices in this period yet.</p>;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const step = niceStep((hi - lo) / 3 || 10);
  const min = Math.floor((lo - step * 0.3) / step) * step;
  const max = Math.ceil((hi + step * 0.3) / step) * step;
  const W = 640;
  const H = 240;
  const L = 48;
  const x = (i) => L + (i / Math.max(1, points.length - 1)) * (W - L - 16);
  const y = (v) => H - 30 - ((v - min) / (max - min || 1)) * (H - 50);
  const path = (key) =>
    points
      .map((p, i) => [i, p[key]])
      .filter(([, v]) => v != null)
      .map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
      .join(" ");
  const ticks = [];
  for (let t = min; t <= max + 1e-9; t += step) ticks.push(t);
  const labels = [0, Math.round((points.length - 1) / 3), Math.round((2 * (points.length - 1)) / 3), points.length - 1];
  const lastIdx = points.map((p) => p.verified_price).lastIndexOf(points.filter((p) => p.verified_price != null).at(-1)?.verified_price);
  const alertIdx = alertDate ? points.findIndex((p) => p.date === alertDate) : -1;
  const alertY = alertIdx >= 0 ? (points[alertIdx].verified_price ?? points[alertIdx].raw_median) : null;
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Verified price and the median of all reports over time">
        {reference && <rect x={L} width={W - L - 16} y={y(reference.max_bdt)} height={Math.max(1, y(reference.min_bdt) - y(reference.max_bdt))} className="fill-info/10" />}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - 16} y1={y(t)} y2={y(t)} className="stroke-line/60" />
            <text x={4} y={y(t) + 4} className="num fill-ink/70 text-[12px]">
              ৳{Math.round(t)}
            </text>
          </g>
        ))}
        <path d={path("raw_median")} fill="none" strokeWidth="2" strokeDasharray="6 5" className="stroke-line" />
        <path d={path("verified_price")} fill="none" strokeWidth="3" strokeLinejoin="round" className="stroke-primary" />
        {lastIdx >= 0 && <circle cx={x(lastIdx)} cy={y(points[lastIdx].verified_price)} r="5.5" className="fill-primary" />}
        {alertY != null && (
          <g>
            <rect x={Math.min(x(alertIdx) - 50, W - 120)} y={Math.max(4, y(alertY) - 38)} width="104" height="24" rx="6" className="fill-err-soft" />
            <text x={Math.min(x(alertIdx) - 50, W - 120) + 52} y={Math.max(4, y(alertY) - 38) + 16} textAnchor="middle" className="fill-err text-[12px] font-bold">
              {alertLabel}
            </text>
          </g>
        )}
        {labels.map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="fill-ink/70 text-[12px]">
            {fmtShort(points[i]?.date)}
          </text>
        ))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-5 text-sm">
        <span className="inline-flex items-center gap-2">
          <span className="h-[3px] w-6 rounded bg-primary" /> Verified price
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="w-6 border-t-2 border-dashed border-line" /> All reports (unverified median)
        </span>
        {reference && (
          <span className="inline-flex items-center gap-2">
            <span className="h-3 w-6 rounded bg-info/20" /> {reference.source} reference (information only)
          </span>
        )}
      </figcaption>
    </figure>
  );
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
