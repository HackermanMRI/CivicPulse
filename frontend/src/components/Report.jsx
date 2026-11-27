// Feed card, report pop-up and vote flow (boards: Green Guard feed, Report pop-up; W3, W4, T3, T4, V2–V9; UI v2).
// The server decides what a viewer may see: before a vote there is no `results` object at all, so this file only
// renders what it is given. The card shows the reporter's name before the vote (D1); reputation, status, scores,
// votes and verification photos appear after it.
// UI v2 "liveliness" uses only data a blind card already has: the category (colour), the time (live ring under
// 30 minutes) and the report location (distance from you). Nothing here hints at a result before the vote.
import { m } from "motion/react";
import { memo, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { COMPONENT, DECISION, DECISION_PAST, MODE, MODE_SHORT, ago, fmtLongStamp, fmtTime, initials } from "../lib/format.js";
import { distanceM, fmtDistance, getPosition, useMyPosition } from "../lib/geo.js";
import { REVEAL, enter, pop, spring, stagger } from "../lib/motion.js";
import { navigate } from "../lib/router.jsx";
import { useApp, useData } from "../lib/store.jsx";
import { Camera, ensureFreshToken } from "./Camera.jsx";
import { Icon, categoryIcon } from "./icons.jsx";
import { Avatar, Button, CloseButton, DemoBadge, Dialog, ErrorState, FlagChip, Photo, ScoreBar, Skeleton, StatusChip, cx, textareaCls, useNow } from "./ui.jsx";

const FRESH_MIN = 30; // a report this young gets the live ring

// Category colour as a CSS variable on the card, so the edge, glow, chip and avatar all follow it.
export const catStyle = (code) => ({ "--cat": `var(--cat-${code || "waterlogging"}, var(--primary))` });

const STATUS_RING = {
  strongly_supported: "#2a6fd6",
  supported: "#4a7fa8",
  uncertain: "#b7791f",
  not_supported: "#c0392b",
  pending: "#4a5f7a",
};

function wardLine(r) {
  return r.ward?.name_en || "Outside the pilot area";
}

function LiveChip({ at }) {
  return (
    <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-live/12 px-2.5 text-[12.5px] font-extrabold text-live-text">
      <span className="cp-live-dot" aria-hidden />
      LIVE · {ago(at)}
    </span>
  );
}

// The reporter's public profile opens only after the viewer voted (the server sends their id and photo only then).
export function profilePath(id) {
  return `${location.pathname.startsWith("/pp") ? "/pp" : "/gg"}/people/${id}`;
}

function ReporterRow({ r, fresh, right }) {
  const name = r.reporter?.display_name || "Reporter unavailable";
  const person = r.results_visible ? r.results?.reporter : null;
  return (
    <div className="flex items-center gap-3 px-4 pb-3 pt-3.5">
      <span className="relative shrink-0">
        {fresh && <span className="cp-live-ring" aria-hidden />}
        {r.results_visible ? (
          <Avatar text={r.reporter?.initials || initials(name)} src={person?.avatar_url} className="bg-cat/15 text-cat-text" />
        ) : (
          <Avatar icon className="bg-cat/15 text-cat-text" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-[16.5px] font-bold leading-6">
          {person?.id ? (
            <button onClick={() => navigate(profilePath(person.id))} className="truncate text-left underline-offset-4 hover:underline">
              {name}
            </button>
          ) : (
            <span className="truncate">{name}</span>
          )}
          {r.is_seed && <DemoBadge explain />}
        </p>
        <p className="truncate text-[13.5px] text-muted">
          {wardLine(r)}
          {!fresh && ` · ${ago(r.submitted_at)}`}
        </p>
      </div>
      {right}
    </div>
  );
}

function Reputation({ r }) {
  const rep = r.results?.reporter?.reputation_display;
  return (
    <m.span className="shrink-0 text-right leading-tight" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={enter()}>
      <span className="num block text-[22px] font-extrabold text-st-high">{rep ?? "—"}</span>
      <span className="block text-[11.5px] text-muted">Reputation</span>
    </m.span>
  );
}

function CategoryChip({ category }) {
  return (
    <span className="absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-2xl bg-cat py-1.5 pl-1.5 pr-3 text-white shadow-[0_8px_18px_-6px_rgb(0_0_0/0.45)]">
      <span className="grid size-7 place-items-center rounded-[10px] bg-white/20">
        <Icon name={categoryIcon(category?.code)} className="size-4" strokeWidth={2.4} />
      </span>
      <span className="leading-none">
        <span className="display block text-[15.5px]">{category?.name_en}</span>
        <span className="mt-0.5 block text-[11.5px] text-white/90" lang="bn">
          {category?.name_bn}
        </span>
      </span>
    </span>
  );
}

// Credibility ring: sweeps to its value once (B6). The number is shown straight away and never counts up.
export function ScoreRing({ value, status, size = 64, delay = REVEAL.ring, color, stroke = 7, textClass = "text-[21px]" }) {
  const r = (size - stroke - 2) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-ink/10" />
        <m.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color || STATUS_RING[status] || STATUS_RING.pending}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - v / 100) }}
          transition={{ duration: REVEAL.ringDuration, ease: [0.2, 0, 0, 1], delay }}
        />
      </svg>
      <span className={cx("num absolute font-extrabold", textClass)}>{value ?? "—"}</span>
    </span>
  );
}

function Results({ r, onWhy }) {
  const res = r.results;
  return (
    <m.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={enter()}>
      <div className="cp-shine mx-3 mt-3 flex items-center gap-3.5 rounded-2xl bg-st-high/8 px-3.5 py-3">
        <ScoreRing value={res.credibility_display} status={res.status} />
        <div className="min-w-0">
          <m.span className="inline-block" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...pop, delay: REVEAL.details }}>
            <StatusChip status={res.status} size="sm" />
          </m.span>
          <p className="num mt-1.5 text-[13.5px] leading-snug text-muted">
            Credibility {res.credibility_display ?? "—"} · Uncertainty {res.uncertainty_display ?? "—"}
          </p>
          <button onClick={onWhy} className="mt-0.5 min-h-8 text-[13.5px] font-bold text-primary underline-offset-4 hover:underline">
            Why this score?
          </button>
        </div>
      </div>
      <VoteTiles votes={res.votes} />
      <div className="mx-3 mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border-[1.5px] border-dashed border-primary/35 px-3 py-2">
        {r.is_mine ? <span className="text-sm font-bold">Your report</span> : <YourVote vote={r.my_vote} />}
        <span className="text-xs text-muted">✓ Confirmed · ✕ Disagreed</span>
      </div>
    </m.div>
  );
}

function VoteTiles({ votes }) {
  const cells = [
    ["on_spot", "On spot"],
    ["same_ward", "Nearby"],
    ["far_away", "Far away"],
  ];
  return (
    <div className="grid grid-cols-4 gap-2 px-3 pt-2.5">
      {[["total", "Total"], ...cells].map(([mode, label], i) => (
        <m.div
          key={mode}
          className="rounded-xl bg-ink/[0.05] px-2.5 py-2"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: REVEAL.details + i * REVEAL.step }}
        >
          <p className="text-[11.5px] font-semibold text-muted">{label}</p>
          {mode === "total" ? (
            <p className="num text-[17px] font-extrabold">{votes.total}</p>
          ) : (
            <p className="num flex items-center gap-1 text-[15px] font-extrabold">
              <span className="text-ok">✓{votes.by_mode?.[mode]?.confirm ?? 0}</span>
              <span className="text-err">✕{votes.by_mode?.[mode]?.disagree ?? 0}</span>
            </p>
          )}
        </m.div>
      ))}
    </div>
  );
}

function YourVote({ vote }) {
  if (!vote) return <span className="text-[13px] font-semibold text-muted">Results are open to you</span>;
  const color = vote.decision === "disagree" ? "text-err" : "text-ok";
  return (
    <span className="text-[13px] font-bold">
      You voted <span className={color}>{DECISION_PAST[vote.decision]}</span> · {MODE[vote.mode].toLowerCase()}
    </span>
  );
}

const VOTE_BUTTONS = [
  ["on_spot", "On the spot"],
  ["same_ward", "Nearby"],
  ["far_away", "Far away"],
];

function VoteButtons({ r, online, onOpen, near }) {
  const off = !online || !r.can_vote;
  return (
    <div className="px-3 pt-2">
      <p className="px-1 text-[14px] font-extrabold">
        {!online ? "Voting needs internet. It comes back when you reconnect." : near ? "You're nearby. Can you check it?" : "Can you check it?"}
      </p>
      <div className="mt-2 grid grid-cols-[1.3fr_1fr_1fr] gap-2">
        {VOTE_BUTTONS.map(([mode, label], i) => (
          <button
            key={mode}
            disabled={off}
            onClick={() => onOpen(r, mode)}
            className={cx(
              "press flex min-h-[52px] items-center justify-center gap-2 rounded-2xl px-2 text-[14px] font-bold leading-tight disabled:cursor-not-allowed disabled:border-transparent disabled:bg-ink/[0.07] disabled:text-ink/45 disabled:shadow-none",
              i === 0
                ? "bg-primary text-on-primary shadow-[0_8px_18px_-8px_color-mix(in_srgb,var(--primary)_85%,transparent)]"
                : "border-[1.5px] border-primary/40 bg-surface text-ink hover:bg-soft/40",
            )}
          >
            {i === 0 && !off && (
              <span className="cp-radar" aria-hidden>
                <span />
                <span />
                <span />
              </span>
            )}
            {online ? label : MODE_SHORT[mode]}
          </button>
        ))}
      </div>
      <p className="mt-2 flex items-center gap-1.5 px-1 text-[13px] text-muted">
        <Icon name="lock" className="size-3.5" />
        Scores, votes and image checks open after you vote.
      </p>
    </div>
  );
}

function PinButton({ saved, onClick }) {
  return (
    <button onClick={onClick} aria-pressed={saved} aria-label={saved ? "Unpin" : "Pin"} className={cx("press inline-flex min-h-12 items-center gap-1.5 rounded-xl px-3 text-[14px] font-bold", saved ? "text-primary" : "text-ink")}>
      <m.span key={String(saved)} initial={saved ? { scale: 0.4, rotate: -25 } : false} animate={{ scale: 1, rotate: 0 }} transition={pop} className="grid">
        <Icon name={saved ? "pinFilled" : "pin"} className="size-[22px]" />
      </m.span>
      {saved ? "Pinned" : "Pin"}
    </button>
  );
}

// Memoised: opening one report (or a live update) re-renders only the card that changed, not the whole feed.
export const ReportCard = memo(function ReportCard({ report, onOpen, onSaved, vtName }) {
  const { toast, online } = useApp();
  useNow(30000); // keeps "LIVE · 4 min ago" and "2 h ago" ticking
  const me = useMyPosition();
  const r = report;
  const fresh = Date.now() - new Date(r.submitted_at).getTime() < FRESH_MIN * 60000;
  const dist = me && r.location ? distanceM(me, r.location) : null;
  async function toggleSave(e) {
    e.stopPropagation();
    try {
      const res = await api(`/api/reports/${r.id}/saved`, { method: r.saved ? "DELETE" : "PUT" });
      onSaved?.(r, res.saved);
      toast(res.saved ? "Pinned. Find it under Pinned Reports." : "Unpinned.", "ok");
    } catch (err) {
      toast(err.message, "error");
    }
  }
  const comments = r.results?.comments_count;
  return (
    <article
      style={catStyle(r.category?.code)}
      className="relative overflow-hidden rounded-3xl border border-hair bg-surface shadow-[0_1px_2px_rgb(var(--shadow-rgb)/0.1),0_16px_36px_-18px_color-mix(in_srgb,var(--cat)_60%,transparent)]"
    >
      <span className="absolute inset-x-0 top-0 z-10 h-[3px] bg-gradient-to-r from-cat via-cat/70 to-transparent" aria-hidden />
      <ReporterRow r={r} fresh={fresh} right={r.results_visible ? <Reputation r={r} /> : fresh ? <LiveChip at={r.submitted_at} /> : null} />
      <button className="press block w-full text-left" onClick={() => onOpen(r)} aria-label={`Open ${r.category?.name_en} report`}>
        <Photo src={r.photo_url} alt={`${r.category?.name_en} photo`} className="aspect-[4/3] w-full" placeholder="Report photo" vtName={vtName} drift>
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/45 to-transparent" aria-hidden />
          <CategoryChip category={r.category} />
        </Photo>
      </button>
      <div className="flex flex-wrap gap-1.5 px-4 pt-3">
        {dist != null && (
          <span className="num inline-flex h-7 items-center gap-1 rounded-full bg-cat/12 px-2.5 text-[13px] font-bold text-cat-text">
            <Icon name="mapPin" className="size-3.5" strokeWidth={2.4} />
            {fmtDistance(dist)} from you
          </span>
        )}
        <span className="num inline-flex h-7 items-center gap-1 rounded-full bg-ink/[0.06] px-2.5 text-[13px] font-bold">
          <Icon name="clock" className="size-3.5" strokeWidth={2.4} />
          {fmtTime(r.submitted_at)}
        </span>
        {fresh && r.results_visible && <LiveChip at={r.submitted_at} />}
      </div>
      <p className="line-clamp-3 px-4 pt-2 text-[16.5px] leading-relaxed">{r.description}</p>
      {r.results_visible ? <Results r={r} onWhy={() => onOpen(r, null, "why")} /> : <VoteButtons r={r} online={online} onOpen={onOpen} near={dist != null && dist <= 500} />}
      <div className="flex items-center justify-between px-1.5 pb-1.5 pt-1">
        <PinButton saved={r.saved} onClick={toggleSave} />
        <button onClick={() => onOpen(r, null, "verifications")} className="press inline-flex min-h-12 items-center gap-2 rounded-xl px-3 text-[14px] font-bold text-primary hover:bg-soft/40">
          <Icon name="camera" className="size-5" />
          See image verifications{r.results_visible && comments != null ? ` (${comments})` : ""}
        </button>
      </div>
    </article>
  );
});

// ---------- pop-up ----------

function VotesTable({ votes, myVote }) {
  const modes = ["on_spot", "same_ward", "far_away"];
  const rows = [
    ["Confirmed", "confirm", "text-ok", "✓"],
    ["Disputed", "disagree", "text-err", "✕"],
  ];
  if (votes.fixed_now) rows.push(["Fixed now", "fixed_now", "text-st-high", "✓"]);
  return (
    <div className="rounded-2xl border border-hair bg-surface p-4">
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

function WhyScore({ rows, open, refEl }) {
  return (
    <details ref={refEl} open={open} className="group rounded-2xl border border-hair bg-surface">
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
    <section className="space-y-4 rounded-2xl border border-hair bg-surface p-4 shadow-1">
      <div>
        <h3 className="font-bold">{upgrade ? "Add an on-the-spot vote" : "Your vote"}</h3>
        <p className="text-sm text-primary">{upgrade ? "You can upgrade once, with a new photo taken within 100 m." : "Scores, votes and image verifications appear after you vote."}</p>
      </div>
      {!upgrade && (
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Where are you?">
          {VOTE_BUTTONS.map(([m, label]) => (
            <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={cx("press min-h-[52px] rounded-xl border-[1.5px] px-2 text-[14px] font-bold leading-tight transition-colors duration-150", mode === m ? "border-primary bg-primary text-on-primary" : "border-primary/50 bg-surface text-ink")}>
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
            <button key={d} role="radio" aria-checked={decision === d} onClick={() => setDecision(d)} className={cx("press min-h-11 rounded-full border-[1.5px] px-4 text-[15px] font-bold transition-colors duration-150", decision === d ? "border-inverse bg-inverse text-on-inverse" : "border-line bg-surface")}>
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

// `seed`: the card the person tapped. While the full report loads, the pop-up already shows that card's photo, so
// the card → pop-up photo morph (View Transition, `instant`) has something to land on.
export function ReportDialog({ id, initialMode, focus, onClose, onChanged, seed, instant }) {
  const { toast } = useApp();
  const whyRef = useRef(null);
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
    if (!r || (focus !== "verifications" && focus !== "why")) return undefined;
    const el = focus === "why" ? whyRef.current : stripRef.current;
    const t = setTimeout(() => el?.scrollIntoView({ block: "start", behavior: "smooth" }), 120);
    return () => clearTimeout(t);
  }, [focus, r?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Results that arrive while the pop-up is open (right after a vote) play the reveal; results that were already
  // there when it opened simply show.
  const hadResults = useRef({ id: null, had: false });
  if (r && hadResults.current.id !== r.id) hadResults.current = { id: r.id, had: Boolean(r.results) };
  const revealNow = Boolean(r?.results) && !hadResults.current.had;
  const res = r?.results;
  const image = res?.components?.find((c) => c.component === "image" && c.availability !== "unavailable");
  const comments = res?.comments || [];
  return (
    <Dialog open={Boolean(id)} onClose={onClose} title={r ? `${r.category?.name_en || "Price"} report` : "Report"} size="xl" bare instant={instant}>
      <div className="relative flex max-h-[inherit] flex-col overflow-y-auto overscroll-contain">
        {loading && (
          <div className="grid gap-6 md:grid-cols-2">
            {seed?.photo_url ? (
              <Photo eager src={seed.photo_url} alt="Report photo" className="aspect-[4/3] w-full md:aspect-auto md:min-h-[560px]" vtName={instant ? "report-photo" : undefined} />
            ) : (
              <Skeleton className="aspect-[4/3] w-full rounded-none" />
            )}
            <div className="space-y-3 p-5 md:p-6">
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
              <Photo eager src={r.photo_url} alt="Report photo" className="aspect-[4/3] w-full md:aspect-auto md:min-h-[560px]" placeholder="Reporter's photo" vtName={instant ? "report-photo" : undefined}>
                <span className="num absolute bottom-4 left-4 rounded-full bg-black/70 px-3 py-1.5 text-[13px] font-bold text-white backdrop-blur-sm">Taken {fmtLongStamp(r.submitted_at)}</span>
                {image && (
                  <span className="num absolute bottom-4 right-4 rounded-full bg-surface px-3 py-1.5 text-[13px] font-bold text-ink shadow-1">
                    {image.score_display >= 50 ? "Image matches category" : "Image may not match"} · {image.score_display}
                  </span>
                )}
                {r.is_seed && <DemoBadge explain className="absolute left-4 top-4" />}
              </Photo>
              <div className="flex flex-col gap-4 p-5 md:p-6">
                <div className="flex items-start gap-3">
                  <Avatar text={r.reporter?.initials || initials(r.reporter?.display_name)} src={res?.reporter?.avatar_url} className="size-12" />
                  <div className="min-w-0 flex-1">
                    {res?.reporter?.id ? (
                      <button
                        onClick={() => {
                          onClose();
                          navigate(profilePath(res.reporter.id));
                        }}
                        className="block max-w-full truncate text-left text-[17px] font-bold underline-offset-4 hover:underline"
                      >
                        {r.reporter?.display_name || "Reporter unavailable"}
                      </button>
                    ) : (
                      <p className="truncate text-[17px] font-bold">{r.reporter?.display_name || "Reporter unavailable"}</p>
                    )}
                    <p className="text-sm text-primary">
                      {wardLine(r)} · {ago(r.submitted_at)}
                    </p>
                  </div>
                  {res?.reporter?.reputation_display != null && <span className="num shrink-0 rounded-full bg-info-soft px-3 py-1.5 text-sm font-bold text-st-high">Reputation {res.reporter.reputation_display}</span>}
                  <CloseButton onClick={onClose} />
                </div>
                <div style={catStyle(r.category?.code)} className={cx("flex flex-wrap items-center gap-3 rounded-2xl border border-hair bg-surface px-4 py-3", revealNow && "cp-shine")}>
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-cat text-white">
                    <Icon name={categoryIcon(r.category?.code)} className="size-5" strokeWidth={2.4} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="display text-lg">{r.category?.name_en}</span>{" "}
                    <span className="text-sm text-ink/70" lang="bn">
                      {r.category?.name_bn}
                    </span>
                  </span>
                  {res ? (
                    <m.span initial={revealNow ? { scale: 0.5, opacity: 0 } : false} animate={{ scale: 1, opacity: 1 }} transition={{ ...pop, delay: revealNow ? REVEAL.details : 0 }}>
                      <StatusChip status={res.status} />
                    </m.span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink/80">
                      <Icon name="lock" className="size-4" />
                      Status after vote
                    </span>
                  )}
                </div>
                {res && (
                  <m.div className="grid grid-cols-2 gap-5" initial={revealNow ? { opacity: 0, y: 10 } : false} animate={{ opacity: 1, y: 0 }} transition={{ ...enter(), delay: revealNow ? REVEAL.ring : 0 }}>
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
                  </m.div>
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
                {res && r.type === "civic" && (
                  <m.div initial={revealNow ? { opacity: 0, y: 12 } : false} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: revealNow ? REVEAL.details : 0 }}>
                    <VotesTable votes={res.votes} myVote={r.my_vote} />
                  </m.div>
                )}
                {res?.components?.length > 0 && <WhyScore rows={res.components} open={focus === "why"} refEl={whyRef} />}
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
