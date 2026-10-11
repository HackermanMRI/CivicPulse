// Feed card, report pop-up and vote flow (W3, W4, T3, T4, V2–V9). The server decides what a viewer may see;
// this file only renders what it is given (blind view = no results object at all).
import { useState } from "react";
import { api } from "../lib/api.js";
import { COMPONENT, DECISION, MODE, ago, fmtDateTime } from "../lib/format.js";
import { getPosition } from "../lib/geo.js";
import { useApp, useData } from "../lib/store.jsx";
import { Camera, ensureFreshToken } from "./Camera.jsx";
import { Button, Card, DemoBadge, Dialog, ErrorState, FlagChip, Photo, Score, Skeleton, StatusChip, cx, inputCls } from "./ui.jsx";

export function VoteBars({ votes, animate = true }) {
  const total = Math.max(1, votes.confirm + votes.disagree + votes.fixed_now);
  const rows = [
    ["Issue confirmed", votes.confirm, "bg-st-high"],
    ["Disagree", votes.disagree, "bg-st-low"],
    ["Fixed now", votes.fixed_now, "bg-ok"],
  ];
  return (
    <div className="space-y-1.5">
      {rows.map(([label, n, color]) => (
        <div key={label} className="grid grid-cols-[8.5rem_1fr_2rem] items-center gap-2 text-sm">
          <span>{label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-soft">
            <span className={cx("block h-full rounded-full", color, animate && "cp-bar")} style={{ width: `${(100 * n) / total}%` }} />
          </span>
          <span className="num text-right font-semibold">{n}</span>
        </div>
      ))}
      <p className="text-xs text-ink/65">
        {votes.on_spot} on the spot · {votes.same_ward} nearby · {votes.far_away} far away
      </p>
    </div>
  );
}

export function ReportCard({ report, onOpen, onSaved }) {
  const { toast } = useApp();
  const r = report;
  async function toggleSave(e) {
    e.stopPropagation();
    try {
      const res = await api(`/api/reports/${r.id}/saved`, { method: r.saved ? "DELETE" : "PUT" });
      onSaved?.(res.saved);
      toast(res.saved ? "Pinned. Find it under Profile → Pinned." : "Unpinned.", "ok");
    } catch (err) {
      toast(err.message, "error");
    }
  }
  return (
    <Card className="overflow-hidden">
      <button className="block w-full text-left" onClick={() => onOpen(r)} aria-label={`Open ${r.category?.name_en} report`}>
        <Photo src={r.photo_url} alt={`${r.category?.name_en} photo`} className="h-52 w-full" />
        <div className="space-y-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{r.category?.name_en}</span>
            <span className="text-ink/60" lang="bn">
              {r.category?.name_bn}
            </span>
            {r.is_seed && <DemoBadge />}
            {r.is_mine && <span className="rounded-full bg-soft px-2 text-xs font-semibold">Your report</span>}
          </div>
          <p className="line-clamp-3 text-ink/90">{r.description}</p>
          <p className="text-sm text-ink/65">
            {r.ward?.name_en || "Outside the pilot area"} · <time dateTime={r.submitted_at}>{ago(r.submitted_at)}</time>
          </p>
          {r.results_visible ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <StatusChip status={r.results.status} />
              <span className="num text-sm">
                Credibility <b>{r.results.credibility_display}</b> · Uncertainty <b>{r.results.uncertainty_display}</b>
              </span>
              {r.results.resolved && <span className="rounded-full bg-ok px-2.5 py-0.5 text-sm font-semibold text-white">Resolved</span>}
            </div>
          ) : (
            <p className="rounded-md bg-soft/60 px-3 py-2 text-sm font-medium">Vote to see how credible this report is.</p>
          )}
        </div>
      </button>
      <div className="flex items-center justify-between border-t border-line/50 px-4 py-2">
        <span className="text-sm text-ink/65">{r.my_vote ? `You voted: ${DECISION[r.my_vote.decision]} (${MODE[r.my_vote.mode]})` : ""}</span>
        <button className="min-h-11 rounded-md px-3 text-sm font-semibold text-primary hover:bg-soft/60" onClick={toggleSave} aria-pressed={r.saved}>
          {r.saved ? "Pinned ★" : "Pin ☆"}
        </button>
      </div>
    </Card>
  );
}

function Components({ rows }) {
  return (
    <ul className="divide-y divide-line/50">
      {rows.map((c) => (
        <li key={c.component} className="grid grid-cols-[1fr_auto] gap-x-3 py-2">
          <span className="font-semibold">{COMPONENT[c.component]}</span>
          <span className="num text-right font-semibold">{c.availability === "unavailable" ? "Not used" : c.score_display}</span>
          <span className="col-span-2 text-sm text-ink/70">{c.explanation}</span>
        </li>
      ))}
    </ul>
  );
}

function Results({ r }) {
  const res = r.results;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={res.status} />
        {res.resolved && <span className="rounded-full bg-ok px-2.5 py-0.5 text-sm font-semibold text-white">Resolved</span>}
        {res.flags.map((f) => (
          <FlagChip key={f.code} flag={f} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Score label="Credibility" value={res.credibility_display} hint="0–100" />
        <Score label="Uncertainty" value={res.uncertainty_display} hint="lower is surer" />
        <Score label="Evidence used" value={`${res.components_used}/7`} />
      </div>
      {r.type === "civic" && (
        <div>
          <h3 className="mb-2 font-semibold">Community votes</h3>
          <VoteBars votes={res.votes} />
        </div>
      )}
      {res.components?.length > 0 && (
        <details className="rounded-md border border-line/60 px-3 py-2">
          <summary className="min-h-11 cursor-pointer content-center font-semibold">Why this score?</summary>
          <Components rows={res.components} />
        </details>
      )}
      {res.comments?.length > 0 && (
        <div>
          <h3 className="mb-2 font-semibold">On-the-spot photos</h3>
          <div className="grid grid-cols-3 gap-2">
            {res.comments.map((c, i) => (
              <figure key={i} className="overflow-hidden rounded-md border border-line/60">
                <Photo src={c.photo_url} alt={`Verification photo: ${DECISION[c.decision]}`} className="aspect-square w-full" />
                <figcaption className="px-2 py-1 text-xs font-semibold">{DECISION[c.decision]}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
      {res.reporter && (
        <p className="text-sm text-ink/70">
          Reported by {res.reporter.display_name || "reporter unavailable"}
          {res.reporter.reputation_display != null && <> · reputation {res.reporter.reputation_display}</>}
        </p>
      )}
    </section>
  );
}

function VoteFlow({ report, onDone }) {
  const { toast } = useApp();
  const [mode, setMode] = useState(report.my_vote ? "on_spot" : null);
  const [decision, setDecision] = useState(null);
  const [shot, setShot] = useState(null);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pulse, setPulse] = useState(false);
  const upgrade = Boolean(report.my_vote);

  async function submit() {
    setBusy(true);
    try {
      let pos = null;
      if (mode !== "far_away") pos = await getPosition();
      const token = mode === "on_spot" ? await ensureFreshToken(shot) : null;
      const out = await api(`/api/reports/${report.id}/votes`, {
        method: "POST",
        form: { decision, mode, lat: pos?.lat, lon: pos?.lon, accuracy: pos?.accuracy, capture_token: token, photo: mode === "on_spot" ? shot.blob : null },
      });
      setPulse(true);
      const vr = out.vote_result;
      if (vr.mode_verified !== vr.mode_claimed)
        toast(`Counted as "${MODE[vr.mode_verified]}"${vr.notes.length ? `: ${vr.notes.join(", ")}` : ""}.`, "warn");
      else toast("Thanks, your vote counts.", "ok");
      setTimeout(() => onDone(out), 650);
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (camera)
    return (
      <Camera
        purpose="verification"
        reportId={report.id}
        onShot={(s) => {
          setShot(s);
          setCamera(false);
        }}
        onCancel={() => setCamera(false)}
      />
    );

  const modes = upgrade ? ["on_spot"] : ["on_spot", "same_ward", "far_away"];
  const options = mode === "on_spot" ? ["confirm", "disagree", "fixed_now"] : ["confirm", "disagree"];
  const ready = mode && decision && (mode !== "on_spot" || shot);
  return (
    <section className="space-y-4 rounded-lg bg-soft/40 p-4">
      <h3 className="text-lg font-semibold">{upgrade ? "Upgrade to an on-the-spot vote" : "Your vote"}</h3>
      <fieldset className="space-y-2">
        <legend className="mb-1 font-semibold">Where are you?</legend>
        {modes.map((m) => (
          <label key={m} className={cx("flex min-h-12 cursor-pointer items-start gap-3 rounded-md border-2 bg-white px-3 py-2", mode === m ? "border-primary" : "border-line/60")}>
            <input type="radio" name="mode" className="mt-1.5 size-4 accent-[var(--primary)]" checked={mode === m} onChange={() => setMode(m)} />
            <span>
              <span className="block font-semibold">{MODE[m]}</span>
              <span className="block text-sm text-ink/70">
                {m === "on_spot" && "Within 100 m, with a new photo. Counts the most."}
                {m === "same_ward" && "In the same ward. Your location is checked, then only the result is kept."}
                {m === "far_away" && "Anywhere. Counts the least."}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {mode && (
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-1 w-full font-semibold">What do you see?</legend>
          {options.map((d) => (
            <button key={d} onClick={() => setDecision(d)} aria-pressed={decision === d} className={cx("min-h-11 rounded-full border-2 px-4 font-semibold", decision === d ? "border-primary bg-primary text-white" : "border-line bg-white")}>
              {DECISION[d]}
            </button>
          ))}
        </fieldset>
      )}
      {mode === "on_spot" && (
        <div className="flex items-center gap-3">
          {shot ? <img src={shot.url} alt="Verification photo" className="size-20 rounded-md object-cover" /> : null}
          <Button kind="outline" onClick={() => setCamera(true)}>
            {shot ? "Retake photo" : "Open camera"}
          </Button>
        </div>
      )}
      <div className="flex items-center gap-4">
        <span className={cx("relative inline-flex", pulse && "cp-pulse")}>
          <Button size="lg" onClick={submit} disabled={!ready} busy={busy}>
            Submit vote
          </Button>
        </span>
        <span className="text-sm text-ink/70">Results appear after you vote.</span>
      </div>
    </section>
  );
}

function AbuseForm({ id, onDone }) {
  const { toast } = useApp();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api(`/api/reports/${id}/abuse`, { method: "POST", body: { reason } });
          toast("Sent to the admins. Thank you.", "ok");
          onDone();
        } catch (err) {
          toast(err.message, "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      <textarea className={inputCls} rows={3} minLength={5} maxLength={500} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What is wrong with this post?" />
      <Button kind="danger" size="sm" busy={busy}>
        Send
      </Button>
    </form>
  );
}

export function ReportDialog({ id, onClose, onChanged }) {
  const { data: r, error, loading, reload, setData } = useData(() => (id ? api(`/api/reports/${id}`) : Promise.resolve(null)), [id]);
  const [abuse, setAbuse] = useState(false);
  return (
    <Dialog open={Boolean(id)} onClose={onClose} title={r ? `${r.category?.name_en || "Price"} report` : "Report"}>
      {loading && (
        <div className="space-y-3 p-5">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-5 w-1/2" />
        </div>
      )}
      {error && <ErrorState error={error} onRetry={reload} />}
      {r && (
        <div className="space-y-5 p-5">
          <Photo src={r.photo_url} alt="Report photo" className="max-h-96 w-full rounded-lg" />
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold">{r.category?.name_en}</span>
              <span className="text-ink/60" lang="bn">
                {r.category?.name_bn}
              </span>
              {r.is_seed && <DemoBadge />}
            </div>
            {r.price && (
              <p className="text-lg">
                <b className="num">৳{r.price.price_bdt}</b> per {r.price.commodity.unit} · {r.price.commodity.name_en} ({r.price.commodity.variant}) at {r.price.market.name_en}
              </p>
            )}
            {r.description && <p className="whitespace-pre-line">{r.description}</p>}
            <p className="text-sm text-ink/70">
              {r.ward?.name_en || "Outside the pilot area"} · {fmtDateTime(r.submitted_at)}
              {r.location && (
                <>
                  {" · "}
                  <span className="num">
                    {r.location.lat.toFixed(5)}, {r.location.lon.toFixed(5)}
                  </span>
                </>
              )}
            </p>
            {r.visibility && r.visibility !== "visible" && <p className="rounded-md bg-warn/15 px-3 py-2 text-sm font-medium text-warn-ink">This report is hidden from others ({r.visibility.replace("_", " ")}).</p>}
          </div>
          {r.results_visible ? <Results r={r} /> : <p className="rounded-md bg-soft/60 px-3 py-2 font-medium">Results are hidden until you vote, so everyone judges for themselves.</p>}
          {r.can_vote && (
            <VoteFlow
              report={r}
              onDone={(out) => {
                setData(out);
                onChanged?.(out);
              }}
            />
          )}
          {!r.is_mine && (
            <div className="border-t border-line/50 pt-3">
              {abuse ? (
                <AbuseForm id={r.id} onDone={() => setAbuse(false)} />
              ) : (
                <button className="min-h-11 text-sm font-semibold text-err underline" onClick={() => setAbuse(true)}>
                  Report abuse
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
