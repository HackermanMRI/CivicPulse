// Small SVG charts (no chart library). Every chart has a text alternative for screen readers.
import { fmtShort } from "../lib/format.js";

export function Bars({ data, height = 120, label }) {
  if (!data?.length) return <p className="text-sm text-ink/60">No data in this window.</p>;
  const max = Math.max(1, ...data.map((d) => d.count));
  const w = 100 / data.length;
  return (
    <figure>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-32 w-full" role="img" aria-label={label}>
        {data.map((d, i) => {
          const h = (d.count / max) * (height - 4);
          return (
            <rect key={d.date} x={i * w + w * 0.15} width={w * 0.7} y={height - h} height={h} rx="0.6" className="fill-primary">
              <title>{`${fmtShort(d.date)}: ${d.count}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex justify-between text-xs text-ink/60">
        <span>{fmtShort(data[0].date)}</span>
        <span>{fmtShort(data[data.length - 1].date)}</span>
      </figcaption>
    </figure>
  );
}

export function HBars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[9rem_1fr_2.5rem] items-center gap-2 text-sm">
          <span className="truncate">{r.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-soft">
            <span className="cp-bar block h-full rounded-full bg-primary" style={{ width: `${(100 * r.value) / max}%` }} />
          </span>
          <span className="num text-right font-semibold">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function Sparkline({ points, className = "h-10 w-28" }) {
  if (!points || points.length < 2) return <span className="text-xs text-ink/50">not enough data</span>;
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

// Price history: verified price (solid) vs raw median of all reports (dashed, labelled as not verified),
// with the TCB/DAM reference band as information only (Q26).
export function PriceChart({ points, reference }) {
  const vals = points.flatMap((p) => [p.verified_price, p.raw_median]).filter((v) => v != null);
  if (reference) vals.push(reference.min_bdt, reference.max_bdt);
  if (!vals.length) return <p className="text-sm text-ink/60">No prices in this period.</p>;
  const min = Math.min(...vals) * 0.97;
  const max = Math.max(...vals) * 1.03;
  const W = 600;
  const H = 220;
  const x = (i) => 40 + (i / Math.max(1, points.length - 1)) * (W - 50);
  const y = (v) => H - 24 - ((v - min) / (max - min || 1)) * (H - 40);
  const path = (key) =>
    points
      .map((p, i) => [i, p[key]])
      .filter(([, v]) => v != null)
      .map(([i, v], k) => `${k ? "L" : "M"}${x(i)},${y(v)}`)
      .join(" ");
  const ticks = [min, (min + max) / 2, max];
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Verified price and raw median over time">
        {reference && <rect x={40} width={W - 50} y={y(reference.max_bdt)} height={Math.max(1, y(reference.min_bdt) - y(reference.max_bdt))} className="fill-info/10" />}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={40} x2={W - 10} y1={y(t)} y2={y(t)} className="stroke-line/50" strokeDasharray="2 4" />
            <text x={4} y={y(t) + 4} className="num fill-ink/60 text-[11px]">
              {Math.round(t)}
            </text>
          </g>
        ))}
        <path d={path("raw_median")} fill="none" strokeWidth="2" strokeDasharray="5 5" className="stroke-ink/40" />
        <path d={path("verified_price")} fill="none" strokeWidth="3" className="stroke-primary" />
        {points.map((p, i) =>
          p.verified_price != null ? (
            <circle key={p.date} cx={x(i)} cy={y(p.verified_price)} r="3.5" className="fill-primary">
              <title>{`${fmtShort(p.date)}: ৳${p.verified_price} (${p.eligible_reports} eligible reports)`}</title>
            </circle>
          ) : null,
        )}
        <text x={40} y={H - 4} className="fill-ink/60 text-[11px]">
          {fmtShort(points[0]?.date)}
        </text>
        <text x={W - 10} y={H - 4} textAnchor="end" className="fill-ink/60 text-[11px]">
          {fmtShort(points[points.length - 1]?.date)}
        </text>
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-sm">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1 w-6 rounded bg-primary" /> Verified price (median of ≥ 3 credible reports)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0 w-6 border-t-2 border-dashed border-ink/40" /> Raw median (not verified)
        </span>
        {reference && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-6 rounded bg-info/20" /> {reference.source} reference band (information only)
          </span>
        )}
      </figcaption>
    </figure>
  );
}
