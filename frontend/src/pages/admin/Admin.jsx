// Admin portal (board: Admin report review; V4, W2–W8). Raw 0–1 values (C1). Every action needs a written reason,
// never changes credibility or reputation directly, and is written to the audit log.
import { useEffect, useState } from "react";
import { Logo } from "../../components/icons.jsx";
import { Button, DemoBadge, ErrorState, OfflineBanner, Photo, Segmented, Select, Skeleton, StatusChip, Toasts, cx, inputCls, textareaCls } from "../../components/ui.jsx";
import { api } from "../../lib/api.js";
import { COMPONENT, DECISION, MODE, fmtDateTime, fmtRelDay } from "../../lib/format.js";
import { Link, navigate, useRoute } from "../../lib/router.jsx";
import { useApp, useData } from "../../lib/store.jsx";

const n2 = (v) => (v == null ? "—" : Number(v).toFixed(2));
const shortId = (id) => `#${id.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
const flagText = (r) => (r.results?.flags || []).map((f) => f.label).join(", ") || (r.visibility !== "visible" ? "Hidden" : "—");

function ReasonBox({ label, kind = "primary", action, onDone, placeholder, note }) {
  const { toast } = useApp();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = reason.trim().length >= 5;
  return (
    <form
      className="rounded-2xl border border-line bg-white p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await action(reason.trim());
          setReason("");
          onDone?.();
        } catch (err) {
          toast(err.message, "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block font-bold" htmlFor={`reason-${label}`}>
        Reason (required)
      </label>
      <textarea id={`reason-${label}`} className={cx(textareaCls("min-h-20"), "mt-2")} minLength={5} maxLength={1000} placeholder={placeholder} value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <Button kind={kind} busy={busy} disabled={!ok}>
          {label}
        </Button>
        <p className="min-w-0 flex-1 text-sm text-primary">{ok ? note : `Type a reason first. ${note}`}</p>
      </div>
    </form>
  );
}

function Table({ head, children, className }) {
  return (
    <div className={cx("overflow-x-auto rounded-2xl border border-line bg-white", className)}>
      <table className="w-full text-[15px]">
        <thead>
          <tr className="border-b border-line text-left text-sm text-primary">
            {head.map((h) => (
              <th key={h} className="px-3 py-3 font-bold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Row({ selected, onClick, children }) {
  return (
    <tr onClick={onClick} className={cx("cursor-pointer border-b border-line/60 align-top last:border-b-0", selected ? "bg-soft/40 shadow-[inset_4px_0_0_var(--primary)]" : "hover:bg-soft/20")}>
      {children}
    </tr>
  );
}

// ---------- report review ----------

function CompTable({ rows }) {
  return (
    <Table head={["Component", "Available", "Score", "e+", "e−", "Why"]}>
      {rows.map((c) => (
        <tr key={c.component} className="border-b border-line/60 last:border-b-0">
          <td className="px-3 py-2.5 font-bold">{COMPONENT[c.component]}</td>
          <td className="px-3 py-2.5">{c.availability === "unavailable" ? "No" : "Yes"}</td>
          <td className="num px-3 py-2.5">{c.availability === "unavailable" ? "—" : n2(c.score)}</td>
          <td className="num px-3 py-2.5">{c.availability === "unavailable" ? "—" : n2(c.pos_ev)}</td>
          <td className="num px-3 py-2.5">{c.availability === "unavailable" ? "—" : n2(c.neg_ev)}</td>
          <td className="px-3 py-2.5 text-sm text-primary">{c.explanation}</td>
        </tr>
      ))}
    </Table>
  );
}

function ReportDetail({ id, onChanged }) {
  const { toast } = useApp();
  const [view, setView] = useState("displayed");
  const { data: r, error, reload } = useData(() => api(`/api/admin/reports/${id}`), [id]);
  if (error) return <ErrorState error={error} onRetry={reload} title="Couldn't open the report" />;
  if (!r) return <Skeleton className="h-[480px] rounded-2xl" />;
  const res = r.results;
  const done = (msg) => () => {
    toast(msg, "ok");
    reload();
    onChanged();
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
        <Photo src={r.photo_url} alt="Report photo" className="aspect-[4/3] w-full rounded-2xl" placeholder="Photo" />
        <div className="min-w-0 space-y-2">
          <h2 className="display text-xl">
            {shortId(r.id)} · {r.category?.name_en || "Price report"} {r.is_seed && <DemoBadge />}
          </h2>
          <p className="text-[15px]">
            {r.ward?.name_en || "Outside the pilot area"}
            {r.gps_accuracy_m != null && ` · GPS ± ${Math.round(r.gps_accuracy_m)} m`} · by{" "}
            {r.reporter ? (
              <Link to={`/admin/users/${r.reporter.id}`} className="font-bold underline">
                {r.reporter.display_name || "deleted"}
              </Link>
            ) : (
              "unknown"
            )}
            {r.reporter && `, reputation ${n2(r.reporter.rep)}`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {res && <StatusChip status={res.status} size="sm" />}
            <span className={cx("rounded-full px-3 py-0.5 text-sm font-bold", r.visibility === "visible" ? "bg-soft" : "bg-err-soft text-err")}>{r.visibility === "visible" ? "Visible" : `Hidden: ${r.visibility.replace("_", " ")}`}</span>
            {res?.flags?.length > 0 && <span className="text-sm text-primary">Flag reason: {res.flags.map((f) => f.label).join(", ")}</span>}
          </div>
          {res && (
            <p className="num text-sm">
              α {n2(res.alpha)} · β {n2(res.beta)} · credibility {n2(res.credibility)} · uncertainty {n2(res.uncertainty)} · conflict {n2(res.conflict)} · judging: {r.judging_status}
            </p>
          )}
          {r.visibility_reason && <p className="text-sm">Hidden because: “{r.visibility_reason}”</p>}
        </div>
      </div>
      {r.description && <p className="rounded-xl bg-white px-4 py-3 text-[15px] leading-relaxed">{r.description}</p>}
      {res?.components && (
        <div>
          <Segmented
            className="mb-2"
            label="Component view"
            value={view}
            onChange={setView}
            options={[
              { value: "displayed", label: "Displayed" },
              { value: "judging", label: "Judging (no reputation)" },
            ]}
          />
          <CompTable rows={view === "displayed" ? res.components : r.components_judging} />
        </div>
      )}
      {r.visibility === "visible" ? (
        <ReasonBox label="Hide report" kind="danger" placeholder="Why are you hiding this report?" note="Admin actions never change credibility or reputation, and every action goes into the audit log." action={(reason) => api(`/api/admin/reports/${id}/hide`, { method: "POST", body: { reason } })} onDone={done("Report hidden.")} />
      ) : (
        <ReasonBox label="Restore report" placeholder="Why are you restoring this report?" note="The report is scored again and re-enters its event." action={(reason) => api(`/api/admin/reports/${id}/restore`, { method: "POST", body: { reason } })} onDone={done("Report restored.")} />
      )}
      {r.abuse_reports.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-bold">Abuse reports</h3>
          {r.abuse_reports.map((a) => (
            <div key={a.id} className="space-y-2 rounded-xl bg-white p-3">
              <p className="text-[15px]">
                “{a.reason}” · <b>{a.state}</b> · {fmtDateTime(a.created_at)}
              </p>
              {a.state === "open" && <ReasonBox label="Mark reviewed" kind="line" placeholder="What did you decide?" note="Saved in the audit log." action={(reason) => api(`/api/admin/abuse/${a.id}/review`, { method: "POST", body: { reason } })} onDone={reload} />}
            </div>
          ))}
        </section>
      )}
      <details className="rounded-2xl border border-line bg-white p-4">
        <summary className="cursor-pointer font-bold">Votes ({r.votes.length}) and scoring history ({r.runs.length})</summary>
        <ul className="mt-3 space-y-1 text-sm">
          {r.votes.map((v) => (
            <li key={v.id} className={v.replaced ? "line-through opacity-60" : ""}>
              {DECISION[v.decision]} · claimed {MODE[v.mode_claimed]} → {MODE[v.mode_verified]} · weight {n2(v.weight_at_vote)} {v.distance_m != null && `· ${Math.round(v.distance_m)} m`} · {fmtDateTime(v.created_at)}
            </li>
          ))}
        </ul>
        <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto border-t border-line/60 pt-3 text-sm">
          {r.runs.map((s) => (
            <li key={s.id} className="num">
              {fmtDateTime(s.run_at)} · {s.trigger} · {s.status} (judging {s.judging_status}) · c {n2(s.credibility)} u {n2(s.uncertainty)} · rule {s.gates?.displayed_rule} · config {s.config_hash}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function ReportReview({ counts, refreshCounts }) {
  const { query } = useRoute();
  const [filter, setFilter] = useState(query.get("f") || "flagged");
  const [sel, setSel] = useState(null);
  const list = useData(() => api("/api/admin/reports", { query: { filter } }), [filter]);
  useEffect(() => {
    if (list.data?.length && !list.data.some((r) => r.id === sel)) setSel(list.data[0].id);
  }, [list.data]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="display text-[28px]">Report review</h1>
        <Segmented
          label="Queue"
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setSel(null);
          }}
          options={[
            { value: "flagged", label: `Flagged (${counts?.flagged_reports ?? "…"})` },
            { value: "hidden", label: `Hidden (${counts?.hidden_reports ?? "…"})` },
            { value: "abuse", label: `Abuse (${counts?.open_abuse ?? "…"})` },
          ]}
        />
      </div>
      <div className="mt-5 grid gap-6 xl:grid-cols-[5fr_7fr]">
        <div className="min-w-0">
          {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
          {list.loading && <Skeleton className="h-64 rounded-2xl" />}
          {list.data?.length === 0 && <p className="rounded-2xl border border-line bg-white p-6 text-center text-[15px]">Nothing in this queue.</p>}
          {list.data?.length > 0 && (
            <Table head={["Report", "Category", "Flags", "Posted"]}>
              {list.data.map((r) => (
                <Row key={r.id} selected={r.id === sel} onClick={() => setSel(r.id)}>
                  <td className="num px-3 py-3 font-extrabold">
                    {shortId(r.id)} {r.is_seed && <DemoBadge />}
                  </td>
                  <td className="px-3 py-3">{r.type === "civic" ? r.category?.name_en : "Price"}</td>
                  <td className="px-3 py-3">
                    {flagText(r)}
                    {r.open_abuse ? <span className="block text-sm font-bold text-err">{r.open_abuse} abuse report(s)</span> : null}
                  </td>
                  <td className="px-3 py-3 text-primary">{fmtRelDay(r.submitted_at)}</td>
                </Row>
              ))}
            </Table>
          )}
        </div>
        <div className="min-w-0">
          {sel ? (
            <ReportDetail
              key={sel}
              id={sel}
              onChanged={() => {
                list.reload();
                refreshCounts();
              }}
            />
          ) : (
            list.data?.length > 0 && <Skeleton className="h-96 rounded-2xl" />
          )}
        </div>
      </div>
    </>
  );
}

// ---------- collusion alerts ----------

function AlertDetail({ id, onSolved }) {
  const { toast } = useApp();
  const { data, error } = useData(() => api(`/api/admin/alerts/${id}`), [id]);
  const [outcome, setOutcome] = useState("false_alarm");
  if (error) return <ErrorState error={error} title="Couldn't open the alert" />;
  if (!data) return <Skeleton className="h-80 rounded-2xl" />;
  return (
    <div className="space-y-4">
      <h2 className="display text-xl">{data.kind === "pair_agreement" ? "Pair agreement (possible vote ring)" : "Device rule violation"}</h2>
      <section className="rounded-2xl border border-line bg-white p-4">
        <h3 className="font-bold">Accounts</h3>
        <ul className="mt-2 space-y-1 text-[15px]">
          {data.users.map(
            (u) =>
              u && (
                <li key={u.id}>
                  <Link to={`/admin/users/${u.id}`} className="font-bold underline">
                    {u.display_name || "deleted"}
                  </Link>{" "}
                  {u.is_seed && <DemoBadge />} · {u.state} · reputation {n2(u.rep)} (u {n2(u.rep_uncertainty)}) · {u.devices} device(s)
                </li>
              ),
          )}
        </ul>
        <h3 className="mt-4 font-bold">Signals</h3>
        <pre className="mt-1 overflow-x-auto rounded-lg bg-bg p-3 text-sm">{JSON.stringify(data.signals, null, 2)}</pre>
      </section>
      {data.votes.length > 0 && (
        <Table head={["Report", "Voter", "Decision", "Mode", "Time"]}>
          {data.votes.map((v, i) => (
            <tr key={i} className="border-b border-line/60 last:border-b-0">
              <td className="num px-3 py-2">{shortId(v.report_id)}</td>
              <td className="num px-3 py-2">{shortId(v.voter_id)}</td>
              <td className="px-3 py-2">{DECISION[v.decision]}</td>
              <td className="px-3 py-2">{MODE[v.mode_verified]}</td>
              <td className="px-3 py-2">{fmtDateTime(v.created_at)}</td>
            </tr>
          ))}
        </Table>
      )}
      {data.status === "open" ? (
        <>
          <label className="block">
            <span className="font-bold">Outcome</span>
            <Select className="mt-2 max-w-xs" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="false_alarm">False alarm</option>
              <option value="collusion_confirmed">Collusion confirmed</option>
            </Select>
          </label>
          <ReasonBox
            label="Mark solved"
            placeholder="What did you find?"
            note="No score or reputation changes automatically (P5)."
            action={(note) => api(`/api/admin/alerts/${id}/solve`, { method: "POST", body: { outcome, note } })}
            onDone={() => {
              toast("Alert solved.", "ok");
              onSolved();
            }}
          />
        </>
      ) : (
        <p className="rounded-xl bg-white p-4 text-[15px]">
          Solved: <b>{data.outcome?.replace("_", " ")}</b>. Note: {data.note}
        </p>
      )}
    </div>
  );
}

function CollusionAlerts({ refreshCounts }) {
  const [status, setStatus] = useState("open");
  const [sel, setSel] = useState(null);
  const list = useData(() => api("/api/admin/alerts", { query: { status } }), [status]);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="display text-[28px]">Collusion alerts</h1>
        <Segmented label="Alert status" value={status} onChange={(v) => { setStatus(v); setSel(null); }} options={[{ value: "open", label: "Open" }, { value: "solved", label: "Solved" }]} />
      </div>
      <div className="mt-5 grid gap-6 xl:grid-cols-[5fr_7fr]">
        <div className="min-w-0">
          {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
          {list.data?.length === 0 && <p className="rounded-2xl border border-line bg-white p-6 text-center text-[15px]">No alerts here.</p>}
          {list.data?.length > 0 && (
            <Table head={["Alert", "Accounts", "Reports", "Raised"]}>
              {list.data.map((a) => (
                <Row key={a.id} selected={a.id === sel} onClick={() => setSel(a.id)}>
                  <td className="px-3 py-3 font-bold">{a.kind === "pair_agreement" ? "Pair agreement" : "Device rule"}</td>
                  <td className="num px-3 py-3">{a.user_ids.length}</td>
                  <td className="num px-3 py-3">{a.report_ids.length}</td>
                  <td className="px-3 py-3 text-primary">{fmtRelDay(a.created_at)}</td>
                </Row>
              ))}
            </Table>
          )}
        </div>
        <div className="min-w-0">
          {sel && (
            <AlertDetail
              key={sel}
              id={sel}
              onSolved={() => {
                list.reload();
                refreshCounts();
                setSel(null);
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}

// ---------- accounts ----------

function Accounts() {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const list = useData(() => api("/api/admin/users", { query: { q: search } }), [search]);
  return (
    <>
      <h1 className="display text-[28px]">Accounts</h1>
      <form
        className="mt-4 flex max-w-xl gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q);
        }}
      >
        <input className={inputCls} type="search" placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search accounts" />
        <Button>Search</Button>
      </form>
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      <Table className="mt-4" head={["Name", "Phone", "Role", "State", "Reputation", "Uncertainty", "Devices"]}>
        {(list.data || []).map((u) => (
          <Row key={u.id} onClick={() => navigate(`/admin/users/${u.id}`)}>
            <td className="px-3 py-2.5 font-bold">
              {u.display_name} {u.is_seed && <DemoBadge />}
            </td>
            <td className="num px-3 py-2.5">{u.phone || "—"}</td>
            <td className="px-3 py-2.5">{u.role}</td>
            <td className="px-3 py-2.5">{u.state}</td>
            <td className="num px-3 py-2.5">{n2(u.rep)}</td>
            <td className="num px-3 py-2.5">{n2(u.rep_uncertainty)}</td>
            <td className="num px-3 py-2.5">{u.devices}</td>
          </Row>
        ))}
      </Table>
    </>
  );
}

function UserPage({ id }) {
  const { toast } = useApp();
  const { data: u, error, reload } = useData(() => api(`/api/admin/users/${id}`), [id]);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!u) return <Skeleton className="h-60 rounded-2xl" />;
  const suspended = u.state === "suspended";
  return (
    <div className="max-w-4xl space-y-5">
      <button onClick={() => navigate("/admin/users")} className="min-h-11 font-bold underline">
        ← All accounts
      </button>
      <div>
        <h1 className="display text-[28px]">
          {u.display_name || "deleted"} {u.is_seed && <DemoBadge />}
        </h1>
        <p className="num mt-1 text-[15px] text-primary">
          {u.phone || "no phone"} · {u.role} · {u.state} · reputation {n2(u.rep)} (α {n2(u.alpha)}, β {n2(u.beta)}, u {n2(u.rep_uncertainty)}) · {u.devices} device(s) · since {fmtDateTime(u.created_at)}
        </p>
      </div>
      {u.role === "citizen" && (
        <ReasonBox
          label={suspended ? "Reinstate" : "Suspend"}
          kind={suspended ? "primary" : "danger"}
          placeholder={suspended ? "Why are you reinstating this account?" : "Why are you suspending this account?"}
          note="Suspending blocks login and new actions; old reports and votes stay (W3)."
          action={(reason) => api(`/api/admin/users/${id}/${suspended ? "reinstate" : "suspend"}`, { method: "POST", body: { reason } })}
          onDone={() => {
            toast("Saved.", "ok");
            reload();
          }}
        />
      )}
      <Table head={["Report", "Status", "Posted"]}>
        {u.reports.map((r) => (
          <tr key={r.id} className="border-b border-line/60 last:border-b-0">
            <td className="px-3 py-2">
              {shortId(r.id)} · {r.type === "civic" ? r.category?.name_en : "Price"}
            </td>
            <td className="px-3 py-2">{r.results && <StatusChip status={r.results.status} size="sm" />}</td>
            <td className="px-3 py-2">{fmtDateTime(r.submitted_at)}</td>
          </tr>
        ))}
      </Table>
      <details className="rounded-2xl border border-line bg-white p-4">
        <summary className="cursor-pointer font-bold">Reputation events ({u.reputation_events.length}) and moderation history ({u.moderation.length})</summary>
        <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto text-sm">
          {u.reputation_events.map((e, i) => (
            <li key={i} className={cx("num", e.superseded && "line-through opacity-60")}>
              {e.kind} · Δα {e.d_alpha} · Δβ {e.d_beta} · {fmtDateTime(e.occurred_at)}
            </li>
          ))}
        </ul>
        <ul className="mt-3 space-y-1 border-t border-line/60 pt-3 text-sm">
          {u.moderation.length === 0 ? (
            <li>No moderation actions.</li>
          ) : (
            u.moderation.map((m, i) => (
              <li key={i}>
                {m.action} · {m.reason} · {fmtDateTime(m.created_at)}
              </li>
            ))
          )}
        </ul>
      </details>
    </div>
  );
}

// ---------- audit log ----------

function Audit() {
  const [f, setF] = useState({ entity: "", action: "", from: "", to: "" });
  const [applied, setApplied] = useState(f);
  const list = useData(() => api("/api/admin/audit", { query: applied }), [applied]);
  return (
    <>
      <h1 className="display text-[28px]">Audit log</h1>
      <p className="mt-1 text-[15px] text-primary">Append-only. Every admin action, with who, when and why.</p>
      <form
        className="mt-4 grid gap-2 sm:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(f);
        }}
      >
        <input className={inputCls} placeholder="Entity (report, user…)" value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })} aria-label="Entity" />
        <input className={inputCls} placeholder="Action (report.hide…)" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} aria-label="Action" />
        <input type="date" className={inputCls} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="From" />
        <input type="date" className={inputCls} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="To" />
        <Button>Filter</Button>
      </form>
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      <Table className="mt-4" head={["Time", "Actor", "Action", "Entity", "Reason"]}>
        {(list.data || []).map((a) => (
          <tr key={a.id} className="border-b border-line/60 align-top last:border-b-0">
            <td className="whitespace-nowrap px-3 py-2">{fmtDateTime(a.created_at)}</td>
            <td className="num px-3 py-2">{a.actor_id ? shortId(a.actor_id) : "system"}</td>
            <td className="px-3 py-2 font-bold">{a.action}</td>
            <td className="num px-3 py-2">
              {a.entity} {a.entity_id ? shortId(a.entity_id) : ""}
            </td>
            <td className="px-3 py-2">{a.reason}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}

// ---------- frame ----------

const NAV = [
  ["/admin/alerts", "Collusion alerts", "open_alerts"],
  ["/admin/reports", "Report review", "flagged_reports"],
  ["/admin/users", "Accounts", null],
  ["/admin/audit", "Audit log", null],
];

export default function Admin() {
  const { path } = useRoute();
  const { user, signOut } = useApp();
  const counts = useData(() => api("/api/admin/overview"), []);
  if (user?.role !== "admin")
    return (
      <div data-module="shell" className="grid min-h-dvh place-items-center bg-bg p-6 text-center">
        <p className="display text-xl">Admins only.</p>
      </div>
    );
  const userId = path.startsWith("/admin/users/") ? path.split("/")[3] : null;
  const section = userId ? "/admin/users" : NAV.find(([to]) => path.startsWith(to))?.[0] || "/admin/reports";
  return (
    <div data-module="shell" className="min-h-dvh bg-bg text-ink lg:grid lg:grid-cols-[264px_1fr]">
      <aside className="flex flex-col bg-ink text-white lg:sticky lg:top-0 lg:h-dvh">
        <div className="flex items-center gap-3 px-5 py-5">
          <Logo size="sm" />
          <span className="display text-lg">Admin</span>
        </div>
        <nav aria-label="Admin" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible">
          {NAV.map(([to, label, key]) => {
            const on = section === to;
            const n = key ? counts.data?.[key] : null;
            return (
              <Link key={to} to={to} aria-current={on ? "page" : undefined} className={cx("flex min-h-12 shrink-0 items-center justify-between gap-3 rounded-xl px-3.5 font-bold", on ? "bg-primary text-white" : "text-white/90 hover:bg-white/10")}>
                {label}
                {n ? <span className="num grid h-6 min-w-6 place-items-center rounded-full bg-err px-1.5 text-[13px]">{n}</span> : null}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-2 px-5 pb-4 text-sm text-white/80 lg:mt-auto lg:py-5">
          <p>
            Signed in as {user.display_name || "admin"}. Session ends after 1 day.
          </p>
          <button
            className="min-h-11 font-bold text-white underline"
            onClick={async () => {
              await signOut();
              navigate("/login", { replace: true });
            }}
          >
            Log out
          </button>
        </div>
      </aside>
      <div>
        <OfflineBanner />
        <main className="mx-auto max-w-[1180px] px-5 py-6 lg:px-8 lg:py-7">
          {section === "/admin/alerts" && <CollusionAlerts refreshCounts={counts.reload} />}
          {section === "/admin/reports" && <ReportReview counts={counts.data} refreshCounts={counts.reload} />}
          {section === "/admin/users" && (userId ? <UserPage id={userId} /> : <Accounts />)}
          {section === "/admin/audit" && <Audit />}
        </main>
      </div>
      <Toasts />
    </div>
  );
}
