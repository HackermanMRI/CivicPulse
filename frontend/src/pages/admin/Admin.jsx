// Minimal admin portal (V4, W2–W8). Raw 0–1 values (C1). Every action needs a written reason and is audited.
import { useState } from "react";
import {
  Button, Card, DemoBadge, Dialog, Empty, ErrorState, FlagChip, OfflineBanner, Photo, Skeleton, StatusChip, Tabs, Toasts, cx, inputCls,
} from "../../components/ui.jsx";
import { api } from "../../lib/api.js";
import { COMPONENT, DECISION, MODE, fmtDateTime } from "../../lib/format.js";
import { Link, navigate, useRoute } from "../../lib/router.jsx";
import { useApp, useData } from "../../lib/store.jsx";

const n3 = (v) => (v == null ? "—" : Number(v).toFixed(3));

function ReasonForm({ label, action, onDone, kind = "primary" }) {
  const { toast } = useApp();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await action(reason);
          setReason("");
          onDone?.();
        } catch (err) {
          toast(err.message, "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      <input className={inputCls} required minLength={5} maxLength={1000} placeholder="Reason (required, saved in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button kind={kind} busy={busy}>
        {label}
      </Button>
    </form>
  );
}

function Overview() {
  const { data, error, reload } = useData(() => api("/api/admin/overview"), []);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Skeleton className="h-24" />;
  const items = [
    ["Open alerts", data.open_alerts, "/admin/alerts"], ["Flagged reports", data.flagged_reports, "/admin/reports"],
    ["Hidden reports", data.hidden_reports, "/admin/reports?f=hidden"], ["Open abuse reports", data.open_abuse, "/admin/reports?f=abuse"],
    ["Citizens", data.users, "/admin/users"], ["Suspended", data.suspended, "/admin/users"], ["Still scoring", data.pending_reports, "/admin/reports?f=pending"],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([label, value, to]) => (
        <Link key={label} to={to} className="rounded-lg bg-white p-4 shadow-1 hover:shadow-2">
          <span className="block text-sm text-ink/70">{label}</span>
          <span className="num text-3xl font-bold">{value}</span>
        </Link>
      ))}
    </div>
  );
}

function AlertsQueue() {
  const [status, setStatus] = useState("open");
  const [open, setOpen] = useState(null);
  const list = useData(() => api("/api/admin/alerts", { query: { status } }), [status]);
  return (
    <div className="space-y-4">
      <Tabs className="max-w-xs" value={status} onChange={setStatus} tabs={[{ value: "open", label: "Open" }, { value: "solved", label: "Solved" }]} />
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.data?.length === 0 && <Empty title="No alerts">Nothing to review.</Empty>}
      <ul className="space-y-2">
        {(list.data || []).map((a) => (
          <li key={a.id}>
            <button className="w-full rounded-md bg-white p-3 text-left shadow-1 hover:shadow-2" onClick={() => setOpen(a.id)}>
              <span className="block font-semibold">{a.kind === "pair_agreement" ? "Pair agreement (possible vote ring)" : "Device rule violation"}</span>
              <span className="text-sm text-ink/70">
                {a.user_ids.length} accounts · {a.report_ids.length} reports · {fmtDateTime(a.created_at)} {a.outcome && `· ${a.outcome.replace("_", " ")}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && <AlertDetail id={open} onClose={() => setOpen(null)} onSolved={list.reload} />}
    </div>
  );
}

function AlertDetail({ id, onClose, onSolved }) {
  const { toast } = useApp();
  const { data, error } = useData(() => api(`/api/admin/alerts/${id}`), [id]);
  const [outcome, setOutcome] = useState("false_alarm");
  return (
    <Dialog open onClose={onClose} title="Alert review" wide>
      <div className="space-y-4 p-5">
        {error && <ErrorState error={error} />}
        {!data && !error && <Skeleton className="h-40" />}
        {data && (
          <>
            <section>
              <h3 className="font-semibold">Signals</h3>
              <pre className="overflow-x-auto rounded-md bg-soft/50 p-3 text-sm">{JSON.stringify(data.signals, null, 2)}</pre>
            </section>
            <section>
              <h3 className="mb-1 font-semibold">Accounts</h3>
              <ul className="space-y-1 text-sm">
                {data.users.map((u) => u && (
                  <li key={u.id}>
                    <Link to={`/admin/users/${u.id}`} className="font-semibold text-primary underline">
                      {u.display_name || "deleted"}
                    </Link>{" "}
                    {u.is_seed && <DemoBadge />} · {u.state} · rep {n3(u.rep)} (u {n3(u.rep_uncertainty)}) · {u.devices} device(s)
                  </li>
                ))}
              </ul>
            </section>
            {data.votes.length > 0 && (
              <section>
                <h3 className="mb-1 font-semibold">Votes on shared reports</h3>
                <div className="max-h-60 overflow-y-auto rounded-md border border-line/60">
                  <table className="w-full text-sm">
                    <thead className="bg-soft/50 text-left">
                      <tr><th className="px-2 py-1">Report</th><th>Voter</th><th>Decision</th><th>Mode</th><th>Time</th></tr>
                    </thead>
                    <tbody>
                      {data.votes.map((v, i) => (
                        <tr key={i} className="border-t border-line/40">
                          <td className="px-2 py-1 font-mono text-xs">{v.report_id.slice(0, 8)}</td>
                          <td className="font-mono text-xs">{v.voter_id.slice(0, 8)}</td>
                          <td>{DECISION[v.decision]}</td>
                          <td>{MODE[v.mode_verified]}</td>
                          <td>{fmtDateTime(v.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {data.status === "open" ? (
              <section className="space-y-2 border-t border-line/50 pt-3">
                <h3 className="font-semibold">Solve (W4). No score or reputation changes automatically (P5).</h3>
                <select className={cx(inputCls, "w-auto!")} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                  <option value="false_alarm">False alarm</option>
                  <option value="collusion_confirmed">Collusion confirmed</option>
                </select>
                <ReasonForm
                  label="Mark solved"
                  action={(note) => api(`/api/admin/alerts/${id}/solve`, { method: "POST", body: { outcome, note } })}
                  onDone={() => {
                    toast("Alert solved.", "ok");
                    onSolved();
                    onClose();
                  }}
                />
              </section>
            ) : (
              <p className="text-sm">Solved: {data.outcome?.replace("_", " ")}. Note: {data.note}</p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

function ReportsQueue() {
  const { query } = useRoute();
  const [filter, setFilter] = useState(query.get("f") || "flagged");
  const [open, setOpen] = useState(null);
  const list = useData(() => api("/api/admin/reports", { query: { filter } }), [filter]);
  return (
    <div className="space-y-4">
      <Tabs value={filter} onChange={setFilter} tabs={["flagged", "hidden", "abuse", "pending", "all"].map((f) => ({ value: f, label: f[0].toUpperCase() + f.slice(1) }))} />
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.loading && <Skeleton className="h-40" />}
      {list.data?.length === 0 && <Empty title="Queue empty">No reports in this list.</Empty>}
      {list.data?.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line/60 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-soft/50 text-left">
              <tr><th className="px-3 py-2">Report</th><th>Status</th><th>c</th><th>u</th><th>Flags</th><th>Visibility</th><th>Abuse</th><th>Posted</th></tr>
            </thead>
            <tbody>
              {list.data.map((r) => (
                <tr key={r.id} className="cursor-pointer border-t border-line/40 hover:bg-soft/30" onClick={() => setOpen(r.id)}>
                  <td className="px-3 py-2">
                    {r.type === "civic" ? r.category?.name_en : "Price"} {r.is_seed && <DemoBadge />}
                    <span className="block text-xs text-ink/60">{r.ward?.name_en}</span>
                  </td>
                  <td>{r.results && <StatusChip status={r.results.status} />}</td>
                  <td className="num">{n3(r.results?.credibility)}</td>
                  <td className="num">{n3(r.results?.uncertainty)}</td>
                  <td>{r.results?.flags.map((f) => f.code).join(", ")}</td>
                  <td>{r.visibility}</td>
                  <td className="num">{r.open_abuse || ""}</td>
                  <td>{fmtDateTime(r.submitted_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <AdminReport id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </div>
  );
}

function CompTable({ rows, title }) {
  return (
    <div>
      <h4 className="mb-1 font-semibold">{title}</h4>
      <table className="w-full text-sm">
        <thead className="text-left text-ink/70">
          <tr><th>Component</th><th>Avail.</th><th>s</th><th>w</th><th>e+</th><th>e−</th></tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.component} className="border-t border-line/40" title={c.explanation}>
              <td className="py-1">{COMPONENT[c.component]}</td>
              <td>{c.availability}</td>
              <td className="num">{n3(c.score)}</td>
              <td className="num">{c.weight}</td>
              <td className="num">{n3(c.pos_ev)}</td>
              <td className="num">{n3(c.neg_ev)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdminReport({ id, onClose, onChanged }) {
  const { toast } = useApp();
  const { data: r, error, reload } = useData(() => api(`/api/admin/reports/${id}`), [id]);
  return (
    <Dialog open onClose={onClose} title="Report review" wide>
      <div className="space-y-5 p-5">
        {error && <ErrorState error={error} />}
        {!r && !error && <Skeleton className="h-60" />}
        {r && (
          <>
            <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
              <Photo src={r.photo_url} alt="Report photo" className="aspect-square w-full rounded-md" />
              <div className="space-y-1">
                <p className="font-semibold">
                  {r.category?.name_en || "Price report"} {r.is_seed && <DemoBadge />}
                </p>
                <p className="whitespace-pre-line">{r.description}</p>
                <p className="text-sm text-ink/70">
                  {r.ward?.name_en} · {fmtDateTime(r.submitted_at)} · visibility: <b>{r.visibility}</b> {r.visibility_reason && `(${r.visibility_reason})`}
                </p>
                {r.results && (
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip status={r.results.status} /> judging: <b>{r.judging_status}</b>
                    {r.results.flags.map((f) => (
                      <FlagChip key={f.code} flag={f} />
                    ))}
                  </div>
                )}
                {r.results && (
                  <p className="num text-sm">
                    α {n3(r.results.alpha)} · β {n3(r.results.beta)} · c {n3(r.results.credibility)} · u {n3(r.results.uncertainty)} · κ {n3(r.results.conflict)} · {r.results.components_used}/7
                  </p>
                )}
                {r.reporter && (
                  <p className="text-sm">
                    Reporter:{" "}
                    <Link to={`/admin/users/${r.reporter.id}`} className="font-semibold text-primary underline">
                      {r.reporter.display_name || "deleted"}
                    </Link>{" "}
                    · rep {n3(r.reporter.rep)}
                  </p>
                )}
              </div>
            </div>
            {r.results?.components && (
              <div className="grid gap-4 md:grid-cols-2">
                <CompTable rows={r.results.components} title="Displayed view" />
                <CompTable rows={r.components_judging} title="Judging view (no reputation)" />
              </div>
            )}
            {r.votes.length > 0 && (
              <section>
                <h4 className="mb-1 font-semibold">Votes</h4>
                <ul className="text-sm">
                  {r.votes.map((v) => (
                    <li key={v.id} className={v.replaced ? "line-through opacity-60" : ""}>
                      {DECISION[v.decision]} · claimed {MODE[v.mode_claimed]} → {MODE[v.mode_verified]} · weight {n3(v.weight_at_vote)} {v.distance_m != null && `· ${Math.round(v.distance_m)} m`} · {fmtDateTime(v.created_at)}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {r.abuse_reports.length > 0 && (
              <section>
                <h4 className="mb-1 font-semibold">Abuse reports</h4>
                {r.abuse_reports.map((a) => (
                  <div key={a.id} className="mb-2 rounded-md bg-soft/40 p-2 text-sm">
                    “{a.reason}” · {a.state}
                    {a.state === "open" && (
                      <ReasonForm label="Mark reviewed" kind="outline" action={(reason) => api(`/api/admin/abuse/${a.id}/review`, { method: "POST", body: { reason } })} onDone={reload} />
                    )}
                  </div>
                ))}
              </section>
            )}
            <section>
              <h4 className="mb-1 font-semibold">Scoring history</h4>
              <ul className="max-h-40 overflow-y-auto text-sm">
                {r.runs.map((s) => (
                  <li key={s.id}>
                    {fmtDateTime(s.run_at)} · {s.trigger} · {s.status} (judging {s.judging_status}) · c {n3(s.credibility)} u {n3(s.uncertainty)} · rule {s.gates.displayed_rule} · config {s.config_hash}
                  </li>
                ))}
              </ul>
            </section>
            <section className="border-t border-line/50 pt-3">
              <p className="mb-2 text-sm text-ink/70">Hiding or restoring never changes credibility or reputation directly (W2).</p>
              {r.visibility === "visible" ? (
                <ReasonForm
                  label="Hide report"
                  kind="danger"
                  action={(reason) => api(`/api/admin/reports/${id}/hide`, { method: "POST", body: { reason } })}
                  onDone={() => {
                    toast("Report hidden.", "ok");
                    reload();
                    onChanged();
                  }}
                />
              ) : (
                <ReasonForm
                  label="Restore report"
                  action={(reason) => api(`/api/admin/reports/${id}/restore`, { method: "POST", body: { reason } })}
                  onDone={() => {
                    toast("Report restored.", "ok");
                    reload();
                    onChanged();
                  }}
                />
              )}
            </section>
          </>
        )}
      </div>
    </Dialog>
  );
}

function Users() {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const list = useData(() => api("/api/admin/users", { query: { q: search } }), [search]);
  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q);
        }}
      >
        <input className={inputCls} placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button>Search</Button>
      </form>
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      <div className="overflow-x-auto rounded-lg border border-line/60 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-soft/50 text-left">
            <tr><th className="px-3 py-2">Name</th><th>Phone</th><th>Role</th><th>State</th><th>rep</th><th>u</th><th>Devices</th></tr>
          </thead>
          <tbody>
            {(list.data || []).map((u) => (
              <tr key={u.id} className="cursor-pointer border-t border-line/40 hover:bg-soft/30" onClick={() => navigate(`/admin/users/${u.id}`)}>
                <td className="px-3 py-2">
                  {u.display_name} {u.is_seed && <DemoBadge />}
                </td>
                <td>{u.phone || "—"}</td>
                <td>{u.role}</td>
                <td>{u.state}</td>
                <td className="num">{n3(u.rep)}</td>
                <td className="num">{n3(u.rep_uncertainty)}</td>
                <td className="num">{u.devices}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserPage({ id }) {
  const { toast } = useApp();
  const { data: u, error, reload } = useData(() => api(`/api/admin/users/${id}`), [id]);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!u) return <Skeleton className="h-60" />;
  return (
    <div className="space-y-5">
      <Card className="p-4">
        <h2 className="text-xl font-semibold">
          {u.display_name || "deleted"} {u.is_seed && <DemoBadge />}
        </h2>
        <p className="num text-sm">
          {u.phone || "no phone"} · {u.role} · {u.state} · rep {n3(u.rep)} (α {n3(u.alpha)}, β {n3(u.beta)}, u {n3(u.rep_uncertainty)}) · {u.devices} device(s) · since {fmtDateTime(u.created_at)}
        </p>
      </Card>
      {u.role === "citizen" && (
        <section>
          <h3 className="mb-1 font-semibold">{u.state === "suspended" ? "Reinstate" : "Suspend"} (W3: blocks login and new actions; old reports and votes stay)</h3>
          <ReasonForm
            label={u.state === "suspended" ? "Reinstate" : "Suspend"}
            kind={u.state === "suspended" ? "primary" : "danger"}
            action={(reason) => api(`/api/admin/users/${id}/${u.state === "suspended" ? "reinstate" : "suspend"}`, { method: "POST", body: { reason } })}
            onDone={() => {
              toast("Saved.", "ok");
              reload();
            }}
          />
        </section>
      )}
      <section>
        <h3 className="mb-1 font-semibold">Reports ({u.reports.length})</h3>
        <ul className="text-sm">
          {u.reports.map((r) => (
            <li key={r.id}>
              {r.type === "civic" ? r.category?.name_en : "Price"} · {r.results?.status} · {fmtDateTime(r.submitted_at)}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-1 font-semibold">Reputation events</h3>
        <ul className="max-h-48 overflow-y-auto text-sm">
          {u.reputation_events.map((e, i) => (
            <li key={i} className={e.superseded ? "line-through opacity-60" : ""}>
              {e.kind} · Δα {e.d_alpha} · Δβ {e.d_beta} · {fmtDateTime(e.occurred_at)}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-1 font-semibold">Moderation history</h3>
        {u.moderation.length === 0 ? <p className="text-sm text-ink/70">None.</p> : (
          <ul className="text-sm">
            {u.moderation.map((m, i) => (
              <li key={i}>
                {m.action} · {m.reason} · {fmtDateTime(m.created_at)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Audit() {
  const [f, setF] = useState({ entity: "", action: "", from: "", to: "" });
  const [applied, setApplied] = useState(f);
  const list = useData(() => api("/api/admin/audit", { query: applied }), [applied]);
  return (
    <div className="space-y-4">
      <form
        className="grid gap-2 sm:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(f);
        }}
      >
        <input className={inputCls} placeholder="Entity (report, user…)" value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })} />
        <input className={inputCls} placeholder="Action (report.hide…)" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} />
        <input type="date" className={inputCls} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="From" />
        <input type="date" className={inputCls} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="To" />
        <Button>Filter</Button>
      </form>
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      <div className="overflow-x-auto rounded-lg border border-line/60 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-soft/50 text-left">
            <tr><th className="px-3 py-2">Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Reason</th></tr>
          </thead>
          <tbody>
            {(list.data || []).map((a) => (
              <tr key={a.id} className="border-t border-line/40 align-top">
                <td className="whitespace-nowrap px-3 py-1.5">{fmtDateTime(a.created_at)}</td>
                <td className="font-mono text-xs">{a.actor_id ? a.actor_id.slice(0, 8) : "system"}</td>
                <td>{a.action}</td>
                <td className="font-mono text-xs">
                  {a.entity} {a.entity_id?.slice(0, 12)}
                </td>
                <td>{a.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const TABS = [
  ["/admin", "Overview"], ["/admin/alerts", "Alerts"], ["/admin/reports", "Reports"], ["/admin/users", "Accounts"], ["/admin/audit", "Audit log"],
];

export default function Admin() {
  const { path } = useRoute();
  const { user, signOut } = useApp();
  if (user?.role !== "admin") return <Empty title="Admins only" />;
  const userId = path.startsWith("/admin/users/") ? path.split("/")[3] : null;
  const section = userId ? "/admin/users" : TABS.find(([to]) => to !== "/admin" && path.startsWith(to))?.[0] || "/admin";
  return (
    <div data-module="shell" className="min-h-dvh bg-bg text-ink">
      <OfflineBanner />
      <header className="border-b border-line/60 bg-bg">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
          <span className="mr-4 text-lg font-bold">CivicPulse admin</span>
          <nav className="flex flex-wrap gap-1" aria-label="Admin">
            {TABS.map(([to, label]) => (
              <Link key={to} to={to} className={cx("rounded-md px-3 py-2 font-semibold", section === to ? "bg-soft" : "hover:bg-soft/60")}>
                {label}
              </Link>
            ))}
          </nav>
          <Button
            kind="ghost"
            size="sm"
            className="ml-auto"
            onClick={async () => {
              await signOut();
              navigate("/login", { replace: true });
            }}
          >
            Log out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {section === "/admin" && <Overview />}
        {section === "/admin/alerts" && <AlertsQueue />}
        {section === "/admin/reports" && <ReportsQueue />}
        {section === "/admin/users" && (userId ? <UserPage id={userId} /> : <Users />)}
        {section === "/admin/audit" && <Audit />}
      </main>
      <Toasts />
    </div>
  );
}
