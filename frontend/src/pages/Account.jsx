// Alerts (two tabs, B10, C4) and the profile: reputation, my reports, pinned, areas, consents, price watch, account.
import { useEffect, useState } from "react";
import { ReportDialog } from "../components/Report.jsx";
import { Shell } from "../components/Shell.jsx";
import { Button, Card, DemoBadge, Empty, ErrorState, PageTitle, Score, Skeleton, StatusChip, Tabs, cx, inputCls } from "../components/ui.jsx";
import { api } from "../lib/api.js";
import { ago, bdt, fmtDate } from "../lib/format.js";
import { Link, navigate } from "../lib/router.jsx";
import { useApp, useData } from "../lib/store.jsx";

function moduleOf(user) {
  return user?.preferred_module === "price_patrol" ? "pp" : "gg";
}

export function Alerts() {
  const { user, unread, refreshUnread, live } = useApp();
  const [tab, setTab] = useState("alerts");
  const [open, setOpen] = useState(null);
  const { data, error, loading, reload, setData } = useData(() => api("/api/notifications", { query: { tab } }), [tab, live?.id]);

  async function read(n) {
    if (!n.read) {
      await api(`/api/notifications/${n.id}/read`, { method: "POST" }).catch(() => {});
      setData({ ...data, items: data.items.map((x) => (x.id === n.id ? { ...x, read: true } : x)) });
      refreshUnread();
    }
    if (n.report_id) setOpen(n.report_id);
    else if (n.kind === "price_alert") navigate("/pp");
    else if (n.kind === "emerging_issue") navigate("/gg/dashboard");
  }
  async function readAll() {
    await api("/api/notifications/read-all", { method: "POST", query: { tab } }).catch(() => {});
    reload();
    refreshUnread();
  }

  return (
    <Shell module={moduleOf(user)}>
      <PageTitle title="Alerts" action={<Button kind="ghost" size="sm" onClick={readAll}>Mark all read</Button>} />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "alerts", label: "Alerts", badge: unread.alerts },
          { value: "notifications", label: "Notifications", badge: unread.notifications },
        ]}
      />
      <p className="mb-3 text-sm text-ink/70">
        {tab === "alerts" ? "New reports in your areas, emerging issues and price changes you watch." : "Status changes on your own reports and on reports you pinned."}
      </p>
      {loading && <Skeleton className="h-40 w-full" />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && data.items.length === 0 && <Empty title="All quiet">Nothing new right now.</Empty>}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-line/50 rounded-lg border border-line/60 bg-white">
          {data.items.map((n) => (
            <li key={n.id}>
              <button onClick={() => read(n)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-soft/40">
                <span className={cx("mt-2 size-2.5 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-primary")} aria-label={n.read ? undefined : "unread"} />
                <span className="min-w-0 flex-1">
                  <span className={cx("block", !n.read && "font-semibold")}>{n.payload.text}</span>
                  <span className="text-sm text-ink/60">{ago(n.created_at)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <ReportDialog id={open} onClose={() => setOpen(null)} />
    </Shell>
  );
}

function Areas({ me, onChange }) {
  const { toast } = useApp();
  const wards = useData(() => api("/api/wards"), []);
  const [kind, setKind] = useState("other");
  const [ward, setWard] = useState("");
  async function add() {
    try {
      const out = await api("/api/me/addresses", { method: "POST", body: { kind, ward_id: ward === "none" ? null : Number(ward) } });
      onChange({ ...me, addresses: out });
      setWard("");
    } catch (e) {
      toast(e.message, "error");
    }
  }
  async function remove(id) {
    try {
      onChange({ ...me, addresses: await api(`/api/me/addresses/${id}`, { method: "DELETE" }) });
    } catch (e) {
      toast(e.message, "error");
    }
  }
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">My areas</h2>
      <ul className="space-y-2">
        {me.addresses.map((a) => (
          <li key={a.id} className="flex items-center justify-between rounded-md bg-white px-3 py-2 shadow-1">
            <span>
              <span className="mr-2 rounded-full bg-soft px-2 py-0.5 text-xs font-semibold capitalize">{a.kind}</span>
              {a.ward_name_en} {a.ward_name_bn && <span className="text-ink/60">· {a.ward_name_bn}</span>}
            </span>
            {me.addresses.length > 1 && (
              <button className="min-h-11 px-2 text-sm font-semibold text-err" onClick={() => remove(a.id)}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-[7rem_1fr_auto] gap-2">
        <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          <option value="home">Home</option>
          <option value="work">Work</option>
          <option value="other">Other</option>
        </select>
        <select className={inputCls} value={ward} onChange={(e) => setWard(e.target.value)} aria-label="Ward">
          <option value="">Choose a ward</option>
          {(wards.data || []).map((w) => (
            <option key={w.id} value={w.id}>
              {w.name_en}
            </option>
          ))}
          <option value="none">Outside the pilot area</option>
        </select>
        <Button kind="outline" onClick={add} disabled={!ward}>
          Add
        </Button>
      </div>
    </section>
  );
}

function MyReports({ type }) {
  const { data, error, loading, reload } = useData(() => api("/api/me/reports", { query: { type } }), [type]);
  const [open, setOpen] = useState(null);
  if (loading) return <Skeleton className="h-24 w-full" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data.length) return <p className="text-ink/70">{type === "civic" ? "You have not posted a civic report yet." : "You have not reported a price yet."}</p>;
  return (
    <>
      <ul className="divide-y divide-line/50 rounded-lg border border-line/60 bg-white">
        {data.map((r) => (
          <li key={r.id}>
            <button onClick={() => setOpen(r.id)} className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left hover:bg-soft/40">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">
                  {type === "civic" ? r.category?.name_en : `${r.price.commodity.name_en} (${r.price.commodity.variant}) · ${bdt(r.price.price_bdt)}/${r.price.commodity.unit}`} {r.is_seed && <DemoBadge />}
                </span>
                <span className="text-sm text-ink/65">
                  {type === "civic" ? r.ward?.name_en || "Outside the pilot area" : r.price.market.name_en} · {fmtDate(r.submitted_at)}
                </span>
                {type === "price" && (
                  <span className={cx("block text-sm font-medium", r.price.counts_toward_verified ? "text-ok" : "text-ink/65")}>
                    Counts toward verified price: {r.price.counts_toward_verified ? "Yes" : "No"}
                  </span>
                )}
              </span>
              {r.results ? <StatusChip status={r.results.status} /> : <StatusChip status="pending" />}
            </button>
          </li>
        ))}
      </ul>
      <ReportDialog id={open} onClose={() => setOpen(null)} />
    </>
  );
}

function Watchlist() {
  const { toast } = useApp();
  const coms = useData(() => Promise.all([api("/api/commodities"), api("/api/me/price-watch")]), []);
  const [watched, setWatched] = useState(new Set());
  useEffect(() => {
    if (coms.data) setWatched(new Set(coms.data[1]));
  }, [coms.data]);
  if (!coms.data) return <Skeleton className="h-16 w-full" />;
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
    <div className="flex flex-wrap gap-2">
      {coms.data[0].map((c) => (
        <button key={c.id} onClick={() => toggle(c.id)} aria-pressed={watched.has(c.id)} className={cx("min-h-10 rounded-full border-2 px-3 text-sm font-semibold", watched.has(c.id) ? "border-primary bg-primary text-white" : "border-line bg-white")}>
          {c.name_en} · {c.variant}
        </button>
      ))}
    </div>
  );
}

export function Profile() {
  const { user, setUser, signOut, toast } = useApp();
  const [me, setMe] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("civic");
  useEffect(() => {
    api("/api/me").then(setMe).catch(setError);
  }, []);

  async function remove() {
    if (!window.confirm("Delete your account? Your reports stay, shown as “reporter unavailable”. This cannot be undone.")) return;
    try {
      await api("/api/me", { method: "DELETE" });
      await signOut();
      navigate("/login", { replace: true });
    } catch (e) {
      toast(e.message, "error");
    }
  }

  return (
    <Shell module={moduleOf(user)}>
      {error && <ErrorState error={error} />}
      {!me && !error && <Skeleton className="h-48 w-full" />}
      {me && (
        <div className="space-y-8">
          <section className="flex flex-wrap items-center gap-4">
            <span className="grid size-16 place-items-center rounded-full bg-primary text-2xl font-bold text-white">{(me.display_name || "?").slice(0, 1)}</span>
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold">{me.display_name}</h1>
              <p className="text-ink/70">
                {me.phone_masked} · member since {fmtDate(me.member_since)}
              </p>
            </div>
          </section>
          <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
            <Score label="Reputation" value={me.reputation.display} hint="new accounts start at 50" />
            <Score label="Uncertainty" value={me.reputation.uncertainty_display} hint="falls as you build a record" />
            <Score label="Reports" value={me.stats.reports} />
            <Score label="On-the-spot votes" value={me.stats.on_spot_votes} />
          </Card>
          <p className="-mt-5 text-sm text-ink/65">Votes from new accounts count zero until the account has a record (C9). Reputation slowly fades back toward 50 when you are inactive (90-day half-life).</p>
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">My reports</h2>
              <Link to="/gg/pinned" className="text-sm font-semibold text-primary underline">
                Pinned ({me.stats.pinned})
              </Link>
            </div>
            <Tabs value={tab} onChange={setTab} tabs={[{ value: "civic", label: "Civic" }, { value: "price", label: "Prices" }]} />
            <MyReports type={tab} />
          </section>
          <Areas
            me={me}
            onChange={(m) => {
              setMe(m);
              setUser({ ...user, addresses: m.addresses });
            }}
          />
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Price alerts</h2>
            <p className="text-sm text-ink/70">Get an alert when a product you watch rises or drops 10% in 7 days.</p>
            <Watchlist />
          </section>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Permissions</h2>
            <ul className="text-sm">
              {Object.entries(me.consents).map(([k, v]) => (
                <li key={k}>
                  {k.replace("_", " ")}: <b>{v.granted ? "given" : "withdrawn"}</b> (version {v.version}, {fmtDate(v.at)})
                </li>
              ))}
            </ul>
          </section>
          <section className="flex flex-wrap gap-3 border-t border-line/60 pt-6">
            <Button
              kind="outline"
              onClick={async () => {
                await signOut();
                navigate("/login", { replace: true });
              }}
            >
              Log out
            </Button>
            <Button kind="danger" onClick={remove}>
              Delete account
            </Button>
          </section>
        </div>
      )}
    </Shell>
  );
}
