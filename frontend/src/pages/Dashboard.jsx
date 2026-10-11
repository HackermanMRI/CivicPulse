// Green Guard dashboard (W7, B4, B6): KPIs, 2D/3D map, hotspots, emerging-issue alerts, trend, time-lapse.
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Bars, HBars } from "../components/charts.jsx";
import { ReportDialog } from "../components/Report.jsx";
import { Shell } from "../components/Shell.jsx";
import { Button, Card, ErrorState, PageTitle, Score, Skeleton, Tabs, cx, inputCls } from "../components/ui.jsx";
import { api } from "../lib/api.js";
import { fmtDate, fmtShort } from "../lib/format.js";
import { useApp, useData } from "../lib/store.jsx";

const MapView = lazy(() => import("../components/MapView.jsx"));
const BAND = { high: "bg-st-low", medium: "bg-warn", low: "bg-st-cred" };

export default function Dashboard() {
  const { live } = useApp();
  const [days, setDays] = useState(30);
  const [category, setCategory] = useState("");
  const [mode, setMode] = useState("2d");
  const [layer, setLayer] = useState("markers");
  const [until, setUntil] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [focus, setFocus] = useState(null);
  const [open, setOpen] = useState(null);
  const [ripple, setRipple] = useState(false);
  const timer = useRef(null);

  const cats = useData(() => api("/api/categories"), []);
  const summary = useData(() => api("/api/insights/summary", { query: { days } }), [days, live?.id]);
  const points = useData(() => api("/api/insights/map", { query: { days, category } }), [days, category, live?.id]);
  const grid = useData(() => (mode === "3d" ? api("/api/insights/grid", { query: { days, category } }) : Promise.resolve(null)), [days, category, mode]);
  const hotspots = useData(() => api("/api/insights/hotspots"), []);
  const alerts = useData(() => api("/api/insights/alerts", { query: { days: 14 } }), []);

  // Live ripple for a new report in the user's areas (B6).
  useEffect(() => {
    if (live?.kind !== "new_report_in_ward") return undefined;
    setRipple(true);
    const t = setTimeout(() => setRipple(false), 900);
    return () => clearTimeout(t);
  }, [live]);

  const range = useMemo(() => {
    const now = Date.now();
    return { start: now - days * 86400000, end: now };
  }, [days, points.data]); // eslint-disable-line react-hooks/exhaustive-deps

  function togglePlay() {
    if (playing) {
      clearInterval(timer.current);
      setPlaying(false);
      return;
    }
    setPlaying(true);
    let t = range.start;
    const step = (range.end - range.start) / 40;
    timer.current = setInterval(() => {
      t += step;
      if (t >= range.end) {
        clearInterval(timer.current);
        setPlaying(false);
        setUntil(null);
      } else setUntil(t);
    }, 120);
  }
  useEffect(() => () => clearInterval(timer.current), []);

  const s = summary.data;
  return (
    <Shell module="gg" wide>
      <PageTitle title="Dashboard" subtitle="Credible reports, hotspots and emerging issues in the pilot area." />
      {s?.includes_demo_data && (
        <p className="mb-4 rounded-md border-2 border-err/40 bg-err/5 px-3 py-2 text-sm font-medium">
          This dashboard includes synthetic DEMO data (marked DEMO). It is for demonstration only and is never used in research results.
        </p>
      )}
      <Card className={cx("mb-5 grid grid-cols-2 gap-4 p-4 sm:grid-cols-5", ripple && "ring-4 ring-primary/40 transition-shadow")}>
        {summary.loading && !s ? (
          Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-14" />)
        ) : summary.error ? (
          <div className="col-span-full">
            <ErrorState error={summary.error} onRetry={summary.reload} />
          </div>
        ) : (
          <>
            <Score label={`Reports (${days} days)`} value={s.reports} hint={`${s.reports_today} today`} />
            <Score label="Credible share" value={s.credible_share_display != null ? `${s.credible_share_display}%` : "—"} hint="Credible or highly credible" />
            <Score label="Hotspots" value={s.hotspots} />
            <Score label="Alerts (7 days)" value={s.alerts_7d} />
            <Score label="Resolved" value={s.resolved_events} hint="three “Fixed now” votes" />
          </>
        )}
      </Card>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className={cx(inputCls, "w-auto!")} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Time window">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        <select className={cx(inputCls, "w-auto!")} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {(cats.data || []).map((c) => (
            <option key={c.code} value={c.code}>
              {c.name_en}
            </option>
          ))}
        </select>
        <Tabs className="w-44" value={mode} onChange={setMode} tabs={[{ value: "2d", label: "2D" }, { value: "3d", label: "3D" }]} />
        {mode === "2d" && <Tabs className="w-56" value={layer} onChange={setLayer} tabs={[{ value: "markers", label: "Markers" }, { value: "heat", label: "Heatmap" }]} />}
        <Button kind="outline" size="sm" onClick={togglePlay} aria-pressed={playing}>
          {playing ? "Stop time-lapse" : "Play time-lapse"}
        </Button>
        {until && <span className="num text-sm font-semibold">up to {fmtDate(new Date(until).toISOString())}</span>}
      </div>
      <label className="mb-3 block">
        <span className="sr-only">Show reports up to this day</span>
        <input type="range" min={range.start} max={range.end} step={86400000} value={until ?? range.end} onChange={(e) => setUntil(Number(e.target.value) >= range.end - 86400000 ? null : Number(e.target.value))} className="w-full accent-[var(--primary)]" />
      </label>
      <div className="h-[58vh] min-h-80">
        <Suspense fallback={<Skeleton className="h-full w-full" />}>
          <MapView points={points.data} grid={grid.data} hotspots={hotspots.data} mode={mode} layer={layer} until={until} focus={focus} onOpenReport={setOpen} />
        </Suspense>
      </div>
      <p className="mt-2 text-xs text-ink/65">
        {mode === "3d" ? "3D: column height = credible reports in each 250 m cell." : "Marker colour = category. Status is shown only for reports you voted on or posted (X1)."}
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-semibold">Hotspots</h2>
          {hotspots.loading && <Skeleton className="h-32" />}
          {hotspots.data && hotspots.data.length === 0 && <p className="text-ink/70">No hotspots: a hotspot needs 3 credible reports from at least 2 people close together.</p>}
          <ul className="space-y-2">
            {(hotspots.data || []).map((h) => (
              <li key={h.id} className="flex items-center gap-3 rounded-md bg-white p-3 shadow-1">
                <span className={cx("num rounded-md px-2 py-1 text-lg font-bold text-white", BAND[h.band])}>{Math.round(h.score)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{h.category.name_en}</span>
                  <span className="text-sm text-ink/70">
                    {h.n_reports} reports · {h.n_users} people · {h.band} priority
                  </span>
                </span>
                <Button kind="ghost" size="sm" onClick={() => setFocus({ lat: h.lat, lon: h.lon, zoom: 16, k: Date.now() })}>
                  Show
                </Button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink/60">Score 0–100 = severity × trusted volume × compactness (F28). Bands are provisional (open parameter B4).</p>
        </section>
        <section>
          <h2 className="mb-3 text-lg font-semibold">Emerging issues</h2>
          {alerts.data && alerts.data.length === 0 && <p className="text-ink/70">No unusual rise in any ward in the last 14 days.</p>}
          <ul className="space-y-2">
            {(alerts.data || []).map((a) => (
              <li key={a.id} className="rounded-md bg-white p-3 shadow-1">
                <span className="block font-semibold">
                  {a.category.name_en} in {a.ward.name_en}
                </span>
                <span className="text-sm text-ink/70">
                  {fmtShort(a.test_date)}: {a.observed} credible reports, usual {a.expected}/day · p = {a.p_value.toExponential(1)} ({a.test === "c_test" ? "exact C-test" : "negative binomial"})
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="mb-3 text-lg font-semibold">Reports per day</h2>
          {s ? <Bars data={s.trend} label="Reports per day" /> : <Skeleton className="h-32" />}
        </section>
        <section>
          <h2 className="mb-3 text-lg font-semibold">By category</h2>
          {s ? <HBars rows={s.by_category.map((c) => ({ label: c.name_en, value: c.count }))} /> : <Skeleton className="h-32" />}
        </section>
      </div>
      <ReportDialog id={open} onClose={() => setOpen(null)} />
    </Shell>
  );
}
