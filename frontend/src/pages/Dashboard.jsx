// Green Guard dashboard (boards: Dashboard 2D, Dashboard 3D; W7, B4, B6, X1): filter bar, KPIs, the map with
// layers / 2D-3D / time-lapse, hotspots, emerging issues, categories, reports per day and the ward comparison.
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { DayBars, HBars } from "../components/charts.jsx";
import { Icon } from "../components/icons.jsx";
import { COLUMN_STEPS, MapControls } from "../components/MapControls.jsx";
import { ReportDialog } from "../components/Report.jsx";
import { Shell } from "../components/Shell.jsx";
import { Checkbox, ErrorState, Segmented, Select, Skeleton, cx } from "../components/ui.jsx";
import { api } from "../lib/api.js";
import { fmtDate, fmtShort, fmtTime } from "../lib/format.js";
import { getPosition } from "../lib/geo.js";
import { useRoute } from "../lib/router.jsx";
import { useApp, useData } from "../lib/store.jsx";

const MapView = lazy(() => import("../components/MapView.jsx"));

const STATUS_OPTIONS = [
  ["credible", "Credible and highly credible"],
  ["all", "All statuses"],
  ["strongly_supported", "Highly credible"],
  ["supported", "Credible"],
  ["uncertain", "Needs more verification"],
  ["not_supported", "Low credibility"],
];
const DEFAULTS = { period: "30", category: "", status: "credible", ward: "", showResolved: false };
const DAY = 86400000;

function dhakaYearStart() {
  const y = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric" }).format(new Date());
  return `${y}-01-01`;
}

function Kpi({ label, value, sub, first }) {
  return (
    <div className={cx("min-w-0 px-4 py-4", !first && "border-l border-line")}>
      <p className="text-sm font-semibold text-primary">{label}</p>
      <p className="num mt-1 truncate text-[34px] font-extrabold leading-10">{value ?? "—"}</p>
      {sub && <p className="text-sm text-primary">{sub}</p>}
    </div>
  );
}

function SideHead({ children }) {
  return <h2 className="display border-t-2 border-ink/85 pt-3 text-lg">{children}</h2>;
}

function LayerChip({ on, onClick, children }) {
  return (
    <button onClick={onClick} aria-pressed={on} className={cx("min-h-10 rounded-full border-[1.5px] px-4 text-[15px] font-bold", on ? "border-primary bg-primary text-white" : "border-line bg-white text-ink")}>
      {children}
    </button>
  );
}

export default function Dashboard() {
  const { live } = useApp();
  const { query } = useRoute();
  const [f, setF] = useState(DEFAULTS);
  const [mode, setMode] = useState("2d");
  const [layers, setLayers] = useState({ markers: false, clusters: true, heat: true, hotspots: true });
  const [weight, setWeight] = useState(false);
  const [until, setUntil] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [focus, setFocus] = useState(() => (query.get("lat") ? { lat: Number(query.get("lat")), lon: Number(query.get("lon")), zoom: 16 } : null));
  const [open, setOpen] = useState(null);
  const [no3d, setNo3d] = useState(false);
  const [liveTag, setLiveTag] = useState(null);
  const ctl = useRef(null);
  const timer = useRef(null);

  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const windowQuery = f.period === "year" ? { start: dhakaYearStart() } : { days: Number(f.period) };
  const common = { ...windowQuery, category: f.category || undefined, ward_id: f.ward || undefined };
  const results = { status: f.status, show_resolved: f.showResolved };

  const cats = useData(() => api("/api/categories"), []);
  const wards = useData(() => api("/api/wards"), []);
  const key = JSON.stringify(f);
  const summary = useData(() => api("/api/insights/summary", { query: { ...common, ...results } }), [key, live?.id]);
  const points = useData(() => api("/api/insights/map", { query: { ...common, ...results } }), [key, live?.id]);
  const grid = useData(() => (mode === "3d" ? api("/api/insights/grid", { query: { ...common, show_resolved: f.showResolved } }) : Promise.resolve(null)), [key, mode]);
  const hotspots = useData(() => api("/api/insights/hotspots"), []);
  const alerts = useData(() => api("/api/insights/alerts", { query: { days: 14 } }), []);

  // Live ripple + tag for a new report in the user's areas (B6).
  useEffect(() => {
    if (live?.kind !== "new_report_in_ward") return undefined;
    setLiveTag(`New report in ${live.payload?.ward || "your area"} · just now`);
    const t = setTimeout(() => setLiveTag(null), 6000);
    return () => clearTimeout(t);
  }, [live]);

  const range = useMemo(() => {
    const end = Date.now();
    const start = f.period === "year" ? new Date(`${dhakaYearStart()}T00:00:00+06:00`).getTime() : end - Number(f.period) * DAY;
    return { start, end };
  }, [f.period, points.data]); // eslint-disable-line react-hooks/exhaustive-deps

  function togglePlay() {
    if (playing) {
      clearInterval(timer.current);
      setPlaying(false);
      return;
    }
    setPlaying(true);
    let t = range.start + 7 * DAY;
    setUntil(t);
    timer.current = setInterval(() => {
      t += 7 * DAY;
      if (t >= range.end) {
        clearInterval(timer.current);
        setPlaying(false);
        setUntil(null);
      } else setUntil(t);
    }, 900);
  }
  useEffect(() => () => clearInterval(timer.current), []);

  async function nearMe() {
    try {
      const p = await getPosition();
      setFocus({ lat: p.lat, lon: p.lon, zoom: 15, k: Date.now() });
    } catch {
      /* the button stays; the user can use the area list instead */
    }
  }

  const s = summary.data;
  const ward = (wards.data || []).find((w) => String(w.id) === String(f.ward));
  const catName = (cats.data || []).find((c) => c.code === f.category)?.name_en;
  const hs = (hotspots.data || []).filter((h) => !f.category || h.category.code === f.category).slice(0, 3);
  const weekOf = new Date(until ?? range.end);
  const isDefault = JSON.stringify(f) === JSON.stringify(DEFAULTS);
  const periodLabel = { 7: "last 7 days", 30: "last 30 days", year: "this year" }[f.period];
  const topCats = s ? s.by_category.filter((c) => c.count > 0) : [];
  const catRows = topCats.length > 5 ? [...topCats.slice(0, 4).map((c) => ({ label: c.name_en, value: c.count })), { label: `Other ${topCats.length - 4}`, value: topCats.slice(4).reduce((a, c) => a + c.count, 0) }] : topCats.map((c) => ({ label: c.name_en, value: c.count }));

  return (
    <Shell module="gg" wide>
      {s?.includes_demo_data && (
        <p className="mb-4 flex items-center gap-2 rounded-xl bg-err-soft px-4 py-2.5 text-sm font-semibold text-err">
          <Icon name="info" className="size-4 shrink-0" />
          This dashboard includes synthetic DEMO data. It is for demonstration only and never used in research results.
        </p>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
        <h1 className="display mr-2 text-[28px] leading-9">{ward ? ward.name_en : "All pilot wards"}</h1>
        <Segmented
          label="Time window"
          value={f.period}
          onChange={(period) => set({ period })}
          options={[
            { value: "7", label: "7 days" },
            { value: "30", label: "30 days" },
            { value: "year", label: "This year" },
          ]}
        />
        <label className="flex items-center gap-2 text-[15px] font-bold">
          Category
          <Select compact className="w-36" value={f.category} onChange={(e) => set({ category: e.target.value })}>
            <option value="">All {cats.data?.length || 7} categories</option>
            {(cats.data || []).map((c) => (
              <option key={c.code} value={c.code}>
                {c.name_en}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2 text-[15px] font-bold">
          Status
          <Select compact className="w-56" value={f.status} onChange={(e) => set({ status: e.target.value })}>
            {STATUS_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2 text-[15px] font-bold">
          Ward
          <Select compact className="w-36" value={f.ward} onChange={(e) => set({ ward: e.target.value })}>
            <option value="">All pilot wards</option>
            {(wards.data || []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name_en}
              </option>
            ))}
          </Select>
        </label>
        <Checkbox id="resolved" checked={f.showResolved} onChange={(showResolved) => set({ showResolved })} label="Show resolved" />
      </div>
      <button onClick={() => setF(DEFAULTS)} disabled={isDefault} className="mt-2 min-h-11 font-bold text-primary underline-offset-4 hover:underline disabled:text-ink/40 disabled:no-underline">
        Reset filters
      </button>

      {/* KPIs */}
      <section className="mt-3 grid grid-cols-2 border-y border-line sm:grid-cols-3 lg:grid-cols-5" aria-label="Key numbers" aria-busy={summary.loading}>
        {summary.error ? (
          <div className="col-span-full">
            <ErrorState error={summary.error} onRetry={summary.reload} title="Couldn't load the numbers" />
          </div>
        ) : !s ? (
          Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="px-4 py-4">
              <Skeleton className="h-16" />
            </div>
          ))
        ) : (
          <>
            <Kpi first label={f.status === "credible" ? "Credible reports" : "Reports"} value={s.in_view} sub="in view" />
            <Kpi label="New this week" value={s.new_this_week} sub={f.status === "credible" ? "credible or better" : "in view"} />
            <Kpi label="Resolved" value={s.resolved_events} sub={'3 "Fixed now" votes each'} />
            <Kpi label="Active hotspots" value={s.active_hotspots} sub="last 30 days" />
            <Kpi label="Top category" value={s.top_category?.name_en || "—"} sub={s.top_category ? `${s.top_category.share_display}% of reports` : "no reports yet"} />
          </>
        )}
      </section>

      <div className="mt-6 grid gap-8 xl:grid-cols-[1fr_340px]">
        {/* Map card */}
        <section className="overflow-hidden rounded-2xl border border-line/80 bg-white">
          <div className="flex flex-wrap items-center gap-2.5 border-b border-line/70 px-4 py-3">
            {mode === "2d" ? (
              <>
                <LayerChip on={layers.markers} onClick={() => setLayers({ ...layers, markers: !layers.markers })}>
                  Markers
                </LayerChip>
                <LayerChip on={layers.clusters} onClick={() => setLayers({ ...layers, clusters: !layers.clusters })}>
                  Clusters
                </LayerChip>
                <LayerChip on={layers.heat} onClick={() => setLayers({ ...layers, heat: !layers.heat })}>
                  Heatmap
                </LayerChip>
                <LayerChip on={layers.hotspots} onClick={() => setLayers({ ...layers, hotspots: !layers.hotspots })}>
                  Hotspots
                </LayerChip>
                <Checkbox id="sev" className="ml-1" checked={weight} onChange={setWeight} label="Weight by severity" />
              </>
            ) : (
              <p className="min-h-10 content-center">
                <b className="display">Credible reports, {periodLabel}</b> <span className="text-sm text-primary">{catName || `All ${cats.data?.length || 7} categories`} · {ward ? ward.name_en : "All pilot wards"}</span>
              </p>
            )}
            <div className="ml-auto flex items-center gap-2.5">
              <Segmented
                label="Map view"
                dark
                value={mode}
                onChange={(m) => (m === "3d" && no3d ? null : setMode(m))}
                options={[
                  { value: "2d", label: "2D" },
                  { value: "3d", label: "3D" },
                ]}
              />
              {mode === "2d" && (
                <button onClick={nearMe} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-soft px-4 text-[15px] font-bold hover:brightness-95">
                  <Icon name="locate" className="size-5" />
                  Near me
                </button>
              )}
            </div>
          </div>
          <div className="relative h-[60vh] min-h-[420px]">
            {no3d && mode === "2d" && (
              <p className="absolute left-4 top-4 z-10 flex max-w-xs items-start gap-2 rounded-xl border border-line bg-white px-3 py-2 text-sm shadow-1">
                <Icon name="info" className="mt-0.5 size-4 shrink-0" /> This device can't show the 3D map. You're seeing the 2D map instead. All numbers and lists still work.
              </p>
            )}
            <Suspense fallback={<Skeleton className="size-full rounded-none" />}>
              <MapView
                ref={ctl}
                points={points.data}
                grid={grid.data}
                hotspots={hotspots.data?.filter((h) => !f.category || h.category.code === f.category)}
                mode={mode}
                layers={layers}
                weightSeverity={weight}
                until={until}
                focus={focus}
                gridLabel={`${ward ? ward.name_en + ", " : ""}one 250 m square`}
                onOpenReport={setOpen}
                onFallback={() => {
                  setNo3d(true);
                  setMode("2d");
                }}
              />
            </Suspense>
            <MapControls mode={mode} api={ctl} />
            {liveTag && (
              <span className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-ink px-3 py-1.5 text-[13px] font-bold text-white shadow-2">
                <span className="relative size-2.5">
                  <span className="cp-ripple absolute inset-0 rounded-full bg-line" />
                  <span className="absolute inset-0 rounded-full bg-line" />
                </span>
                {liveTag}
              </span>
            )}
            <div className="absolute bottom-4 left-4 z-10 max-w-[300px] rounded-xl border border-line/80 bg-white/95 p-3.5 text-sm shadow-1">
              {mode === "2d" ? (
                <>
                  <p className="font-bold">Legend</p>
                  <ul className="mt-2 space-y-1.5">
                    <li className="flex items-center gap-2">
                      <span className="flex h-2.5 w-24 overflow-hidden rounded-sm">
                        <span className="flex-1 bg-line" />
                        <span className="flex-1 bg-primary" />
                        <span className="flex-1 bg-ink" />
                      </span>
                      Density of reports
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="h-3.5 w-5 rounded-sm border-2 border-dashed border-warn" /> Hotspot area (last 30 days)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="size-3.5 rounded-full bg-ink" /> Cluster (number of reports)
                    </li>
                  </ul>
                  <p className="mt-2 text-primary">Not proof of a problem. Open a report to see its evidence.</p>
                </>
              ) : (
                <>
                  <p className="font-bold">How to read this</p>
                  <p className="mt-1">Each column is one 250 m square. Taller and darker means more credible reports.</p>
                  <p className="mt-2 flex items-center gap-1.5">
                    {COLUMN_STEPS.map(([, c]) => (
                      <span key={c} className="h-3 w-6 rounded-sm" style={{ background: c }} />
                    ))}
                    <span className="num ml-1">1 to 11+</span>
                  </p>
                  <p className="mt-2 text-primary">Hotspot outlines show in the 2D view.</p>
                </>
              )}
            </div>
          </div>
          {mode === "2d" && (
            <div className="flex flex-wrap items-center gap-4 border-t border-line/70 px-4 py-3">
              <button onClick={togglePlay} aria-pressed={playing} aria-label={playing ? "Stop the time-lapse" : "Play the time-lapse"} className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-white hover:brightness-90">
                <Icon name={playing ? "pause" : "play"} className="size-5" />
              </button>
              <label className="min-w-48 flex-1">
                <span className="block text-[15px] font-bold">Time-lapse, week by week</span>
                <input
                  type="range"
                  min={range.start}
                  max={range.end}
                  step={7 * DAY}
                  value={until ?? range.end}
                  onChange={(e) => setUntil(Number(e.target.value) >= range.end - DAY ? null : Number(e.target.value))}
                  className="mt-1.5 w-full max-w-xl accent-[var(--primary)]"
                  aria-valuetext={`Up to ${fmtDate(weekOf.toISOString())}`}
                />
              </label>
              <p className="num text-sm text-primary">
                Week of {fmtDate(new Date(weekOf.getTime() - 6 * DAY).toISOString())}. Data updated {fmtTime(new Date().toISOString())}
              </p>
            </div>
          )}
        </section>

        {/* Side column */}
        <aside className="space-y-8">
          <section>
            <SideHead>Top hotspots</SideHead>
            {hotspots.loading && <Skeleton className="mt-3 h-40" />}
            {hotspots.data && hs.length === 0 && <p className="mt-3 text-[15px] text-ink/80">No hotspots: a hotspot needs 3 credible reports from at least 2 people close together.</p>}
            <ol className="mt-1">
              {hs.map((h, i) => (
                <li key={h.id} className="flex items-center gap-3 border-b border-line/70 py-3">
                  <span className="num w-4 font-bold">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">
                      {h.category.name_en}
                      {h.ward ? `, ${h.ward.name_en}` : ""}
                    </span>
                    <span className="block text-sm text-primary">
                      {h.n_reports} reports from {h.n_users} people
                    </span>
                  </span>
                  <span className="num text-2xl font-extrabold">{Math.round(h.score)}</span>
                  <button onClick={() => setFocus({ lat: h.lat, lon: h.lon, zoom: 16, k: Date.now() })} className="grid size-11 place-items-center rounded-xl border border-line hover:bg-soft/40" aria-label={`Show hotspot ${i + 1} on the map`}>
                    <Icon name="arrowRight" className="size-5" />
                  </button>
                </li>
              ))}
            </ol>
          </section>
          <section>
            <SideHead>Emerging issues</SideHead>
            {alerts.data && alerts.data.length === 0 && <p className="mt-3 text-[15px] text-ink/80">No unusual rise in any ward in the last 14 days.</p>}
            <div className="mt-3 space-y-2">
              {(alerts.data || []).slice(0, 2).map((a) => (
                <p key={a.id} className="flex gap-2.5 rounded-r-xl border-l-4 border-warn bg-warn-soft px-3.5 py-3 text-[15px] leading-relaxed">
                  <Icon name="trend" className="mt-1 size-4 shrink-0 text-warn" />
                  <span>
                    Unusual rise in <b>{a.category.name_en}</b> reports in {a.ward.name_en} on {fmtShort(a.test_date)}: <b className="num">{a.observed}</b> against about <b className="num">{a.expected ?? "—"}</b> a day.
                  </span>
                </p>
              ))}
            </div>
            <p className="mt-2 text-sm text-primary">Checked every night against the last 28 days.</p>
          </section>
          <section>
            <SideHead>By category</SideHead>
            <div className="mt-3">{s ? catRows.length ? <HBars rows={catRows} /> : <p className="text-[15px] text-ink/80">No reports in view.</p> : <Skeleton className="h-36" />}</div>
          </section>
        </aside>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <section>
          <SideHead>{f.status === "credible" ? "Credible reports per day" : "Reports per day"}</SideHead>
          <div className="mt-4">{s ? <DayBars data={s.trend.slice(-Math.min(s.trend.length, f.period === "year" ? 60 : 31))} /> : <Skeleton className="h-40" />}</div>
        </section>
        <section>
          <SideHead>Ward comparison</SideHead>
          {s && s.wards.length === 0 && <p className="mt-3 text-[15px] text-ink/80">No credible reports in this window yet.</p>}
          {s && s.wards.length > 0 && (
            <table className="mt-3 w-full text-[15px]">
              <thead>
                <tr className="border-b border-line text-left text-sm text-primary">
                  <th className="py-2 font-bold">Ward</th>
                  <th className="py-2 font-bold">Credible reports</th>
                  <th className="py-2 font-bold">Resolved</th>
                  <th className="py-2 font-bold">Top category</th>
                </tr>
              </thead>
              <tbody>
                {s.wards.map((w) => (
                  <tr key={w.ward.id} className="border-b border-line/60">
                    <td className="py-2.5">{w.ward.name_en}</td>
                    <td className="num py-2.5 font-bold">{w.credible}</td>
                    <td className="num py-2.5">{w.resolved_share_display}%</td>
                    <td className="py-2.5">{w.top_category}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      <ReportDialog id={open} onClose={() => setOpen(null)} />
    </Shell>
  );
}

