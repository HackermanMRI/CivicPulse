// Price Patrol (boards: Price Patrol dashboard, Report a price; W6, C6, C19, P-2): today's verified prices, history
// and market comparison for one product, price alerts, your submissions, Explore Prices and the report form.
import { useEffect, useMemo, useState } from "react";
import { Camera, ensureFreshToken } from "../../components/Camera.jsx";
import { PriceChart } from "../../components/charts.jsx";
import { Icon } from "../../components/icons.jsx";
import { Shell } from "../../components/Shell.jsx";
import { Button, DemoBadge, Dialog, ErrorState, Field, FormHeader, Segmented, Select, Skeleton, StateBlock, Switch, cx, inputBase, useNow } from "../../components/ui.jsx";
import { api } from "../../lib/api.js";
import { dhakaToday, fmtLongStamp, fmtRelDay, fmtShort, fmtTime } from "../../lib/format.js";
import { getPosition } from "../../lib/geo.js";
import { Link, navigate, useRoute } from "../../lib/router.jsx";
import { useApp, useData } from "../../lib/store.jsx";

const taka = (v) => (v == null ? "—" : `৳${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

function Change({ change, withDates = true, className }) {
  if (!change) return <span className={cx("text-[15px] text-ink/70", className)}>No 7-day change yet</span>;
  const p = change.percent;
  const dates = withDates ? ` (${fmtShort(change.from_date)} → ${fmtShort(change.to_date)})` : "";
  if (Math.abs(p) < 0.05)
    return (
      <span className={cx("num text-[15px]", className)}>
        <b>● No change</b>
        {dates}
      </span>
    );
  const up = p > 0;
  return (
    <span className={cx("num text-[15px]", className)}>
      <b className={up ? "text-err" : "text-ok"}>
        {up ? "▲" : "▼"} {Math.abs(p).toFixed(1)}%
      </b>
      {dates}
    </span>
  );
}

function variantLine(c, market) {
  return [c.variant, `per ${c.unit}`, market].filter(Boolean).join(" · ");
}

function PriceCard({ card, selected, onSelect }) {
  const verified = card.today.status === "Verified" || Boolean(card.latest);
  const insufficient = !card.latest;
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      className={cx(
        "flex min-h-[200px] w-[230px] shrink-0 flex-col rounded-2xl border-[1.5px] bg-white p-4 text-left transition-colors duration-150 lg:w-auto",
        insufficient ? "border-dashed border-line" : selected ? "border-primary" : "border-line/80 hover:border-primary/60",
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="display text-[17px]">{card.commodity.name_en}</span>
        {verified && !insufficient ? (
          <span className="rounded-full bg-soft px-2.5 py-0.5 text-[13px] font-bold text-primary">Verified</span>
        ) : (
          <span className="shrink-0 whitespace-nowrap rounded-full bg-warn-soft px-2 py-0.5 text-[12px] font-bold text-warn-ink">Insufficient evidence</span>
        )}
      </span>
      <span className="mt-1.5 text-sm text-primary">{variantLine(card.commodity, card.market?.name_en)}</span>
      {insufficient ? (
        <>
          <span className="num mt-3 text-[30px] font-extrabold leading-9 text-line">৳ —</span>
          <span className="mt-2 text-[15px] leading-snug">
            Only {card.today.report_count} credible report{card.today.report_count === 1 ? "" : "s"} today. A verified price needs at least 3.
          </span>
          <Link to={`/pp/explore?commodity=${card.commodity.id}&market=${card.market?.id ?? ""}`} className="mt-auto pt-2 font-bold underline underline-offset-4" onClick={(e) => e.stopPropagation()}>
            See the reports
          </Link>
        </>
      ) : (
        <>
          <span className="num mt-3 text-[30px] font-extrabold leading-9">{taka(card.latest.verified_price)}</span>
          <Change change={card.change_7d} className="mt-2" />
          <span className="mt-auto pt-2 text-sm text-primary">
            {card.latest.report_count ? `From ${card.latest.report_count} reports` : `Verified ${fmtShort(card.latest.date)}`}
            {card.latest.date !== dhakaToday() && card.latest.report_count ? ` · ${fmtShort(card.latest.date)}` : ""}
          </span>
        </>
      )}
    </button>
  );
}

function PanelCard({ title, sub, action, children, className }) {
  return (
    <section className={cx("min-w-0 rounded-2xl border border-line/80 bg-white p-5", className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2>
          <span className="display text-lg">{title}</span>
          {sub && <span className="ml-3 text-sm text-primary">{sub}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function History({ card, days, setDays }) {
  const marketId = card.market?.id;
  const hist = useData(() => (marketId ? api("/api/prices/history", { query: { commodity_id: card.commodity.id, market_id: marketId, days } }) : Promise.resolve(null)), [card.commodity.id, marketId, days]);
  const ch = hist.data?.change_7d;
  return (
    <PanelCard
      title={`${card.commodity.name_en} · price history`}
      sub={card.market?.name_en}
      action={
        <Segmented
          label="History length"
          value={days}
          onChange={setDays}
          options={[
            { value: 30, label: "30 days" },
            { value: 90, label: "90 days" },
          ]}
        />
      }
    >
      {hist.loading && <Skeleton className="h-60" />}
      {hist.error && <ErrorState error={hist.error} onRetry={hist.reload} title="Couldn't load the history" />}
      {hist.data && <PriceChart points={hist.data.points} reference={hist.data.reference} alertDate={ch?.alert ? ch.to_date : null} alertLabel={ch ? `${ch.percent > 0 ? "Rise" : "Drop"} alert ${fmtShort(ch.to_date)}` : ""} />}
    </PanelCard>
  );
}

function Compare({ card }) {
  const cmp = useData(() => api("/api/prices/compare", { query: { commodity_id: card.commodity.id } }), [card.commodity.id]);
  const rows = cmp.data?.markets || [];
  const priced = rows.filter((m) => m.latest);
  const cheapest = priced.length > 1 ? priced.reduce((a, b) => (b.latest.verified_price < a.latest.verified_price ? b : a)).market.id : null;
  return (
    <PanelCard title={`${card.commodity.name_en} · compare markets`}>
      {cmp.loading && <Skeleton className="h-48" />}
      {cmp.error && <ErrorState error={cmp.error} onRetry={cmp.reload} title="Couldn't compare markets" />}
      {cmp.data && (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[440px] text-[15px]">
            <thead>
              <tr className="border-b border-line text-left text-sm text-primary">
                <th className="px-2 py-2 font-bold">Market</th>
                <th className="px-2 py-2 font-bold">Verified price</th>
                <th className="px-2 py-2 font-bold">7-day change</th>
                <th className="px-2 py-2 font-bold">Reports</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.market.id} className={cx("border-b border-line/60", m.market.id === cheapest && "bg-bg")}>
                  <td className="px-2 py-3 font-bold">
                    {m.market.name_en}
                    {m.market.id === cheapest && <span className="ml-2 rounded-full bg-soft px-2 py-0.5 text-[12px] font-bold text-primary">Cheapest</span>}
                  </td>
                  <td className="num px-2 py-3">{m.latest ? taka(m.latest.verified_price) : <span className="text-warn-ink">Not enough reports</span>}</td>
                  <td className="px-2 py-3">{m.latest ? <Change change={m.change_7d} withDates={false} /> : "—"}</td>
                  <td className="num px-2 py-3">{m.report_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-sm text-ink/75">Verified price = median of recent credible reports after removing outliers.</p>
    </PanelCard>
  );
}

function WatchDialog({ open, onClose }) {
  const { toast } = useApp();
  const data = useData(() => (open ? Promise.all([api("/api/commodities"), api("/api/me/price-watch")]) : Promise.resolve(null)), [open]);
  const [watched, setWatched] = useState(new Set());
  useEffect(() => {
    if (data.data) setWatched(new Set(data.data[1]));
  }, [data.data]);
  async function toggle(id) {
    const on = watched.has(id);
    try {
      await api(`/api/me/price-watch/${id}`, { method: on ? "DELETE" : "PUT" });
      const next = new Set(watched);
      on ? next.delete(id) : next.add(id);
      setWatched(next);
    } catch (e) {
      toast(e.message, "error");
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Choose products to watch">
      <p className="text-[15px] text-ink/85">You get an alert when the verified price of a watched product moves 10% or more in 7 days.</p>
      {!data.data ? (
        <Skeleton className="mt-4 h-24" />
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {data.data[0].map((c) => (
            <button key={c.id} onClick={() => toggle(c.id)} aria-pressed={watched.has(c.id)} className={cx("min-h-11 rounded-full border-[1.5px] px-4 text-[15px] font-bold", watched.has(c.id) ? "border-primary bg-primary text-white" : "border-line bg-white")}>
              {watched.has(c.id) && <Icon name="check" className="-ml-1 mr-1 inline size-4" strokeWidth={3} />}
              {c.name_en} · {c.variant}
            </button>
          ))}
        </div>
      )}
    </Dialog>
  );
}

function countsLabel(p, flags) {
  if (p.counts_toward_verified) return <b className="text-ok">✓ Yes</b>;
  if ((flags || []).some((f) => f.code === "price_outlier")) return <b className="text-err">✕ No · far from others</b>;
  if (p.verified_price == null) return <b className="text-warn-ink">Not yet · needs 3 reports</b>;
  return <b className="text-err">✕ No</b>;
}

export function PriceDashboard() {
  const markets = useData(() => api("/api/markets"), []);
  const [market, setMarket] = useState("");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  const [days, setDays] = useState(30);
  const [watch, setWatch] = useState(false);
  const dash = useData(() => api("/api/prices/dashboard", { query: { market_id: market || undefined } }), [market]);
  const alerts = useData(() => api("/api/prices/alerts"), []);
  const mine = useData(() => api("/api/me/reports", { query: { type: "price", limit: 5 } }), []);

  const cards = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (dash.data?.cards || []).filter((c) => !needle || `${c.commodity.name_en} ${c.commodity.name_bn} ${c.commodity.variant}`.toLowerCase().includes(needle));
  }, [dash.data, q]);
  const selected = cards.find((c) => c.commodity.id === sel) || cards.find((c) => c.change_7d?.alert) || cards.find((c) => c.latest) || cards[0];

  return (
    <Shell module="pp" wide>
      <div className="flex flex-col gap-3 md:flex-row">
        <label className="relative block flex-1">
          <span className="sr-only">Search a product</span>
          <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink/80" />
          <input className={cx(inputBase, "min-h-[52px] py-2.5 pl-12 text-[17px]")} type="search" placeholder="Search a product: rice, onion, egg, soybean oil…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <Select className="md:w-64" value={market} onChange={(e) => setMarket(e.target.value)} aria-label="Market">
          <option value="">All markets</option>
          {(markets.data || []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name_en}
              {m.is_demo ? " (DEMO)" : ""}
            </option>
          ))}
        </Select>
        <Button icon="plus" className="hidden md:inline-flex" onClick={() => navigate("/pp/report")}>
          Report a price
        </Button>
      </div>

      <h1 className="mt-6 flex flex-wrap items-baseline gap-x-3">
        <span className="display text-xl">Today's verified prices</span>
        <span className="text-sm text-primary">Change shown over the last 7 days · Updated {fmtTime(new Date().toISOString())}</span>
      </h1>
      {dash.loading && (
        <div className="mt-3 flex gap-3 overflow-hidden lg:grid lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-[200px] w-[230px] shrink-0 rounded-2xl lg:w-auto" />
          ))}
        </div>
      )}
      {dash.error && <ErrorState error={dash.error} onRetry={dash.reload} title="Couldn't load prices" />}
      {dash.data && cards.length === 0 && (
        <StateBlock icon="tag" title={q ? "No product matches" : "No products yet"}>
          {q ? "Try another name, for example rice or onion." : "The team adds products and markets before the pilot."}
        </StateBlock>
      )}
      {cards.length > 0 && (
        <div className="-mx-4 mt-3 flex snap-x gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0">
          {cards.map((c) => (
            <PriceCard key={c.commodity.id} card={c} selected={selected?.commodity.id === c.commodity.id} onSelect={() => setSel(c.commodity.id)} />
          ))}
        </div>
      )}

      {selected && (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <History card={selected} days={days} setDays={setDays} />
          <Compare card={selected} />
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <PanelCard title="Price alerts" sub="Alert when the verified price moves ±10% in 7 days">
          {alerts.loading && <Skeleton className="h-28" />}
          {alerts.data && alerts.data.length === 0 && <p className="text-[15px] text-ink/80">No product moved 10% or more this week.</p>}
          <ul className="space-y-3">
            {(alerts.data || []).slice(0, 4).map((a, i) => {
              const up = a.change_7d.percent > 0;
              const ch = a.change_7d;
              return (
                <li key={i} className={cx("flex items-center gap-4 rounded-xl px-4 py-3.5", up ? "bg-err-soft" : "bg-ok-soft")}>
                  <span className={cx("text-2xl leading-none", up ? "text-err" : "text-ok")} aria-hidden>
                    {up ? "▲" : "▼"}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[16px]">
                      <b>{a.commodity.name_en}</b> {up ? "rose" : "dropped"} <b className="num">{Math.abs(ch.percent).toFixed(1)}%</b> at {a.market.name_en}
                      {a.watched && <span className="ml-2 text-sm font-bold text-primary">· watching</span>}
                    </span>
                    <span className="num block text-sm text-ink/80">
                      {taka(ch.from_price)} on {fmtShort(ch.from_date)} → {taka(ch.to_price)} on {fmtShort(ch.to_date)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <button onClick={() => setWatch(true)} className="mt-4 min-h-11 font-bold underline underline-offset-4">
            Choose products to watch
          </button>
        </PanelCard>
        <PanelCard title="Your submissions">
          {mine.loading && <Skeleton className="h-28" />}
          {mine.data && mine.data.length === 0 && <p className="text-[15px] text-ink/80">Prices you report show up here, with whether they count toward the verified price.</p>}
          {mine.data && mine.data.length > 0 && (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[480px] text-[15px]">
                <thead>
                  <tr className="text-left text-sm text-primary">
                    <th className="px-2 py-1.5 font-bold">Product · market</th>
                    <th className="px-2 py-1.5 font-bold">Price</th>
                    <th className="px-2 py-1.5 font-bold">When</th>
                    <th className="px-2 py-1.5 font-bold">Counts toward verified price</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.data.map((r) => (
                    <tr key={r.id}>
                      <td className="px-2 py-2 font-bold">
                        {r.price.commodity.name_en} · {r.price.market.name_en} {r.is_seed && <DemoBadge />}
                      </td>
                      <td className="num px-2 py-2">{taka(r.price.price_bdt)}</td>
                      <td className="px-2 py-2">{fmtRelDay(r.submitted_at)}</td>
                      <td className="px-2 py-2">{countsLabel(r.price, r.results?.flags)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-sm text-ink/75">A price far from what others reported is kept but not counted.</p>
        </PanelCard>
      </div>
      <WatchDialog open={watch} onClose={() => setWatch(false)} />
    </Shell>
  );
}

// ---------- Explore Prices (built from the same parts) ----------

export function Explore() {
  const { query } = useRoute();
  const markets = useData(() => api("/api/markets"), []);
  const coms = useData(() => api("/api/commodities"), []);
  const [market, setMarket] = useState(query.get("market") || "");
  const [com, setCom] = useState(query.get("commodity") || "");
  const [days, setDays] = useState(30);
  useEffect(() => {
    if (!market && markets.data?.length) setMarket(String(markets.data[0].id));
    if (!com && coms.data?.length) setCom(String(coms.data[0].id));
  }, [markets.data, coms.data, market, com]);
  const c = (coms.data || []).find((x) => String(x.id) === String(com));
  const m = (markets.data || []).find((x) => String(x.id) === String(market));
  const raw = useData(() => (c && m ? api("/api/prices/reports", { query: { commodity_id: c.id, market_id: m.id } }) : Promise.resolve(null)), [c?.id, m?.id]);
  return (
    <Shell module="pp" wide title="Explore Prices">
      <h1 className="display text-[28px]">Explore prices</h1>
      <p className="mt-1 text-[15px] text-primary">Every report from the last 7 days, and the verified price over time.</p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <Select className="sm:w-80" value={com} onChange={(e) => setCom(e.target.value)} aria-label="Product">
          {(coms.data || []).map((x) => (
            <option key={x.id} value={x.id}>
              {x.name_en} · {x.variant} · per {x.unit}
            </option>
          ))}
        </Select>
        <Select className="sm:w-72" value={market} onChange={(e) => setMarket(e.target.value)} aria-label="Market">
          {(markets.data || []).map((x) => (
            <option key={x.id} value={x.id}>
              {x.name_en}
              {x.is_demo ? " (DEMO)" : ""}
            </option>
          ))}
        </Select>
      </div>
      {c && m ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-[3fr_2fr]">
          <History card={{ commodity: c, market: m }} days={days} setDays={setDays} />
          <PanelCard title="Reports in the last 7 days">
            {raw.loading && <Skeleton className="h-40" />}
            {raw.data && raw.data.length === 0 && <p className="text-[15px] text-ink/80">No reports yet for this product here.</p>}
            <ul className="divide-y divide-line/60">
              {(raw.data || []).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <span className="num w-20 text-[17px] font-extrabold">{taka(r.price_bdt)}</span>
                  <span className="text-sm text-ink/80">{fmtRelDay(r.observed_at)}</span>
                  {r.outlier && <span className="rounded-full bg-warn-soft px-2.5 py-0.5 text-[13px] font-bold text-warn-ink">Unusual price</span>}
                  {r.counts_toward_verified && <span className="text-sm font-bold text-ok">✓ in verified price</span>}
                  {r.is_mine && <span className="rounded-full bg-soft px-2 py-0.5 text-[13px] font-bold">Yours</span>}
                  {r.is_seed && <DemoBadge />}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-ink/75">Reports older than 7 days are not listed (C19). Unusual prices are flagged, never deleted.</p>
          </PanelCard>
        </div>
      ) : (
        <Skeleton className="mt-5 h-64" />
      )}
    </Shell>
  );
}

// ---------- Report a price ----------

function dayOptions() {
  const out = [];
  for (let i = 0; i <= 7; i++) {
    const d = new Date(Date.now() - i * 86400000);
    const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(d);
    const label = i === 0 ? `Today, ${fmtShort(d.toISOString())}` : i === 1 ? `Yesterday, ${fmtShort(d.toISOString())}` : new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", weekday: "short", day: "numeric", month: "short" }).format(d);
    out.push([iso, label]);
  }
  return out;
}

function timeOptions(day) {
  const now = new Date();
  const nowHm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const out = [];
  for (let h = 0; h < 24; h++)
    for (const mm of [0, 30]) {
      const hm = `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
      if (day === dhakaToday() && hm > nowHm) continue; // never in the future (C6)
      const label = `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
      out.push([hm, label]);
    }
  return out;
}

function PhotoTile({ icon, title, sub, shot, onTake, onClear }) {
  if (shot)
    return (
      <div className="relative overflow-hidden rounded-2xl border border-line">
        <img src={shot.url} alt={title} className="aspect-[4/3] w-full object-cover" />
        <button type="button" onClick={onClear} className="absolute right-2 top-2 grid size-10 place-items-center rounded-full bg-white/95 shadow-1" aria-label={`Remove ${title.toLowerCase()}`}>
          <Icon name="x" className="size-5" />
        </button>
        <span className="absolute bottom-2 left-2 rounded-full bg-ink/85 px-2.5 py-0.5 text-[13px] font-bold text-white">{title}</span>
      </div>
    );
  return (
    <button type="button" onClick={onTake} className="flex min-h-[112px] flex-col items-center justify-center gap-1 rounded-2xl border-[1.5px] border-dashed border-line bg-white px-3 text-center hover:bg-soft/20">
      <Icon name={icon} className="size-6" />
      <span className="font-bold">{title}</span>
      <span className="text-[13px] text-ink/75">{sub}</span>
    </button>
  );
}

export function PriceReport() {
  const { user } = useApp();
  const now = useNow();
  const markets = useData(() => api("/api/markets"), []);
  const coms = useData(() => api("/api/commodities"), []);
  const [name, setName] = useState("");
  const [com, setCom] = useState("");
  const [market, setMarket] = useState("");
  const [price, setPrice] = useState("");
  const [day, setDay] = useState(dhakaToday());
  const [clock, setClock] = useState("");
  const [useGps, setUseGps] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [camera, setCamera] = useState(null); // "photo" | "receipt"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const visibleMarkets = (markets.data || []).filter((m) => m.is_demo === Boolean(user?.is_seed));
  const names = [...new Set((coms.data || []).map((c) => c.name_en))];
  const variants = (coms.data || []).filter((c) => c.name_en === name);
  const chosen = (coms.data || []).find((c) => String(c.id) === String(com));
  const times = timeOptions(day);
  useEffect(() => {
    if (!times.some(([v]) => v === clock)) setClock(times.at(-1)?.[0] || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let pos = null;
      if (useGps) pos = await getPosition().catch(() => null); // GPS is optional for prices (C6)
      const shot = photo || receipt;
      const token = shot ? await ensureFreshToken(shot) : null;
      await api("/api/reports/price", {
        method: "POST",
        form: {
          commodity_id: com, market_id: market, price_bdt: price, observed_at: `${day}T${clock}:00+06:00`,
          lat: pos?.lat, lon: pos?.lon, accuracy: pos?.accuracy, capture_token: token, photo: photo?.blob, receipt: receipt?.blob,
        },
      });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <Shell module="pp" title="Report a price">
        <div className="flex flex-col items-center gap-6 py-14 text-center">
          <span className="cp-pulse relative grid size-28 place-items-center rounded-full bg-primary text-white">
            <Icon name="tag" className="size-12" />
          </span>
          <h1 className="display text-[28px]">Price posted</h1>
          <p className="max-w-sm text-[17px] leading-relaxed">It counts toward the verified price once it is credible and at least 3 people reported this product here that day.</p>
          <div className="flex w-full max-w-sm flex-col gap-3">
            <Button onClick={() => navigate("/pp")}>See today's prices</Button>
            <Button
              kind="outline"
              onClick={() => {
                setDone(false);
                setPrice("");
                setPhoto(null);
                setReceipt(null);
              }}
            >
              Report another price
            </Button>
          </div>
        </div>
      </Shell>
    );

  if (camera)
    return (
      <Shell module="pp" bare>
        <FormHeader title={camera === "photo" ? "Photo of the product" : "Photo of the receipt"} onClose={() => setCamera(null)} />
        <div className="mt-4">
          <Camera
            purpose="price_photo"
            onShot={(s) => {
              camera === "photo" ? setPhoto(s) : setReceipt(s);
              setCamera(null);
            }}
            onCancel={() => setCamera(null)}
          />
        </div>
      </Shell>
    );

  return (
    <Shell module="pp" bare>
      <FormHeader title="Report a price you saw" note="A price can't be edited after you post it." onClose={() => navigate("/pp")} stamp={fmtLongStamp(now.toISOString())} />
      <form onSubmit={submit} className="mt-5 space-y-5">
        <Field label="Product" id="prod">
          <Select
            id="prod"
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              const first = (coms.data || []).find((c) => c.name_en === e.target.value);
              setCom(first ? String(first.id) : "");
            }}
          >
            <option value="" disabled>
              Choose a product
            </option>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        {variants.length > 0 && (
          <div>
            <p className="text-[15px] font-bold">Variant</p>
            <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Variant">
              {variants.map((v) => (
                <button key={v.id} type="button" role="radio" aria-checked={String(v.id) === String(com)} onClick={() => setCom(String(v.id))} className={cx("min-h-12 rounded-full border-[1.5px] px-5 text-base font-bold capitalize", String(v.id) === String(com) ? "border-primary bg-primary text-white" : "border-ink/70 bg-white")}>
                  {v.variant}
                </button>
              ))}
            </div>
          </div>
        )}
        <Field label="Market" id="mkt" hint="The market sets the location. No GPS needed.">
          <Select id="mkt" required value={market} onChange={(e) => setMarket(e.target.value)}>
            <option value="" disabled>
              Choose a market
            </option>
            {visibleMarkets.map((m) => (
              <option key={m.id} value={m.id}>
                {[m.name_en, m.ward_name_en].filter(Boolean).join(", ")}
              </option>
            ))}
          </Select>
        </Field>
        {markets.data && visibleMarkets.length === 0 && <p className="text-sm text-warn-ink">No markets are open for your account yet.</p>}
        <Field label="Price" id="price">
          <div className="flex min-h-[64px] items-center gap-3 rounded-xl border-2 border-ink bg-white px-4 focus-within:ring-2 focus-within:ring-ink/30">
            <span className="num text-[28px] font-extrabold">৳</span>
            <input id="price" className="num min-w-0 flex-1 bg-transparent text-[30px] font-extrabold focus:outline-none" inputMode="decimal" pattern="\d+(\.\d{1,2})?" placeholder="0" required value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} />
            <span className="shrink-0 text-[15px] font-bold text-ink/80">{chosen ? `per ${chosen.unit}` : ""}</span>
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date seen" id="day">
            <Select id="day" value={day} onChange={(e) => setDay(e.target.value)}>
              {dayOptions().map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Time seen" id="time">
            <Select id="time" value={clock} onChange={(e) => setClock(e.target.value)}>
              {times.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="-mt-2 text-sm text-ink/80">You can pick a time from the last 7 days. Future times are not allowed.</p>
        <Switch id="gps" checked={useGps} onChange={setUseGps} label="Add my GPS location" sub="Optional" />
        <div>
          <p className="text-[15px] font-bold">Photos (optional)</p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <PhotoTile icon="camera" title="Product photo" sub="In-app camera" shot={photo} onTake={() => setCamera("photo")} onClear={() => setPhoto(null)} />
            <PhotoTile icon="receipt" title="Receipt" sub="Stored, not checked" shot={receipt} onTake={() => setCamera("receipt")} onClear={() => setReceipt(null)} />
          </div>
        </div>
        <p className="text-sm text-ink/80">One price per product, market and day.</p>
        {error && (
          <p role="alert" className="flex items-start gap-1.5 font-medium text-err">
            <Icon name="alert" className="mt-0.5 size-5 shrink-0" />
            {error}
          </p>
        )}
        <Button size="lg" className="w-full" busy={busy} busyLabel="Posting…" disabled={!com || !market || !price || !clock}>
          Post price
        </Button>
      </form>
    </Shell>
  );
}

