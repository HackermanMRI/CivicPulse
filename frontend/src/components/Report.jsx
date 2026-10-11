// Feed card, report pop-up and vote flow (boards: Green Guard feed, Report pop-up; W3, W4, T3, T4, V2–V9).
// The server decides what a viewer may see: before a vote there is no `results` object at all, so this file only
// renders what it is given. The card shows the reporter's name before the vote (UI decision); reputation, status,
// scores, votes and verification photos appear after it.
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { COMPONENT, DECISION, DECISION_PAST, MODE, MODE_SHORT, ago, fmtLongStamp, fmtStamp, fmtTime, initials } from "../lib/format.js";
import { getPosition } from "../lib/geo.js";
import { navigate } from "../lib/router.jsx";
import { useApp, useData } from "../lib/store.jsx";
import { Camera, ensureFreshToken } from "./Camera.jsx";
import { Icon, categoryIcon } from "./icons.jsx";
import { Avatar, Button, CloseButton, DemoBadge, Dialog, ErrorState, FlagChip, Photo, ScoreBar, Skeleton, StatusChip, cx, textareaCls } from "./ui.jsx";

// Category band ("category image" slot on the board): one shade of the Green Guard family per category.
const BAND = {
  waterlogging: "#1c3d3d",
  garbage: "#357575",
  damaged_road: "#2a5656",
  drainage: "#23494a",
  water_pollution: "#2e6262",
  deforestation: "#3a5a4c",
  streetlight: "#244848",
};

function CategoryBand({ category, at, size = "md" }) {
  return (
    <div className="relative overflow-hidden px-4 text-white" style={{ background: BAND[category?.code] || "#1c3d3d" }}>
      <Icon name={categoryIcon(category?.code)} className="pointer-events-none absolute -right-3 -top-4 size-24 text-white/10" strokeWidth={1.5} />
      <div className={cx("relative flex items-end justify-between gap-3", size === "md" ? "min-h-16 py-3" : "min-h-12 py-2")}>
        <span className="min-w-0">
          <span className="display block text-xl leading-6">{category?.name_en}</span>
          <span className="block text-[13px] text-white/75" lang="bn">
            {category?.name_bn}
          </span>
        </span>
        <span className="num shrink-0 pb-0.5 text-[13px] font-semibold text-white/90">{fmtStamp(at)}</span>
      </div>
    </div>
  );
}

function wardLine(r) {
  return r.ward?.name_en || "Outside the pilot area";
}

function ReporterRow({ r, right }) {
  const name = r.reporter?.display_name || "Reporter unavailable";
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      {r.results_visible ? <Avatar text={r.reporter?.initials || initials(name)} /> : <Avatar icon />}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-[17px] font-bold leading-6">
          <span className="truncate">{name}</span>
          {r.is_seed && <DemoBadge explain />}
        </p>
        <p className="truncate text-sm text-primary">{wardLine(r)}</p>
      </div>
      {right}
    </div>
  );
}

function ReputationSlot({ r }) {
  if (!r.results_visible)
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#e8eef0] px-3 py-1.5 text-[13px] font-semibold text-ink/85">
        <Icon name="lock" className="size-3.5" />
        Reputation after vote
      </span>
    );
  const rep = r.results.reporter?.reputation_display;
  return (
    <span className="shrink-0 text-right leading-tight">
      <span className="num block text-2xl font-extrabold text-st-high">{rep ?? "—"}</span>
      <span className="block text-xs text-ink/75">Reputation</span>
    </span>
  );
}

function Scores({ res, className }) {
  return (
    <div className={cx("grid grid-cols-[1fr_auto] items-center gap-x-4 px-4 py-3 tint", className)}>
      <div className="space-y-2">
        {[
          ["Credibility", res.credibility_display, "bg-primary"],
          ["Uncertainty", res.uncertainty_display, "bg-[#3b5f75]"],
        ].map(([label, v, color]) => (
          <div key={label} className="grid grid-cols-[6.2rem_1fr_2rem] items-center gap-2 text-sm">
            <span className="font-semibold">{label}</span>
            <ScoreBar value={v} color={color} track="bg-white" />
            <span className="num text-right font-bold">{v ?? "—"}</span>
          </div>
        ))}
      </div>
      <StatusChip status={res.status} size="sm" />
    </div>
  );
}

function VoteTiles({ votes }) {
  const cells = [
    ["on_spot", "On spot"],
    ["same_ward", "Nearby"],
    ["far_away", "Far away"],
  ];
  return (
    <div className="grid grid-cols-4 gap-2 px-4 pt-4">
      <div className="rounded-xl bg-bg px-3 py-2.5">
        <p className="text-xs font-semibold">Total</p>
        <p className="num text-lg font-extrabold">{votes.total}</p>
      </div>
      {cells.map(([m, label]) => (
        <div key={m} className="rounded-xl bg-bg px-3 py-2.5">
          <p className="text-xs font-semibold">{label}</p>
          <p className="num flex items-center gap-1 text-[15px] font-extrabold">
            <span className="text-ok">✓{votes.by_mode?.[m]?.confirm ?? 0}</span>
            <span className="text-err">✕{votes.by_mode?.[m]?.disagree ?? 0}</span>
          </p>
        </div>
      ))}
    </div>
  );
}

function YourVote({ vote }) {
  if (!vote) return null;
  const color = vote.decision === "disagree" ? "text-err" : "text-ok";
  return (
    <span className="text-[13px] font-bold">
      You voted: <span className={color}>{DECISION_PAST[vote.decision]}</span> · {MODE[vote.mode].toLowerCase()}
    </span>
  );
}

const VOTE_BUTTONS = [
  ["on_spot", "Verify on spot", "bg-primary text-white border-primary"],
  ["same_ward", "Verify nearby", "bg-soft text-ink border-primary/60"],
  ["far_away", "Verify from far away", "bg-white text-ink border-primary/60"],
];

export function ReportCard({ report, onOpen, onSaved }) {
  const { toast, online } = useApp();
  const r = report;
  async function toggleSave(e) {
    e.stopPropagation();
    try {
      const res = await api(`/api/reports/${r.id}/saved`, { method: r.saved ? "DELETE" : "PUT" });
      onSaved?.(res.saved);
      toast(res.saved ? "Pinned. Find it under Pinned Reports." : "Unpinned.", "ok");
    } catch (err) {
      toast(err.message, "error");
    }
  }
  const comments = r.results?.comments_count;
  return (
    <article className="overflow-hidden rounded-2xl border border-line/80 bg-white">
      <ReporterRow r={r} right={<ReputationSlot r={r} />} />
      <button className="block w-full text-left" onClick={() => onOpen(r)} aria-label={`Open ${r.category?.name_en} report`}>
        <CategoryBand category={r.category} at={r.submitted_at} />
        {r.results_visible && <Scores res={r.results} />}
        <p className="line-clamp-4 px-4 py-3.5 text-[17px] leading-relaxed">{r.description}</p>
        <Photo src={r.photo_url} alt={`${r.category?.name_en} photo`} className="aspect-[4/3] w-full" placeholder="Report photo" />
      </button>
      {r.results_visible ? (
        <>
          <VoteTiles votes={r.results.votes} />
          <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-3">
            {r.is_mine ? <span className="text-sm font-bold">Your report</span> : <YourVote vote={r.my_vote} />}
            <span className="text-xs text-ink/75">✓ Confirmed · ✕ Disagreed</span>
          </div>
        </>
      ) : (
        <div className="px-4 pt-3">
          <p className="text-[13px] text-primary">{online ? "Scores, votes and image verifications appear after you vote." : "Voting and posting need internet. They come back when you reconnect."}</p>
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            {VOTE_BUTTONS.map(([mode, label, cls]) => (
              <button
                key={mode}
                disabled={!online || !r.can_vote}
                onClick={() => onOpen(r, mode)}
                className={cx("min-h-[52px] rounded-xl border-[1.5px] px-2 text-[14px] font-bold leading-tight disabled:cursor-not-allowed disabled:border-transparent disabled:bg-[#dfe7e7] disabled:text-ink/50", cls)}
              >
                {online ? label : MODE_SHORT[mode]}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between px-2 pb-1 pt-1">
        <button onClick={toggleSave} aria-pressed={r.saved} aria-label={r.saved ? "Unpin" : "Pin"} className={cx("grid size-12 place-items-center rounded-xl", r.saved ? "text-primary" : "text-ink")}>
          <Icon name={r.saved ? "pinFilled" : "pin"} className="size-6" />
        </button>
        <button onClick={() => onOpen(r, null, "verifications")} className="inline-flex min-h-12 items-center gap-2 rounded-xl px-3 text-[15px] font-bold text-primary hover:bg-soft/40">
          <Icon name="camera" className="size-5" />
          See image verifications{r.results_visible && comments != null ? ` (${comments})` : ""}
        </button>
      </div>
    </article>
  );
}

// ---------- pop-up ----------

function VotesTable({ votes, myVote }) {
  const modes = ["on_spot", "same_ward", "far_away"];
  const rows = [
    ["Confirmed", "confirm", "text-ok", "✓"],
    ["Disputed", "disagree", "text-err", "✕"],
  ];
  if (votes.fixed_now) rows.push(["Fixed now", "fixed_now", "text-st-high", "✓"]);
  return (
    <div className="rounded-2xl border border-line/80 p-4">
      <h3 className="font-bold">Votes</h3>
      <table className="mt-2 w-full text-[15px]">
        <thead>
          <tr className="text-left text-sm text-primary">
            <th className="w-1/4 py-1 font-semibold">
              <span className="sr-only">Decision</span>
            </th>
            {modes.map((m) => (
              <th key={m} className="py-1 font-semibold">
                {MODE_SHORT[m]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, key, color, mark]) => (
            <tr key={key}>
              <th className="py-1 text-left font-bold">{label}</th>
              {modes.map((m) => (
                <td key={m} className={cx("num py-1 font-bold", color)}>
                  {mark} {votes.by_mode?.[m]?.[key] ?? 0}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-sm text-ink/85">
        Total <span className="num">{votes.total}</span> votes
        {myVote && (
          <>
            {" "}
            · You voted:{" "}
            <b>
              {DECISION_PAST[myVote.decision]} · {MODE[myVote.mode].toLowerCase()}
            </b>
          </>
        )}
      </p>
    </div>
  );
}

function WhyScore({ rows }) {
  return (
    <details className="group rounded-2xl border border-line/80">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 font-bold">
        Why this score?
        <Icon name="chevronDown" className="size-5 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="divide-y divide-line/50 px-4 pb-2">
        {rows.map((c) => (
          <li key={c.component} className="grid grid-cols-[1fr_auto] gap-x-3 py-2">
            <span className="font-semibold">{COMPONENT[c.component]}</span>
            <span className="num text-right font-bold">{c.availability === "unavailable" ? "Not used" : c.score_display}</span>
            <span className="col-span-2 text-sm text-ink/75">{c.explanation}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Verifications({ comments, refEl }) {
  const shown = comments.slice(0, 5);
  const more = comments.length - shown.length;
  return (
    <section ref={refEl} className="tint border-t border-line/70 px-5 py-4 md:px-7">
      <h3 className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="display text-[17px]">Image verifications</span>
        <span className="text-sm text-primary">Photos taken by people who voted on the spot</span>
      </h3>
      {comments.length === 0 ? (
        <p className="mt-2 text-[15px] text-ink/80">No on-the-spot photos yet.</p>
      ) : (
        <ul className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
          {shown.map((c, i) => (
            <li key={i}>
              <Photo src={c.photo_url} alt={`Verification photo: ${DECISION[c.decision]}`} className="aspect-[4/3] w-full rounded-xl" placeholder="" />
              <p className={cx("num mt-1.5 text-[13px] font-bold", c.decision === "disagree" ? "text-err" : "text-ok")}>
                {c.decision === "disagree" ? "✕ Disputed" : c.decision === "fixed_now" ? "✓ Fixed now" : "✓ Confirmed"} · {fmtTime(c.created_at)}
              </p>
            </li>
          ))}
          {more > 0 && (
            <li className="grid aspect-[4/3] place-items-center rounded-xl border-[1.5px] border-dashed border-line text-sm font-bold text-primary">+ {more} more</li>
          )}
        </ul>
      )}
    </section>
  );
}

function VoteFlow({ report, initialMode, onDone }) {
  const { toast, online } = useApp();
  const upgrade = Boolean(report.my_vote);
  const [mode, setMode] = useState(upgrade ? "on_spot" : initialMode || null);
  const [decision, setDecision] = useState(null);
  const [shot, setShot] = useState(null);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pulse, setPulse] = useState(false);

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
      setPulse(true); // only after a 2xx (B6)
      const vr = out.vote_result;
      if (vr.mode_verified !== vr.mode_claimed) toast(`Counted as "${MODE[vr.mode_verified]}"${vr.notes.length ? `: ${vr.notes.join(", ")}` : ""}.`, "warn");
      else toast("Vote counted. Results are open now.", "ok");
      setTimeout(() => onDone(out), 650);
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (camera)
    return (
      <div className="rounded-2xl border border-line/80 p-4">
        <Camera
          purpose="verification"
          reportId={report.id}
          onShot={(s) => {
            setShot(s);
            setCamera(false);
          }}
          onCancel={() => setCamera(false)}
        />
      </div>
    );

  const options = mode === "on_spot" ? ["confirm", "disagree", "fixed_now"] : ["confirm", "disagree"];
  const ready = online && mode && decision && (mode !== "on_spot" || shot);
  return (
    <section className="space-y-4 rounded-2xl border border-line/80 p-4">
      <div>
        <h3 className="font-bold">{upgrade ? "Add an on-the-spot vote" : "Your vote"}</h3>
        <p className="text-sm text-primary">{upgrade ? "You can upgrade once, with a new photo taken within 100 m." : "Scores, votes and image verifications appear after you vote."}</p>
      </div>
      {!upgrade && (
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Where are you?">
          {VOTE_BUTTONS.map(([m, label]) => (
            <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={cx("min-h-[52px] rounded-xl border-[1.5px] px-2 text-[14px] font-bold leading-tight", mode === m ? "border-primary bg-primary text-white" : "border-primary/50 bg-white text-ink")}>
              {label}
            </button>
          ))}
        </div>
      )}
      {mode && (
        <p className="text-sm text-ink/80">
          {mode === "on_spot" && "Within 100 m, with a new photo. Counts the most."}
          {mode === "same_ward" && "In the same ward. Your location is checked, then only the result is kept."}
          {mode === "far_away" && "From anywhere. Counts the least."}
        </p>
      )}
      {mode && (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What do you see?">
          {options.map((d) => (
            <button key={d} role="radio" aria-checked={decision === d} onClick={() => setDecision(d)} className={cx("min-h-11 rounded-full border-[1.5px] px-4 text-[15px] font-bold", decision === d ? "border-ink bg-ink text-white" : "border-line bg-white")}>
              {DECISION[d]}
            </button>
          ))}
        </div>
      )}
      {mode === "on_spot" && (
        <div className="flex items-center gap-3">
          {shot && <img src={shot.url} alt="Your verification photo" className="size-16 rounded-lg object-cover" />}
          <Button kind="line" size="sm" icon="camera" onClick={() => setCamera(true)}>
            {shot ? "Retake photo" : "Take a photo"}
          </Button>
        </div>
      )}
      <span className={cx("relative inline-flex w-full", pulse && "cp-pulse")}>
        <Button className="w-full" onClick={submit} disabled={!ready} busy={busy} busyLabel="Sending…">
          Send vote
        </Button>
      </span>
      {!online && <p className="text-sm text-ink/80">Voting needs internet. It comes back when you reconnect.</p>}
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
      <label htmlFor="abuse" className="block text-[15px] font-bold">
        What is wrong with this post?
      </label>
      <textarea id="abuse" className={textareaCls()} rows={3} minLength={5} maxLength={500} required value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <Button kind="danger" size="sm" busy={busy}>
          Send to admins
        </Button>
        <Button type="button" kind="line" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ReportDialog({ id, initialMode, focus, onClose, onChanged }) {
  const { toast } = useApp();
  const { data: r, error, loading, reload, setData } = useData(() => (id ? api(`/api/reports/${id}`) : Promise.resolve(null)), [id]);
  const [abuse, setAbuse] = useState(false);
  const stripRef = useRef(null);
  const update = (next) => {
    setData(next);
    onChanged?.(next);
  };
  async function togglePin() {
    try {
      const res = await api(`/api/reports/${r.id}/saved`, { method: r.saved ? "DELETE" : "PUT" });
      update({ ...r, saved: res.saved });
    } catch (e) {
      toast(e.message, "error");
    }
  }
  useEffect(() => {
    if (focus !== "verifications" || !r) return undefined;
    const t = setTimeout(() => stripRef.current?.scrollIntoView({ block: "start" }), 60);
    return () => clearTimeout(t);
  }, [focus, r?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const res = r?.results;
  const image = res?.components?.find((c) => c.component === "image" && c.availability !== "unavailable");
  const comments = res?.comments || [];
  return (
    <Dialog open={Boolean(id)} onClose={onClose} title={r ? `${r.category?.name_en || "Price"} report` : "Report"} size="xl" bare>
      <div className="relative flex max-h-[inherit] flex-col overflow-y-auto">
        {loading && (
          <div className="grid gap-6 p-6 md:grid-cols-2">
            <Skeleton className="aspect-[4/3] w-full" />
            <div className="space-y-3">
              <Skeleton className="h-10 w-2/3" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          </div>
        )}
        {error && (
          <div className="p-6">
            <div className="flex justify-end">
              <CloseButton onClick={onClose} />
            </div>
            <ErrorState error={error} onRetry={reload} title="Couldn't open this report" />
          </div>
        )}
        {r && (
          <>
            <div className="grid md:grid-cols-2">
              <Photo src={r.photo_url} alt="Report photo" className="aspect-[4/3] w-full md:aspect-auto md:min-h-[560px]" placeholder="Reporter's photo">
                <span className="num absolute bottom-4 left-4 rounded-full bg-ink/90 px-3 py-1.5 text-[13px] font-bold text-white">Taken {fmtLongStamp(r.submitted_at)}</span>
                {image && (
                  <span className="num absolute bottom-4 right-4 rounded-full bg-white px-3 py-1.5 text-[13px] font-bold text-ink shadow-1">
                    {image.score_display >= 50 ? "Image matches category" : "Image may not match"} · {image.score_display}
                  </span>
                )}
                {r.is_seed && <DemoBadge explain className="absolute left-4 top-4" />}
              </Photo>
              <div className="flex flex-col gap-4 p-5 md:p-6">
                <div className="flex items-start gap-3">
                  <Avatar text={r.reporter?.initials || initials(r.reporter?.display_name)} className="size-12" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[17px] font-bold">{r.reporter?.display_name || "Reporter unavailable"}</p>
                    <p className="text-sm text-primary">
                      {wardLine(r)} · {ago(r.submitted_at)}
                    </p>
                  </div>
                  {res?.reporter?.reputation_display != null && <span className="num shrink-0 rounded-full bg-info-soft px-3 py-1.5 text-sm font-bold text-st-high">Reputation {res.reporter.reputation_display}</span>}
                  <CloseButton onClick={onClose} />
                </div>
                <div className="tint flex flex-wrap items-center gap-3 rounded-2xl border border-line/80 px-4 py-3">
                  <Icon name={categoryIcon(r.category?.code)} className="size-6 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="display text-lg">{r.category?.name_en}</span>{" "}
                    <span className="text-sm text-ink/70" lang="bn">
                      {r.category?.name_bn}
                    </span>
                  </span>
                  {res ? <StatusChip status={res.status} /> : <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink/80"><Icon name="lock" className="size-4" />Status after vote</span>}
                </div>
                {res && (
                  <div className="grid grid-cols-2 gap-5">
                    {[
                      ["Credibility", res.credibility_display, "bg-primary"],
                      ["Uncertainty", res.uncertainty_display, "bg-warn"],
                    ].map(([label, v, color]) => (
                      <div key={label}>
                        <p className="flex justify-between text-[15px] font-bold">
                          {label} <span className="num">{v ?? "—"}</span>
                        </p>
                        <ScoreBar value={v} color={color} className="mt-1.5 h-2.5" />
                      </div>
                    ))}
                  </div>
                )}
                {res?.flags?.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {res.resolved && <span className="rounded-full bg-ok px-3 py-1 text-sm font-bold text-white">Resolved</span>}
                    {res.flags.map((f) => (
                      <FlagChip key={f.code} flag={f} />
                    ))}
                  </div>
                )}
                {r.description && <p className="whitespace-pre-line text-[17px] leading-relaxed">{r.description}</p>}
                <p className="text-sm text-primary">
                  Location: {wardLine(r)}
                  {r.gps_accuracy_m != null && <span className="num"> · GPS ± {Math.round(r.gps_accuracy_m)} m</span>}
                </p>
                {r.visibility && r.visibility !== "visible" && <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm font-medium text-warn-ink">This report is hidden from others ({r.visibility.replace("_", " ")}).</p>}
                {res && r.type === "civic" && <VotesTable votes={res.votes} myVote={r.my_vote} />}
                {res?.components?.length > 0 && <WhyScore rows={res.components} />}
                {!res && !r.can_vote && <p className="tint rounded-xl px-4 py-3 text-[15px] font-medium">Results open after you vote, so everyone judges for themselves.</p>}
                {r.can_vote && <VoteFlow report={r} initialMode={initialMode} onDone={update} />}
                <div className="mt-auto flex flex-wrap items-center gap-2.5 pt-2">
                  <Button kind={r.saved ? "primary" : "line"} size="sm" icon={r.saved ? "pinFilled" : "pin"} onClick={togglePin} aria-pressed={r.saved}>
                    {r.saved ? "Pinned" : "Pin"}
                  </Button>
                  {r.location && (
                    <Button kind="line" size="sm" onClick={() => navigate(`/gg/dashboard?lat=${r.location.lat}&lon=${r.location.lon}`)}>
                      Show on map
                    </Button>
                  )}
                  {res && (
                    <Button kind="line" size="sm" onClick={() => stripRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                      Comments ({comments.length})
                    </Button>
                  )}
                  {!r.is_mine && !abuse && (
                    <Button kind="dangerText" className="ml-auto font-bold" onClick={() => setAbuse(true)}>
                      Report abuse
                    </Button>
                  )}
                </div>
                {abuse && <AbuseForm id={r.id} onDone={() => setAbuse(false)} />}
              </div>
            </div>
            {res ? (
              <Verifications comments={comments} refEl={stripRef} />
            ) : (
              <section ref={stripRef} className="tint flex items-center gap-2 border-t border-line/70 px-5 py-4 text-[15px] md:px-7">
                <Icon name="lock" className="size-4" /> Image verifications appear after you vote.
              </section>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
