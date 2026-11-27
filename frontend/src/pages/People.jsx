// Profiles (UI v2): the shared profile header, badges, the profile-completeness meter, the edit sheet, the photo
// cropper and the public profile page (/gg/people/:id, /pp/people/:id).
// Privacy: a public profile opens only after the viewer voted on one of that person's reports (server rule); the
// phone number and home/work wards never appear on it, and the email only if the person chose "Show my email".
import { m } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Icon, categoryIcon } from "../components/icons.jsx";
import { catStyle, ScoreRing } from "../components/Report.jsx";
import { Shell } from "../components/Shell.jsx";
import { Avatar, Button, DemoBadge, Dialog, ErrorState, Field, Skeleton, StateBlock, Switch, cx, inputCls, textareaCls } from "../components/ui.jsx";
import { kindLabel } from "../components/Areas.jsx";
import { CardList } from "./GreenGuard.jsx";
import { api } from "../lib/api.js";
import { fmtDate, initials } from "../lib/format.js";
import { enter, pop, stagger } from "../lib/motion.js";
import { moduleFromPath, navigate, useRoute } from "../lib/router.jsx";
import { useApp, useData } from "../lib/store.jsx";

// "Sep 2026": fixed month names, so every browser shows "Sep", never "Sept" (same rule as lib/format.js).
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthYear = { format: (d) => { const [y, mo] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit" }).format(d).split("-"); return `${MONTHS[Number(mo) - 1]} ${y}`; } };
export const PRICES_INTEREST = { code: "prices", name_en: "Market prices", name_bn: "বাজারদর" };

// ---------- header ----------

// The cover is generated, not uploaded (no extra content to moderate): the module colour, a soft glow and the
// CivicPulse pulse line. It is the same for everyone in a module, so it reads as "a CivicPulse profile".
function Cover() {
  return (
    <div className="relative h-36 overflow-hidden rounded-[28px] bg-gradient-to-br from-primary to-[color-mix(in_srgb,var(--primary)_55%,black)] md:h-48" aria-hidden>
      <span className="absolute -right-16 -top-20 size-72 rounded-full bg-glow/40 blur-3xl" />
      <span className="absolute -bottom-24 left-6 size-56 rounded-full bg-white/10 blur-2xl" />
      <svg viewBox="0 0 400 140" preserveAspectRatio="none" className="absolute inset-x-0 bottom-6 h-16 w-full text-white/35">
        <path className="cp-draw" pathLength="1" d="M0 80 H120 L136 80 L148 40 L164 118 L176 62 L188 80 H260 L272 80 L282 58 L294 104 L302 80 H400" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function Detail({ icon, children }) {
  return (
    <li className="flex min-w-0 items-center gap-2 text-[15px] text-muted">
      <Icon name={icon} className="size-[18px] shrink-0" />
      <span className="min-w-0 truncate">{children}</span>
    </li>
  );
}

export function InterestChips({ codes, categories, className }) {
  const all = [...(categories || []), PRICES_INTEREST];
  const items = (codes || []).map((c) => all.find((x) => x.code === c)).filter(Boolean);
  if (!items.length) return null;
  return (
    <ul className={cx("flex flex-wrap gap-2", className)} aria-label="Interests">
      {items.map((c, i) => (
        <m.li key={c.code} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...pop, delay: 0.15 + i * 0.04 }}>
          <span style={catStyle(c.code === "prices" ? null : c.code)} className={cx("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-bold", c.code === "prices" ? "bg-primary/12 text-primary" : "bg-cat/12 text-cat-text")}>
            <Icon name={c.code === "prices" ? "tag" : categoryIcon(c.code)} className="size-4" strokeWidth={2.3} />
            {c.name_en}
          </span>
        </m.li>
      ))}
    </ul>
  );
}

// Reputation comes first after the person's details (user decision, 26 Nov): it is what CivicPulse is about.
function ReputationRow({ rep, onHow }) {
  return (
    <div className="mt-4 flex items-center gap-4 rounded-3xl border border-hair bg-surface p-4 shadow-1">
      <ScoreRing value={rep.display} color="#2a6fd6" size={84} stroke={9} textClass="text-[26px] text-st-high" delay={0.15} />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-extrabold">Reputation</p>
        <p className="num text-sm text-muted">
          Uncertainty <b className="text-ink">{rep.uncertainty_display}</b>
        </p>
        <p className="mt-1 text-[13px] leading-snug text-muted">Rises when reports end up credible and on-the-spot checks match the result.</p>
        {onHow && (
          <button onClick={onHow} className="mt-0.5 min-h-9 text-sm font-bold text-primary underline underline-offset-4">
            How reputation works
          </button>
        )}
      </div>
    </div>
  );
}

// Shared by your own profile and someone else's. `own` adds the photo button and the edit action.
export function ProfileHeader({ person, own, categories, onEdit, onPhoto, onHowReputation, extra }) {
  const areas = own ? person.addresses : person.areas;
  const site = person.website ? safeHost(person.website) : null;
  return (
    <section>
      <Cover />
      <div className="relative -mt-14 flex items-end justify-between gap-3 px-3 md:-mt-16 md:px-5">
        <m.span className="relative" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={pop}>
          <Avatar
            text={initials(person.display_name)}
            src={person.avatar_url}
            alt={`${person.display_name}'s profile photo`}
            className="size-28 bg-primary text-[32px] font-extrabold text-on-primary shadow-[0_14px_30px_-12px_rgb(0_0_0/0.45)] ring-[5px] ring-bg md:size-32"
          />
          {own && (
            <button onClick={onPhoto} className="glass press absolute bottom-1 right-0 grid size-11 place-items-center rounded-full text-ink" aria-label={person.avatar_url ? "Change profile photo" : "Add a profile photo"}>
              <Icon name="camera" className="size-5" />
            </button>
          )}
        </m.span>
        {own && (
          <Button size="sm" icon="edit" onClick={onEdit} className="mb-1">
            Edit profile
          </Button>
        )}
      </div>
      <div className="px-1 pt-3 md:px-3">
        <h1 className="wide flex flex-wrap items-center gap-2 text-[28px] leading-tight">
          <span className="min-w-0 break-words">{person.display_name}</span>
          {person.is_seed && <DemoBadge />}
        </h1>
        {person.bio ? (
          <p className="mt-2 whitespace-pre-line text-[16.5px] leading-relaxed">{person.bio}</p>
        ) : own ? (
          <button onClick={onEdit} className="mt-2 text-[15px] font-bold text-primary underline-offset-4 hover:underline">
            + Add a short bio
          </button>
        ) : null}
        <ul className="mt-3 space-y-1.5">
          {person.occupation && <Detail icon="briefcase">{person.occupation}</Detail>}
          {site && (
            <Detail icon="link">
              {/* ugc + nofollow: a link someone typed; noopener/noreferrer: the new tab can't reach this one */}
              <a href={person.website} target="_blank" rel="noopener noreferrer nofollow ugc" className="font-bold text-primary underline-offset-4 hover:underline">
                {site}
              </a>
            </Detail>
          )}
          {person.email && (
            <Detail icon="mail">
              {person.email}
              {own && !person.email_public && <span className="ml-1.5 text-xs font-semibold">· only you</span>}
            </Detail>
          )}
          {own && person.phone_masked && (
            <Detail icon="lock">
              <span className="num">{person.phone_masked}</span>
              <span className="ml-1.5 text-xs font-semibold">· only you</span>
            </Detail>
          )}
          {(areas || []).map((a, i) => (
            <Detail key={i} icon="mapPin">
              {kindLabel(a.kind)}: <b className="font-bold text-ink">{a.ward_name_en}</b>
            </Detail>
          ))}
          <Detail icon="calendar">Member since {monthYear.format(new Date(person.member_since))}</Detail>
        </ul>
        {person.reputation && <ReputationRow rep={person.reputation} onHow={onHowReputation} />}
        <InterestChips codes={person.interests} categories={categories} className="mt-4" />
        {extra}
      </div>
    </section>
  );
}

// "example.org" for display. Anything that isn't a plain http(s) URL shows nothing (the server already refuses it).
function safeHost(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.host.replace(/^www\./, "") + (u.pathname !== "/" ? u.pathname : "") : null;
  } catch {
    return null;
  }
}

// ---------- reputation, stats, badges ----------

export function StatTiles({ stats, extra = [] }) {
  const tiles = [
    [stats.civic_reports, "Reports"],
    [stats.credible_reports, "Rated credible"],
    [stats.votes, "Checks given"],
    [stats.on_spot_votes, "On the spot"],
    ...extra,
  ];
  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map(([n, label, onClick], i) => {
        const body = (
          <>
            <span className="num block text-[28px] font-extrabold leading-none">{n ?? 0}</span>
            <span className="mt-1.5 block text-[13.5px] text-muted">{label}</span>
          </>
        );
        const cls = "rounded-2xl border border-hair bg-surface px-3.5 py-3.5 text-left shadow-1";
        return (
          <m.div key={label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={stagger(i, 0.15)}>
            {onClick ? (
              <button onClick={onClick} className={cx(cls, "press block size-full hover:bg-soft/30")}>
                {body}
              </button>
            ) : (
              <div className={cx(cls, "h-full")}>{body}</div>
            )}
          </m.div>
        );
      })}
    </section>
  );
}

// Badges come from the person's own activity only. Wording never says "true" or "proven" (spec wording rule).
const BADGES = [
  { id: "first", icon: "mapPin", title: "First report", text: "Posted a civic report", need: 1, value: (s) => s.civic_reports },
  { id: "reporter", icon: "feed", title: "Active reporter", text: "10 civic reports", need: 10, value: (s) => s.civic_reports },
  { id: "credible", icon: "checks", title: "Credible reporter", text: "5 reports rated credible", need: 5, value: (s) => s.credible_reports },
  { id: "checker", icon: "users", title: "Neighbour checker", text: "Checked 10 reports", need: 10, value: (s) => s.votes },
  { id: "onspot", icon: "locate", title: "On-the-spot hero", text: "10 checks on the spot", need: 10, value: (s) => s.on_spot_votes },
  { id: "prices", icon: "tag", title: "Price watcher", text: "5 market prices shared", need: 5, value: (s) => s.price_reports },
  { id: "rep", icon: "award", title: "High reputation", text: "Reputation 70 or more", need: 70, value: (s, rep) => rep?.display ?? 0 },
];

export function Badges({ stats, rep }) {
  const list = BADGES.map((b) => {
    const v = Math.min(b.need, b.value(stats, rep) || 0);
    return { ...b, v, done: v >= b.need };
  }).sort((a, b) => Number(b.done) - Number(a.done));
  const earned = list.filter((b) => b.done).length;
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="display text-xl">Badges</h2>
        <span className="num text-sm font-bold text-muted">
          {earned} of {list.length}
        </span>
      </div>
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0">
        {list.map((b, i) => (
          <m.li key={b.id} className="w-[148px] shrink-0 snap-start sm:w-auto" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={stagger(i, 0.2)}>
            <div className={cx("h-full rounded-2xl border p-3.5", b.done ? "border-hair bg-surface shadow-1" : "border-dashed border-line/70 bg-surface/60")}>
              <span
                className={cx(
                  "grid size-11 place-items-center rounded-2xl",
                  b.done ? "bg-gradient-to-br from-primary to-[color-mix(in_srgb,var(--primary)_60%,black)] text-on-primary shadow-[0_8px_18px_-8px_var(--primary)]" : "bg-ink/[0.07] text-muted",
                )}
              >
                <Icon name={b.done ? b.icon : "lock"} className="size-5" strokeWidth={2.3} />
              </span>
              <p className={cx("mt-2.5 text-[14.5px] font-extrabold leading-tight", !b.done && "text-muted")}>{b.title}</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{b.text}</p>
              {!b.done && (
                <div className="mt-2.5">
                  <span className="block h-1.5 overflow-hidden rounded-full bg-ink/10">
                    <m.span className="block h-full origin-left rounded-full bg-primary" style={{ width: `${(100 * b.v) / b.need}%` }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ ...enter(0.5), delay: 0.3 }} />
                  </span>
                  <span className="num mt-1 block text-[12px] font-bold text-muted">
                    {b.v} / {b.need}
                  </span>
                </div>
              )}
            </div>
          </m.li>
        ))}
      </ul>
    </section>
  );
}

// ---------- completeness (own profile only) ----------

const STEPS = [
  ["photo", "Add a profile photo", (p) => Boolean(p.avatar_url)],
  ["bio", "Write a short bio", (p) => Boolean(p.bio)],
  ["interests", "Pick what you care about", (p) => (p.interests || []).length > 0],
  ["occupation", "Add what you do", (p) => Boolean(p.occupation)],
  ["website", "Add a link or email", (p) => Boolean(p.website || p.email)],
];

export function Completeness({ me, onEdit, onPhoto }) {
  const done = STEPS.filter(([, , ok]) => ok(me)).length;
  const next = STEPS.find(([, , ok]) => !ok(me));
  if (!next) return null;
  const pct = Math.round((100 * done) / STEPS.length);
  return (
    <m.section className="rounded-3xl border border-hair bg-surface p-4 shadow-1" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...enter(), delay: 0.2 }}>
      <div className="flex items-center gap-4">
        <ScoreRing value={pct} color="var(--primary)" size={60} stroke={7} textClass="text-[15px]" delay={0.25} />
        <div className="min-w-0 flex-1">
          <p className="font-extrabold">Your profile is {pct}% complete</p>
          <p className="text-sm text-muted">Neighbours who check your reports see this profile.</p>
        </div>
      </div>
      <Button size="sm" kind="soft" icon={next[0] === "photo" ? "camera" : "edit"} className="mt-3 w-full" onClick={next[0] === "photo" ? onPhoto : onEdit}>
        Next: {next[1].toLowerCase()}
      </Button>
    </m.section>
  );
}

// ---------- edit sheet ----------

const LIMITS = { bio: 160, occupation: 60, website: 200 };

export function EditProfile({ open, onClose, me, categories, onSaved }) {
  const { toast } = useApp();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (open && me)
      setForm({
        display_name: me.display_name || "",
        bio: me.bio || "",
        occupation: me.occupation || "",
        website: me.website || "",
        email: me.email || "",
        email_public: Boolean(me.email_public),
        interests: me.interests || [],
      });
    if (open) setError(null);
  }, [open, me]);
  if (!form) return null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const lockedUntil = me.name_change_available_at ? fmtDate(me.name_change_available_at) : null;
  const toggle = (code) => setForm((f) => ({ ...f, interests: f.interests.includes(code) ? f.interests.filter((c) => c !== code) : [...f.interests, code] }));

  async function save(e) {
    e.preventDefault();
    const body = {};
    for (const k of Object.keys(form)) {
      const before = k === "interests" ? me.interests || [] : k === "email_public" ? Boolean(me.email_public) : me[k] || "";
      const after = typeof form[k] === "string" ? form[k].trim() : form[k];
      if (JSON.stringify(before) !== JSON.stringify(after)) body[k] = after === "" && k !== "display_name" ? null : after;
    }
    if (!Object.keys(body).length) return onClose();
    setBusy(true);
    setError(null);
    try {
      await api("/api/me", { method: "PATCH", body });
      toast("Profile saved.", "ok");
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const counter = (k) => (
    <span className={cx("num text-xs font-bold", form[k].length > LIMITS[k] ? "text-err" : "text-muted")}>
      {form[k].length} / {LIMITS[k]}
    </span>
  );
  return (
    <Dialog open={open} onClose={onClose} title="Edit profile">
      <form onSubmit={save} className="space-y-5 pt-1">
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-xl bg-err-soft px-3.5 py-2.5 text-[15px] font-semibold text-err">
            <Icon name="alert" className="mt-0.5 size-5 shrink-0" />
            {error}
          </p>
        )}
        <Field label="Name" id="pf-name" hint={lockedUntil ? `You can change your name again on ${lockedUntil}.` : "Shown on your reports. You can change it once every 30 days."}>
          <input id="pf-name" className={inputCls} value={form.display_name} onChange={set("display_name")} minLength={2} maxLength={80} required disabled={Boolean(lockedUntil)} autoComplete="name" />
        </Field>
        <Field label="Bio" id="pf-bio" trailing={counter("bio")} hint="A line or two about you. Plain text, up to 4 lines.">
          <textarea id="pf-bio" className={textareaCls("min-h-24")} value={form.bio} onChange={set("bio")} maxLength={LIMITS.bio} rows={3} placeholder="Example: I live near Chashara and check drains after heavy rain." />
        </Field>
        <Field label="What you do" id="pf-occ" trailing={counter("occupation")}>
          <input id="pf-occ" className={inputCls} value={form.occupation} onChange={set("occupation")} maxLength={LIMITS.occupation} placeholder="Example: Student, shop owner, engineer" autoComplete="organization-title" />
        </Field>
        <Field label="Website or social link" id="pf-site" hint="Starts with https://. Shown as a link on your profile.">
          <input id="pf-site" className={inputCls} value={form.website} onChange={set("website")} maxLength={LIMITS.website} inputMode="url" placeholder="https://" autoComplete="url" />
        </Field>
        <div className="space-y-3">
          <Field label="Email" id="pf-mail" hint="Optional. Private unless you switch it on below.">
            <input id="pf-mail" type="email" className={inputCls} value={form.email} onChange={set("email")} maxLength={254} autoComplete="email" />
          </Field>
          <Switch id="pf-mail-public" checked={form.email_public} onChange={set("email_public")} label="Show my email on my profile" sub="Only people who checked one of your reports can see your profile." />
        </div>
        <fieldset>
          <legend className="text-[15px] font-bold">What do you care about?</legend>
          <p className="mt-0.5 text-sm text-muted">Shown as chips on your profile.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {[...(categories || []), PRICES_INTEREST].map((c) => {
              const on = form.interests.includes(c.code);
              return (
                <button
                  type="button"
                  key={c.code}
                  aria-pressed={on}
                  onClick={() => toggle(c.code)}
                  style={catStyle(c.code === "prices" ? null : c.code)}
                  className={cx(
                    "press inline-flex min-h-10 items-center gap-1.5 rounded-full border-[1.5px] px-3.5 text-[14px] font-bold transition-colors duration-150",
                    on ? "border-transparent bg-cat text-white" : "border-line bg-surface text-ink hover:bg-soft/40",
                  )}
                >
                  <Icon name={on ? "check" : c.code === "prices" ? "tag" : categoryIcon(c.code)} className="size-4" strokeWidth={2.4} />
                  {c.name_en}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="sticky bottom-0 -mx-5 flex gap-3 border-t border-hair bg-bg px-5 pb-1 pt-3">
          <Button type="button" kind="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-[2]" busy={busy} busyLabel="Saving…">
            Save profile
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------- photo picker + cropper ----------
// Pick from the gallery or camera, then drag to place and zoom; the app draws a square 768 × 768 JPEG on a canvas
// (any format the phone can show, HEIC included, comes out as JPEG, about 200 KB). So there is no size limit for the
// person: any photo is compressed on the phone first. The server checks and re-encodes it again.
const OUT = 768;
const BOX = 280;

export function PhotoEditor({ open, onClose, hasPhoto, onSaved }) {
  const { toast } = useApp();
  const input = useRef(null);
  const [img, setImg] = useState(null); // { el, url, w, h }
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const drag = useRef(null);

  useEffect(() => {
    if (!open) {
      setImg((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return null;
      });
      setZoom(1);
      setPos({ x: 0, y: 0 });
    }
  }, [open]);

  const base = img ? BOX / Math.min(img.w, img.h) : 1; // scale that makes the short side fill the square
  const clamp = (p, z = zoom) => {
    if (!img) return p;
    const w = img.w * base * z;
    const h = img.h * base * z;
    const mx = Math.max(0, (w - BOX) / 2);
    const my = Math.max(0, (h - BOX) / 2);
    return { x: Math.max(-mx, Math.min(mx, p.x)), y: Math.max(-my, Math.min(my, p.y)) };
  };

  function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) return toast("Choose a photo (JPEG, PNG, WebP or HEIC).", "error");
    const url = URL.createObjectURL(f);
    const el = new Image();
    el.onload = () => {
      setImg({ el, url, w: el.naturalWidth, h: el.naturalHeight });
      setZoom(1);
      setPos({ x: 0, y: 0 });
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      toast("This photo could not be opened. Try another one.", "error");
    };
    el.src = url;
  }

  async function save() {
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = OUT;
      canvas.height = OUT;
      const ctx = canvas.getContext("2d");
      const k = OUT / BOX;
      const w = img.w * base * zoom * k;
      const h = img.h * base * zoom * k;
      ctx.drawImage(img.el, OUT / 2 - w / 2 + pos.x * k, OUT / 2 - h / 2 + pos.y * k, w, h);
      const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.9));
      if (!blob) throw new Error("Could not prepare the photo.");
      await api("/api/me/avatar", { method: "PUT", form: { photo: blob } });
      toast("Profile photo updated.", "ok");
      onSaved();
      onClose();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api("/api/me/avatar", { method: "DELETE" });
      toast("Profile photo removed.", "ok");
      onSaved();
      onClose();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Profile photo">
      <input ref={input} type="file" accept="image/*" className="sr-only" onChange={pick} tabIndex={-1} aria-hidden />
      {!img ? (
        <div className="space-y-3 py-2">
          <p className="text-[15px] text-muted">People who check your reports see it after they vote. It is never used as evidence.</p>
          <Button className="w-full" icon="image" onClick={() => input.current?.click()}>
            Choose a photo
          </Button>
          {hasPhoto && (
            <Button kind="outline" className="w-full" icon="trash" busy={busy} onClick={remove}>
              Remove current photo
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4 py-1">
          <p className="text-center text-sm text-muted">Drag to move · use the slider to zoom</p>
          <div
            className="relative mx-auto touch-none select-none overflow-hidden rounded-full bg-ink shadow-3"
            style={{ width: BOX, height: BOX, cursor: drag.current ? "grabbing" : "grab" }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY, start: pos };
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              const d = drag.current;
              setPos(clamp({ x: d.start.x + e.clientX - d.x, y: d.start.y + e.clientY - d.y }));
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onWheel={(e) => {
              const z = Math.max(1, Math.min(4, zoom - e.deltaY * 0.002));
              setZoom(z);
              setPos((p) => clamp(p, z));
            }}
            role="img"
            aria-label="Photo preview"
          >
            <img
              src={img.url}
              alt=""
              draggable={false}
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
              style={{ width: img.w * base * zoom, height: img.h * base * zoom, transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))` }}
            />
          </div>
          <label className="mx-auto flex max-w-[280px] items-center gap-3">
            <Icon name="minus" className="size-4 text-muted" />
            <input
              type="range"
              min="1"
              max="4"
              step="0.01"
              value={zoom}
              onChange={(e) => {
                const z = Number(e.target.value);
                setZoom(z);
                setPos((p) => clamp(p, z));
              }}
              className="h-11 flex-1 accent-[var(--primary)]"
              aria-label="Zoom"
            />
            <Icon name="plus" className="size-4 text-muted" />
          </label>
          <div className="flex gap-3">
            <Button kind="outline" className="flex-1" onClick={() => input.current?.click()}>
              Change
            </Button>
            <Button className="flex-[2]" busy={busy} busyLabel="Saving…" onClick={save}>
              Use this photo
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

// ---------- someone else's profile ----------

export function PersonPage() {
  const { path } = useRoute();
  const id = path.split("/")[3];
  const module = moduleFromPath(path);
  const person = useData(() => api(`/api/people/${id}`), [id], `person:${id}`);
  const cats = useData(() => api("/api/categories"), [], "categories");
  const reports = useData(() => api(`/api/people/${id}/reports`), [id], `person-reports:${id}`);
  const p = person.data;
  return (
    <Shell module={module} title="Profile">
      <button onClick={() => history.back()} className="press -ml-2 mb-2 grid size-11 place-items-center rounded-full hover:bg-soft/50" aria-label="Back">
        <Icon name="chevronLeft" className="size-6" strokeWidth={2.4} />
      </button>
      {person.loading && (
        <div className="space-y-4">
          <Skeleton className="h-36 w-full rounded-[28px]" />
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {person.error &&
        (person.error.status === 404 ? (
          <StateBlock icon="lock" title="Profile not available">
            You can see someone's profile after you check one of their reports. This keeps every vote about the evidence, not the person.
          </StateBlock>
        ) : (
          <ErrorState error={person.error} onRetry={person.reload} title="Couldn't load this profile" />
        ))}
      {p && (
        <div className="space-y-6">
          {p.is_me && (
            <p className="rounded-2xl bg-primary/10 px-4 py-3 text-[15px] font-semibold">
              This is how neighbours see your profile.{" "}
              <button className="font-extrabold text-primary underline underline-offset-4" onClick={() => navigate(`/${module}/profile`)}>
                Edit it
              </button>
            </p>
          )}
          <ProfileHeader person={p} categories={cats.data} />
          <StatTiles stats={p.stats} />
          <Badges stats={p.stats} rep={p.reputation} />
          <section>
            <h2 className="display mb-3 text-xl">Reports</h2>
            {reports.loading && <Skeleton className="h-64 w-full rounded-3xl" />}
            {reports.data && reports.data.length === 0 && <p className="text-muted">No reports to show.</p>}
            {reports.data && reports.data.length > 0 && <CardList items={reports.data} setItems={reports.setData} />}
          </section>
        </div>
      )}
    </Shell>
  );
}
