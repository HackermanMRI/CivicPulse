// Price Patrol: dashboard, product history and market comparison, explore raw prices, report a price (W6, C6, C19).
import { useEffect, useState } from "react";
import { Camera, ensureFreshToken } from "../../components/Camera.jsx";
import { PriceChart, Sparkline } from "../../components/charts.jsx";
import { Shell } from "../../components/Shell.jsx";
import { Button, Card, DemoBadge, Dialog, Empty, ErrorState, Field, PageTitle, Skeleton, StatusChip, cx, inputCls } from "../../components/ui.jsx";
import { api } from "../../lib/api.js";
import { bdt, dhakaToday, fmtDate, fmtShort, fmtTime } from "../../lib/format.js";
import { getPosition } from "../../lib/geo.js";
import { navigate } from "../../lib/router.jsx";
import { useApp, useData } from "../../lib/store.jsx";

function Change({ change }) {
  if (!change) return <span className="text-sm text-ink/55">no 7-day change yet</span>;
  const up = change.percent > 0;
  const cls = change.alert ? (up ? "text-err" : "text-ok") : "text-ink/70";
  return (
    <span className={cx("num text-sm font-semibold", cls)} title={`${fmtShort(change.from_date)} ${bdt(change.from_price)} → ${fmtShort(change.to_date)} ${bdt(change.to_price)}`}>
      {up ? "▲" : change.percent < 0 ? "▼" : "•"} {Math.abs(change.percent).toFixed(1)}% in 7 days
    </span>
  );
}

function useMarkets() {
  return useData(() => api("/api/markets"), []);
}

function MarketSelect({ markets, value, onChange }) {
  return (
    <select className={cx(inputCls, "sm:w-80")} value={value || ""} onChange={(e) => onChange(Number(e.target.value))} aria-label="Market">
      {(markets || []).map((m) => (
        <option key={m.id} value={m.id}>
          {m.name_en} · {m.name_bn}
        </option>
      ))}
    </select>
  );
}

function ProductPanel({ commodity, market, onClose }) {
  const hist = useData(() => api("/api/prices/history", { query: { commodity_id: commodity.id, market_id: market, days: 30 } }), [commodity.id, market]);
  const cmp = useData(() => api("/api/prices/compare", { query: { commodity_id: commodity.id } }), [commodity.id]);
  const raw = useData(() => api("/api/prices/reports", { query: { commodity_id: commodity.id, market_id: market } }), [commodity.id, market]);
  return (
    <Dialog open onClose={onClose} title={`${commodity.name_en} (${commodity.variant}) per ${commodity.unit}`} wide>
      <div className="space-y-6 p-5">
        {hist.loading && <Skeleton className="h-56" />}
        {hist.error && <ErrorState error={hist.error} onRetry={hist.reload} />}
        {hist.data && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold">Last 30 days at {hist.data.market.name_en}</h3>
              <Change change={hist.data.change_7d} />
            </div>
            <PriceChart points={hist.data.points} reference={hist.data.reference} />
          </section>
        )}
        <section>
          <h3 className="mb-2 font-semibold">Compare markets</h3>
          {cmp.data && (
            <ul className="divide-y divide-line/50 rounded-md border border-line/60 bg-white">
              {cmp.data.markets.map((m) => (
                <li key={m.market.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>{m.market.name_en}</span>
                  <span className="text-right">
                    <span className="num block font-semibold">{m.latest ? bdt(m.latest.verified_price) : "No verified price"}</span>
                    {m.latest && <span className="text-xs text-ink/60">{fmtShort(m.latest.date)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3 className="mb-2 font-semibold">Reports in the last 7 days</h3>
          {raw.data && raw.data.length === 0 && <p className="text-ink/70">No reports in the last 7 days.</p>}
          {raw.data && raw.data.length > 0 && (
            <ul className="divide-y divide-line/50 rounded-md border border-line/60 bg-white">
              {raw.data.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="num w-20 font-semibold">{bdt(r.price_bdt)}</span>
                  <span className="text-sm text-ink/70">
                    {fmtShort(r.observed_at)}, {fmtTime(r.observed_at)}
                  </span>
                  <StatusChip status={r.status} />
                  {r.outlier && <span className="rounded-full bg-warn px-2 text-sm font-medium text-white">Unusual price</span>}
                  {r.counts_toward_verified && <span className="text-sm font-medium text-ok">in verified price</span>}
                  {r.is_seed && <DemoBadge />}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-ink/60">Reports older than 7 days are not listed (C19). Outliers are flagged, never deleted.</p>
        </section>
      </div>
    </Dialog>
  );
}

export function PriceDashboard() {
  const { toast } = useApp();
  const markets = useMarkets();
  const [market, setMarket] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    if (!market && markets.data?.length) setMarket(markets.data[0].id);
  }, [markets.data, market]);
  const dash = useData(() => (market ? api("/api/prices/dashboard", { query: { market_id: market } }) : Promise.resolve(null)), [market]);
  const alerts = useData(() => api("/api/prices/alerts"), []);

  async function watch(card) {
    try {
      await api(`/api/me/price-watch/${card.commodity.id}`, { method: card.watched ? "DELETE" : "PUT" });
      dash.setData({ ...dash.data, cards: dash.data.cards.map((c) => (c.commodity.id === card.commodity.id ? { ...c, watched: !c.watched } : c)) });
      toast(card.watched ? "Stopped watching." : "Watching: you will get an alert at ±10% in 7 days.", "ok");
    } catch (e) {
      toast(e.message, "error");
    }
  }

  return (
    <Shell module="pp" wide>
      <PageTitle title="Market prices" subtitle={`Today, ${fmtDate(new Date().toISOString())}`} action={<Button className="hidden md:inline-flex" onClick={() => navigate("/pp/report")}>Report a price</Button>} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <MarketSelect markets={markets.data} value={market} onChange={setMarket} />
        {markets.data?.find((m) => m.id === market)?.is_demo && <DemoBadge />}
      </div>
      {alerts.data?.length > 0 && (
        <section className="mb-5 rounded-lg border-2 border-line bg-white p-3">
          <h2 className="mb-1 font-semibold">Price alerts (±10% in 7 days)</h2>
          <ul className="space-y-1 text-sm">
            {alerts.data.slice(0, 5).map((a, i) => (
              <li key={i}>
                <b>{a.commodity.name_en}</b> ({a.commodity.variant}) at {a.market.name_en}: <Change change={a.change_7d} /> {a.watched && <span className="text-primary">· watching</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {dash.loading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      )}
      {dash.error && <ErrorState error={dash.error} onRetry={dash.reload} />}
      {dash.data && dash.data.cards.length === 0 && <Empty title="No products yet">The team adds products and markets before the pilot.</Empty>}
      {dash.data && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {dash.data.cards.map((c) => (
            <Card key={c.commodity.id} className="flex flex-col gap-2 p-4">
              <button className="text-left" onClick={() => setOpen(c.commodity)}>
                <span className="block font-semibold">
                  {c.commodity.name_en} <span className="font-normal text-ink/65">({c.commodity.variant})</span>
                </span>
                <span className="block text-sm text-ink/60" lang="bn">
                  {c.commodity.name_bn} · per {c.commodity.unit}
                </span>
                <span className="mt-2 flex items-end justify-between gap-2">
                  <span>
                    <span className="num block text-3xl font-bold">{c.latest ? bdt(c.latest.verified_price) : "—"}</span>
                    <span className="text-xs text-ink/60">{c.latest ? `verified, ${fmtShort(c.latest.date)}` : "no verified price yet"}</span>
                  </span>
                  <Sparkline points={c.sparkline} />
                </span>
              </button>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/50 pt-2">
                <Change change={c.change_7d} />
                <span className="text-xs text-ink/65">
                  Today: {c.today.status === "Verified" ? `verified ${bdt(c.today.verified_price)}` : `${c.today.report_count}/3 eligible reports`}
                </span>
              </div>
              <button className="min-h-10 self-start rounded-md px-2 text-sm font-semibold text-primary hover:bg-soft/60" onClick={() => watch(c)} aria-pressed={c.watched}>
                {c.watched ? "Watching ★" : "Watch ☆"}
              </button>
            </Card>
          ))}
        </div>
      )}
      <p className="mt-4 text-sm text-ink/65">A verified price is the median of at least 3 credible reports from different people for the same product, market and day. It is an estimate, not a proven price.</p>
      {open && <ProductPanel commodity={open} market={market} onClose={() => setOpen(null)} />}
    </Shell>
  );
}

export function Explore() {
  const markets = useMarkets();
  const coms = useData(() => api("/api/commodities"), []);
  const [market, setMarket] = useState(null);
  const [com, setCom] = useState(null);
  useEffect(() => {
    if (!market && markets.data?.length) setMarket(markets.data[0].id);
    if (!com && coms.data?.length) setCom(coms.data[0]);
  }, [markets.data, coms.data, market, com]);
  return (
    <Shell module="pp" wide>
      <PageTitle title="Explore prices" subtitle="Pick a product and a market." />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <MarketSelect markets={markets.data} value={market} onChange={setMarket} />
        <select className={cx(inputCls, "sm:w-80")} value={com?.id || ""} onChange={(e) => setCom(coms.data.find((c) => c.id === Number(e.target.value)))} aria-label="Product">
          {(coms.data || []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name_en} ({c.variant}) per {c.unit}
            </option>
          ))}
        </select>
      </div>
      {market && com ? <ExploreBody commodity={com} market={market} /> : <Skeleton className="h-64" />}
    </Shell>
  );
}

function ExploreBody({ commodity, market }) {
  const hist = useData(() => api("/api/prices/history", { query: { commodity_id: commodity.id, market_id: market, days: 30 } }), [commodity.id, market]);
  const raw = useData(() => api("/api/prices/reports", { query: { commodity_id: commodity.id, market_id: market } }), [commodity.id, market]);
  return (
    <div className="space-y-6">
      <Card className="p-4">{hist.data ? <PriceChart points={hist.data.points} reference={hist.data.reference} /> : <Skeleton className="h-56" />}</Card>
      <section>
        <h2 className="mb-2 text-lg font-semibold">Latest reports (7 days)</h2>
        {raw.data?.length === 0 && <p className="text-ink/70">No reports yet for this product here.</p>}
        <ul className="divide-y divide-line/50 rounded-md border border-line/60 bg-white">
          {(raw.data || []).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="num w-20 font-semibold">{bdt(r.price_bdt)}</span>
              <span className="text-sm text-ink/70">
                {fmtShort(r.observed_at)}, {fmtTime(r.observed_at)}
              </span>
              <StatusChip status={r.status} />
              {r.outlier && <span className="rounded-full bg-warn px-2 text-sm text-white">Unusual price</span>}
              {r.is_mine && <span className="text-sm font-semibold">yours</span>}
              {r.is_seed && <DemoBadge />}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function PriceReport() {
  const { toast, user } = useApp();
  const markets = useMarkets();
  const coms = useData(() => api("/api/commodities"), []);
  const [market, setMarket] = useState("");
  const [com, setCom] = useState("");
  const [price, setPrice] = useState("");
  const [day, setDay] = useState(dhakaToday());
  const [clock, setClock] = useState(() => new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit" }));
  const [useGps, setUseGps] = useState(true);
  const [shot, setShot] = useState(null);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const minDay = new Date(Date.now() - 7 * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
  const visibleMarkets = (markets.data || []).filter((m) => m.is_demo === Boolean(user?.is_seed));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      let pos = null;
      if (useGps) pos = await getPosition().catch(() => null); // GPS is optional for prices (C6)
      const token = shot ? await ensureFreshToken(shot) : null;
      await api("/api/reports/price", {
        method: "POST",
        form: {
          commodity_id: com, market_id: market, price_bdt: price, observed_at: `${day}T${clock}:00+06:00`,
          lat: pos?.lat, lon: pos?.lon, accuracy: pos?.accuracy, capture_token: token, photo: shot?.blob,
        },
      });
      setDone(true);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <Shell module="pp">
        <div className="flex flex-col items-center gap-6 py-12 text-center">
          <span className="cp-pulse relative grid size-24 place-items-center rounded-full bg-primary text-4xl text-white">✓</span>
          <h1 className="text-2xl font-bold">Price sent</h1>
          <p className="max-w-sm text-ink/75">It counts toward the verified price once it is credible and at least 3 people reported the same product here today.</p>
          <div className="flex gap-3">
            <Button onClick={() => navigate("/pp")}>See prices</Button>
            <Button
              kind="outline"
              onClick={() => {
                setDone(false);
                setPrice("");
                setShot(null);
              }}
            >
              Report another
            </Button>
          </div>
        </div>
      </Shell>
    );

  return (
    <Shell module="pp">
      <PageTitle title="Report a price" subtitle="What did it cost? A price cannot be edited after you send it." />
      {camera ? (
        <Camera
          purpose="price_photo"
          onShot={(s) => {
            setShot(s);
            setCamera(false);
          }}
          onCancel={() => setCamera(false)}
        />
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Market" id="m">
            <select id="m" className={inputCls} required value={market} onChange={(e) => setMarket(e.target.value)}>
              <option value="" disabled>
                Choose a market
              </option>
              {visibleMarkets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name_en} · {m.name_bn}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Product, variant and unit" id="c">
            <select id="c" className={inputCls} required value={com} onChange={(e) => setCom(e.target.value)}>
              <option value="" disabled>
                Choose a product
              </option>
              {(coms.data || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name_en} ({c.variant}) per {c.unit}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Price in taka (৳)" id="p" hint="Up to two decimals.">
            <input id="p" className={cx(inputCls, "num")} inputMode="decimal" pattern="\d+(\.\d{1,2})?" required value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date seen" id="d" hint="Today or up to 7 days back.">
              <input id="d" type="date" className={inputCls} min={minDay} max={dhakaToday()} required value={day} onChange={(e) => setDay(e.target.value)} />
            </Field>
            <Field label="Time seen" id="t">
              <input id="t" type="time" className={inputCls} required value={clock} onChange={(e) => setClock(e.target.value)} />
            </Field>
          </div>
          <label className="flex items-center gap-3">
            <input type="checkbox" className="size-5 accent-[var(--primary)]" checked={useGps} onChange={(e) => setUseGps(e.target.checked)} />
            <span>Add my location (optional; being at the market makes the report more credible)</span>
          </label>
          <div className="flex items-center gap-3">
            {shot && <img src={shot.url} alt="Product photo" className="size-20 rounded-md object-cover" />}
            <Button type="button" kind="outline" onClick={() => setCamera(true)}>
              {shot ? "Retake photo" : "Add a product photo (optional)"}
            </Button>
          </div>
          <Button size="lg" className="w-full" busy={busy}>
            Send price
          </Button>
          {visibleMarkets.length === 0 && markets.data && <p className="text-sm text-ink/70">No markets are open for your account yet.</p>}
        </form>
      )}
    </Shell>
  );
}
