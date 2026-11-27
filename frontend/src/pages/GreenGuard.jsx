// Green Guard: ward feed with the pinned-reports bar, the pinned list and the 5-step report form
// (boards: Green Guard feed, States, Report form step 4; W2, W3, T3, T6).
import { AnimatePresence, m } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Camera, ensureFreshToken } from "../components/Camera.jsx";
import { Icon, categoryIcon } from "../components/icons.jsx";
import { ReportCard, ReportDialog, catStyle } from "../components/Report.jsx";
import { Shell } from "../components/Shell.jsx";
import { Button, CardSkeleton, ErrorState, FormHeader, StateBlock, StepBar, cx, textareaCls, useNow } from "../components/ui.jsx";
import { api, photoUrlSync, readDataCache, writeDataCache } from "../lib/api.js";
import { enter, exit, pop, stagger } from "../lib/motion.js";
import { fmtLongStamp, fmtTime } from "../lib/format.js";
import { getPosition } from "../lib/geo.js";
import { Link, navigate } from "../lib/router.jsx";
import { useApp, useData } from "../lib/store.jsx";

function useCategories() {
  return useData(() => api("/api/categories"), [], "categories");
}

export function CardList({ items, setItems, onPin }) {
  const [open, setOpen] = useState(null); // { id, mode, focus, seed, instant }
  const [vtId, setVtId] = useState(null); // the card whose photo is about to morph into the pop-up
  // Stable handlers (cards are memoised): they read the latest list through a ref.
  const latest = useRef({ items, setItems, onPin });
  latest.current = { items, setItems, onPin };
  const replace = useCallback((r) => {
    const { items: list, setItems: set, onPin: pin } = latest.current;
    const before = list.find((x) => x.id === r.id);
    if (before && r.saved !== undefined && before.saved !== r.saved) pin?.(r.saved ? 1 : -1);
    set(list.map((x) => (x.id === r.id ? { ...x, ...r } : x)));
  }, []);
  const onSaved = useCallback((r, saved) => replace({ ...r, saved }), [replace]);
  // B6 shared photo: name the tapped card's photo, then let the browser morph it into the pop-up's photo.
  // Only when the photo is already on screen, the browser supports View Transitions and motion is not reduced.
  const openReport = useCallback((r, mode, focus) => {
    const next = { id: r.id, mode, focus, seed: r };
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduce";
    if (!document.startViewTransition || reduce || !photoUrlSync(r.photo_url)) return setOpen(next);
    flushSync(() => setVtId(r.id));
    document.startViewTransition(() =>
      flushSync(() => {
        setVtId(null);
        setOpen({ ...next, instant: true });
      }),
    );
  }, []);
  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
        {items.map((r, i) =>
          // The first 6 cards of each page stagger in (40 ms apart, motion tokens), as before. The rest don't animate on mount; they
          // rise in as they scroll into view (CSS scroll-driven, where supported) and, while off screen, skip
          // style/layout/paint entirely (content-visibility), so a long feed costs about as much as one screen.
          i % 10 < 6 ? (
            <m.div key={r.id} className={i > 1 ? "cp-rise" : undefined} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={stagger(i % 10)}>
              <ReportCard report={r} onOpen={openReport} onSaved={onSaved} vtName={vtId === r.id ? "report-photo" : undefined} />
            </m.div>
          ) : (
            <div key={r.id} className="cp-lazy-card cp-rise">
              <ReportCard report={r} onOpen={openReport} onSaved={onSaved} vtName={vtId === r.id ? "report-photo" : undefined} />
            </div>
          ),
        )}
      </div>
      <ReportDialog id={open?.id} initialMode={open?.mode} focus={open?.focus} seed={open?.seed} instant={open?.instant} onClose={() => setOpen(null)} onChanged={(full) => replace(full)} />
    </>
  );
}

function PinnedBar({ count }) {
  return (
    <Link to="/gg/pinned" className="press mb-5 flex min-h-12 items-center gap-2.5 rounded-2xl border border-hair bg-surface px-4 font-bold shadow-1 hover:bg-soft/30">
      <span className="grid size-8 place-items-center rounded-xl bg-primary/12 text-primary">
        <Icon name="pinFilled" className="size-[18px]" />
      </span>
      <span className="flex-1">Pinned Reports</span>
      <span className="num flex items-center text-muted">
        {count ?? ""}
        <Icon name="chevronRight" className="size-5" strokeWidth={2.4} />
      </span>
    </Link>
  );
}

// The feed's signature: the area name in Anek Bangla's widest cut and a live pulse line ("a report is a pulse from
// a place"). The line draws itself once, then a bright blip keeps running along it. Numbers are aggregates for the
// whole area (shown to everyone signed in, X1), never one report's result.
function AreaPulse({ wards, names }) {
  // One request for all of the person's wards (it used to be one /summary request per ward).
  const week = useData(() => (wards.length ? api("/api/insights/pulse", { query: { ward_id: wards, days: 7 } }) : Promise.resolve(null)), [wards.join(",")], `pulse:${wards.join(",")}`);
  const title = names.length === 1 ? names[0] : names.length > 1 ? `Your ${names.length} areas` : "Your area";
  const path = "M0 22 H70 L80 22 L88 6 L98 34 L106 14 L114 22 H170 L178 22 L184 12 L192 30 L198 22 H260";
  return (
    <section className="mb-4 mt-1">
      <div className="flex items-center gap-3">
        <svg viewBox="0 0 260 40" preserveAspectRatio="none" className="cp-pulse-line h-9 flex-1 text-primary" aria-hidden>
          <path d={path} pathLength="1" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <path className="blip" d={path} pathLength="1" fill="none" stroke="var(--glow)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="inline-flex items-center gap-2 text-[14px] font-extrabold">
          <span className="cp-live-dot" aria-hidden />
          Live
        </span>
      </div>
      <h1 className="wide mt-1 text-[32px] leading-[1.02]">{title}</h1>
      <p className="num mt-1.5 text-[15px] text-muted">
        {week.data ? (
          <>
            <b className="text-ink">{week.data.reports}</b> report{week.data.reports === 1 ? "" : "s"} this week
            {week.data.fixed > 0 && (
              <>
                {" "}
                · <b className="text-ink">{week.data.fixed}</b> fixed
              </>
            )}
          </>
        ) : (
          <span className="inline-block h-4 w-44 align-middle">
            <span className="cp-skeleton block h-4 rounded-md" />
          </span>
        )}
      </p>
    </section>
  );
}

// Swipeable hotspots in the person's areas (public aggregates). Tap → the dashboard map at that spot.
function HotspotRail({ wards }) {
  const hs = useData(() => api("/api/insights/hotspots"), [], "hotspots");
  const mine = (hs.data || []).filter((h) => h.ward && wards.includes(h.ward.id)).slice(0, 8);
  if (!mine.length) return null;
  return (
    <section className="mb-5" aria-label="Hotspots in your areas">
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {mine.map((h, i) => (
          <m.button
            key={h.id}
            style={catStyle(h.category.code)}
            onClick={() => navigate(`/gg/dashboard?lat=${h.lat}&lon=${h.lon}`)}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={stagger(i, 0.1)}
            className={cx(
              "press flex w-[158px] shrink-0 snap-start flex-col rounded-[20px] p-3.5 text-left",
              i === 0 ? "bg-gradient-to-br from-cat to-[color-mix(in_srgb,var(--cat)_55%,black)] text-white shadow-[0_14px_28px_-14px_var(--cat)]" : "border border-hair bg-surface shadow-1",
            )}
          >
            <span className="flex items-center justify-between">
              <span className="num text-[28px] font-extrabold leading-none">{h.n_reports}</span>
              <span className={cx("grid size-8 place-items-center rounded-xl", i === 0 ? "bg-white/20" : "bg-cat/12 text-cat-text")}>
                <Icon name={categoryIcon(h.category.code)} className="size-[18px]" strokeWidth={2.4} />
              </span>
            </span>
            <span className="mt-2 text-[14px] font-bold leading-snug">
              {h.category.name_en} hotspot
            </span>
            <span className={cx("mt-1 text-[12.5px]", i === 0 ? "text-white/85" : "text-muted")}>
              {h.ward.name_en} · {h.n_users} people
            </span>
          </m.button>
        ))}
      </div>
    </section>
  );
}

// "3 new reports · tap to see": counts live new-report notifications for this module while the feed is open.
function LivePill({ count, onShow }) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <m.button
          initial={{ opacity: 0, y: -16, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: pop }}
          exit={{ opacity: 0, y: -10, transition: exit() }}
          onClick={onShow}
          className="glass fixed left-1/2 top-[calc(76px+env(safe-area-inset-top))] z-40 flex h-10 -translate-x-1/2 items-center gap-2 rounded-full px-4 text-[14px] font-bold md:top-24"
        >
          <span className="cp-live-dot" aria-hidden />
          {count} new report{count === 1 ? "" : "s"} · tap to see
        </m.button>
      )}
    </AnimatePresence>
  );
}

// Pull down at the top of the feed to reload it (phones). Only the indicator and the list move (transform), and the
// browser's own pull-to-reload is switched off while the feed is open so the two never fight.
function usePullToRefresh(onRefresh) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef(null);
  const pullRef = useRef(0);
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.overscrollBehaviorY;
    root.style.overscrollBehaviorY = "contain";
    const down = (e) => {
      start.current = window.scrollY <= 0 && !busy ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    };
    const move = (e) => {
      if (start.current == null) return;
      const dy = e.touches[0].clientY - start.current.y;
      const dx = e.touches[0].clientX - start.current.x;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
        start.current = null; // a sideways swipe (the hotspot rail), not a pull
        pullRef.current = 0;
        setPull(0);
        return;
      }
      const v = dy > 0 ? Math.min(110, dy * 0.5) : 0;
      pullRef.current = v;
      setPull(v);
    };
    const up = async () => {
      if (start.current == null) return;
      start.current = null;
      if (pullRef.current >= 64) {
        setBusy(true);
        setPull(56);
        try {
          await onRefresh();
        } finally {
          setBusy(false);
          setPull(0);
        }
      } else setPull(0);
      pullRef.current = 0;
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    window.addEventListener("touchcancel", up);
    return () => {
      root.style.overscrollBehaviorY = before;
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
  }, [onRefresh, busy]);
  return { pull, busy };
}

function PullIndicator({ pull, busy }) {
  if (!pull && !busy) return null;
  const ready = pull >= 64;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-1 z-10 flex justify-center" style={{ transform: `translateY(${pull - 44}px)`, opacity: Math.min(1, pull / 40) }} aria-hidden>
      <span className="glass grid size-10 place-items-center rounded-full text-primary">
        <Icon name={busy ? "loader" : "arrowDown"} className={cx("size-5 transition-transform duration-150", busy && "animate-spin", ready && !busy && "rotate-180")} strokeWidth={2.6} />
      </span>
    </div>
  );
}

export function Feed() {
  const { user, live } = useApp();
  // The first page is kept in the screen cache: coming back to the feed shows it at once and refreshes it quietly.
  const cachedFirst = readDataCache("feed:first");
  const [items, setItems] = useState(() => cachedFirst?.items || []);
  const [cursor, setCursor] = useState(() => cachedFirst?.next_cursor || null);
  const [state, setState] = useState(() => ({ loading: !cachedFirst, error: null, wards: cachedFirst?.wards || [] }));
  const pinned = useData(() => api("/api/me/saved"), [], "saved");
  const sentinel = useRef(null);
  const [fresh, setFresh] = useState(0);

  async function load(reset, quiet = false) {
    if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await api("/api/feed", { query: { cursor: reset ? undefined : cursor } });
      if (reset) writeDataCache("feed:first", res);
      setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
      setCursor(res.next_cursor);
      setState({ loading: false, error: null, wards: res.wards });
      if (reset) setFresh(0);
    } catch (error) {
      // A quiet refresh that fails (offline) keeps the cached page on screen instead of an error.
      setState((s) => (quiet && error?.status === 0 ? { ...s, loading: false } : { ...s, loading: false, error }));
    }
  }
  useEffect(() => {
    load(true, Boolean(cachedFirst));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A live "new report in your ward" notification adds to the pill; it never reorders the list under the reader.
  const seen = useRef(live?.id);
  useEffect(() => {
    if (!live || live.id === seen.current) return;
    seen.current = live.id;
    if (live.kind === "new_report_in_ward") setFresh((n) => n + 1);
  }, [live]);

  const refresh = useRef(null);
  refresh.current = () => load(true);
  const ptr = usePullToRefresh(useCallbackRef(refresh));

  // Load the next page when the end of the list comes into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !state.loading) load(false);
    });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, state.loading]);

  const [pinDelta, setPinDelta] = useState(0);
  const pinnedCount = pinned.data ? pinned.data.length + pinDelta : null;
  // The header (area pulse, hotspots) needs only the person's wards, which are already in memory (`user`), so it
  // loads in parallel with the feed instead of waiting for the feed's answer. The feed answer wins once it's here.
  const wards = state.wards.length ? state.wards : [...new Set((user?.addresses || []).map((a) => a.ward_id).filter(Boolean))];
  const names = (user?.addresses || []).filter((a) => wards.includes(a.ward_id)).map((a) => a.ward_name_en);
  const uniqueNames = [...new Set(names)];

  return (
    <Shell module="gg">
      <LivePill
        count={fresh}
        onShow={() => {
          window.scrollTo({ top: 0, behavior: "smooth" });
          load(true);
        }}
      />
      <div className="relative" style={{ transform: ptr.pull ? `translateY(${ptr.pull * 0.6}px)` : undefined, transition: ptr.pull ? "none" : "transform 220ms cubic-bezier(0.2,0,0,1)" }}>
        <PullIndicator pull={ptr.pull} busy={ptr.busy} />
        {wards.length > 0 && <AreaPulse wards={wards} names={uniqueNames} />}
        {wards.length > 0 && <HotspotRail wards={wards} />}
        <PinnedBar count={pinnedCount} />
        {state.error && items.length === 0 && <ErrorState error={state.error} onRetry={() => load(true)} title="Couldn't load the feed" note="Your pinned reports are still saved." />}
        {!state.error && state.loading && items.length === 0 && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        )}
        {!state.loading && !state.error && items.length === 0 && (
          <StateBlock
            icon="mapPin"
            title={state.wards.length ? "No reports in your areas yet" : "Add an area to see reports"}
            actions={
              <>
                <Button onClick={() => navigate("/gg/report")}>Report a problem</Button>
                <Button kind="outline" onClick={() => navigate("/gg/profile/areas")}>
                  Add an area
                </Button>
              </>
            }
          >
            {state.wards.length ? "Reports from the wards you added show up here. Add another area, or report a problem you can see right now." : "Your feed comes from the wards in your profile. Add your home or work ward."}
          </StateBlock>
        )}
        {items.length > 0 && <CardList items={items} setItems={setItems} onPin={(d) => setPinDelta((x) => x + d)} />}
        {cursor && (
          <p ref={sentinel} className="py-6 text-center text-sm text-primary">
            {state.loading ? "Loading more reports…" : ""}
          </p>
        )}
        {state.error && items.length > 0 && (
          <div className="py-6 text-center">
            <Button kind="line" onClick={() => load(false)}>
              Try again
            </Button>
          </div>
        )}
      </div>
    </Shell>
  );
}

// A stable function that always calls the latest ref'd callback (keeps the pull listener from re-binding).
function useCallbackRef(ref) {
  const [fn] = useState(() => (...args) => ref.current?.(...args));
  return fn;
}

export function Pinned() {
  const { data, error, loading, reload, setData } = useData(() => api("/api/me/saved"), [], "saved");
  return (
    <Shell module="gg" title="Pinned Reports">
      <div className="mb-4 flex items-center gap-2">
        <button onClick={() => navigate("/gg/feed")} className="press -ml-2 grid size-11 place-items-center rounded-full hover:bg-soft/50" aria-label="Back to the feed">
          <Icon name="chevronLeft" className="size-6" strokeWidth={2.4} />
        </button>
        <h1 className="display text-[28px]">Pinned Reports</h1>
      </div>
      {loading && <CardSkeleton />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && data.length === 0 && (
        <StateBlock icon="pin" title="No pinned reports">
          Tap the pin on a report to keep it here. You get a notification when its status changes.
        </StateBlock>
      )}
      {data && data.length > 0 && <CardList items={data} setItems={setData} />}
    </Shell>
  );
}

// ---------- report form ----------

const STEPS = ["Category", "Location", "Photo", "Photo and text", "Review"];

function Chip({ icon, children }) {
  return (
    <span className="inline-flex min-h-10 items-center gap-2 rounded-full border border-hair bg-surface px-3.5 text-[14px] font-bold shadow-1">
      {icon && <Icon name={icon} className="size-4" />}
      {children}
    </span>
  );
}

function SectionCard({ title, children, className }) {
  return (
    <section className={cx("rounded-2xl border border-hair bg-surface p-4 shadow-1", className)}>
      {title && <h2 className="display mb-1.5 text-[17px]">{title}</h2>}
      {children}
    </section>
  );
}

export function ReportForm() {
  const { user } = useApp();
  const now = useNow();
  const cats = useCategories();
  const [step, setStep] = useState(1);
  const [category, setCategory] = useState(null);
  const [description, setDescription] = useState("");
  const [shot, setShot] = useState(null);
  const [retakeOf, setRetakeOf] = useState(null);
  const [pos, setPos] = useState(null);
  const [ward, setWard] = useState(undefined); // undefined = not looked up yet, null = outside the pilot area
  const [posError, setPosError] = useState(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  async function locate() {
    setPosError(null);
    setLocating(true);
    try {
      const p = await getPosition();
      setPos(p);
      setWard(undefined);
      api("/api/wards/locate", { query: { lat: p.lat, lon: p.lon } })
        .then((r) => setWard(r.ward))
        .catch(() => setWard(null));
    } catch (e) {
      setPosError(e.message);
    } finally {
      setLocating(false);
    }
  }
  useEffect(() => {
    if (step === 2 && !pos) locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const token = await ensureFreshToken(shot);
      const r = await api("/api/reports/civic", {
        method: "POST",
        form: { category: category.code, description: description.trim(), lat: pos.lat, lon: pos.lon, accuracy: pos.accuracy, capture_token: token, photo: shot.blob },
      });
      setDone(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (user?.role === "admin")
    return (
      <Shell module="gg" title="Report">
        <StateBlock icon="shield" title="Admin accounts cannot report">
          Use a citizen account to post reports (W5).
        </StateBlock>
      </Shell>
    );

  if (done)
    return (
      <Shell module="gg" title="Report">
        <div className="flex flex-col items-center gap-6 py-14 text-center">
          <m.span className="cp-pulse relative grid size-28 place-items-center rounded-full bg-primary text-on-primary shadow-[0_18px_40px_-12px_var(--primary)]" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={pop}>
            <Icon name="mapPin" className="size-12" />
          </m.span>
          <m.h1 className="wide text-[30px]" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...enter(), delay: 0.15 }}>
            Report sent
          </m.h1>
          <p className="max-w-sm text-[17px] leading-relaxed">We are checking it now. People in this ward are told about it, and you get a notification when its status changes.</p>
          <div className="flex w-full max-w-sm flex-col gap-3">
            <Button onClick={() => navigate("/gg/feed")}>Go to the feed</Button>
            <Button kind="outline" onClick={() => navigate("/gg/profile")}>
              See my reports
            </Button>
          </div>
        </div>
      </Shell>
    );

  const gpsChip = pos ? `GPS ± ${Math.round(pos.accuracy)} m` : null;
  const wardName = ward === undefined ? "Finding your ward…" : ward ? ward.name_en : "Outside the pilot area";
  const close = () => navigate("/gg/feed");

  return (
    <Shell module="gg" bare>
      <FormHeader title="Post a civic problem you want to share" note="This report cannot be edited once it has been posted." onClose={close} stamp={fmtLongStamp(now.toISOString())} />
      <StepBar step={step} total={5} className="mt-4" />
      <div className="mt-2 flex items-center justify-between text-sm">
        <b>
          Step {step} of 5 · {STEPS[step - 1]}
        </b>
        {step < 5 && <span className="text-primary">Next: {STEPS[step]}</span>}
      </div>
      {step > 1 && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Chip icon={categoryIcon(category?.code)}>{category?.name_en}</Chip>
          {gpsChip && <Chip icon="mapPin">{gpsChip}</Chip>}
          {pos && <Chip>Detected ward: {wardName}</Chip>}
        </div>
      )}

      <m.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={enter()}>
      {step === 1 && (
        <div className="mt-5">
          <h2 className="display text-xl">What kind of problem is it?</h2>
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
            {cats.loading && Array.from({ length: 6 }, (_, i) => <div key={i} className="cp-skeleton h-[72px] rounded-2xl" />)}
            {(cats.data || []).map((c) => (
              <button
                key={c.code}
                style={catStyle(c.code)}
                onClick={() => {
                  setCategory(c);
                  setStep(2);
                }}
                className={cx("press flex min-h-[72px] items-center gap-3 rounded-2xl border-[1.5px] bg-surface px-4 text-left shadow-1 transition-colors duration-150", category?.code === c.code ? "border-cat" : "border-hair hover:border-cat/60")}
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-cat text-white shadow-[0_8px_16px_-8px_var(--cat)]">
                  <Icon name={categoryIcon(c.code)} className="size-6" />
                </span>
                <span>
                  <span className="block font-bold">{c.name_en}</span>
                  <span className="block text-sm text-ink/75" lang="bn">
                    {c.name_bn}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="mt-5 space-y-4">
          <SectionCard title="Where is the problem?">
            <p className="text-[15px] text-ink/85">Stand near the problem. Your exact spot is used to check the report and to find your ward; others see only the ward.</p>
            <div className="tint mt-4 flex items-center gap-3 rounded-xl px-4 py-3">
              <Icon name="locate" className={cx("size-6 text-primary", locating && "animate-pulse")} />
              <div className="min-w-0 flex-1">
                {pos ? (
                  <>
                    <p className="num font-bold">GPS ± {Math.round(pos.accuracy)} m</p>
                    <p className="text-sm text-primary">{wardName}</p>
                  </>
                ) : (
                  <p className="font-semibold">{locating ? "Getting your location…" : "Location not found yet"}</p>
                )}
              </div>
              <Button kind="line" size="sm" onClick={locate} busy={locating}>
                Update
              </Button>
            </div>
            {pos && pos.accuracy > 50 && <p className="mt-3 text-sm font-medium text-warn-ink">The location is weak. Move to an open spot and tap Update for a better fix.</p>}
            {posError && (
              <p role="alert" className="mt-3 flex items-start gap-1.5 text-sm font-medium text-err">
                <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
                {posError}
              </p>
            )}
          </SectionCard>
          <div className="grid grid-cols-[1fr_2fr] gap-3">
            <Button kind="outline" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button onClick={() => setStep(3)} disabled={!pos}>
              Next: photo
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="mt-5 space-y-3">
          <SectionCard title="Photo of the problem">
            <p className="mb-3 text-[15px] text-ink/85">Take a new photo in the app. Photos from the gallery are not allowed, so every report is fresh.</p>
            <Camera
              purpose="report"
              retakeOf={retakeOf}
              confirm={false}
              onShot={(s) => {
                setShot(s);
                setStep(4);
              }}
              onCancel={() => setStep(shot ? 4 : 2)}
            />
          </SectionCard>
        </div>
      )}

      {step === 4 && shot && (
        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setStep(5);
          }}
        >
          <SectionCard title="Photo of the problem">
            <p className="text-[15px] text-ink/85">Take a clear photo of the problem. You can retake it before you post.</p>
            <div className="relative mt-3 aspect-[4/3] overflow-hidden rounded-xl bg-soft">
              <img src={shot.url} alt="Captured photo" className="size-full object-cover" />
              <span className="num absolute bottom-3 left-3 rounded-full bg-black/70 px-3 py-1 text-[13px] font-bold text-white">Taken {fmtTime(shot.taken_at)}</span>
            </div>
            <Button
              type="button"
              kind="outline"
              icon="refresh"
              className="mt-3 w-full"
              disabled={shot.retakes_left <= 0}
              onClick={() => {
                setRetakeOf(shot.token);
                setStep(3);
              }}
            >
              Retake ({shot.retakes_left} left)
            </Button>
            <p className="mt-2 text-sm text-warn-ink">Post within 10 minutes of taking the photo, or retake it.</p>
          </SectionCard>
          <SectionCard title="Describe the problem">
            <label htmlFor="desc" className="sr-only">
              Describe the problem
            </label>
            <textarea
              id="desc"
              className={cx(textareaCls("min-h-40"), "mt-2")}
              rows={5}
              minLength={3}
              maxLength={2000}
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Example: Knee-deep water on the road in front of the school since last night. Rickshaws cannot pass."
            />
            <p className="mt-2 flex justify-between text-sm">
              <span className="text-primary">Required · Bangla, English or Banglish</span>
              <b className="num">{description.length.toLocaleString("en-US")} / 2,000</b>
            </p>
          </SectionCard>
          <div className="grid grid-cols-[1fr_2fr] gap-3">
            <Button type="button" kind="outline" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button disabled={description.trim().length < 3}>Next: review</Button>
          </div>
        </form>
      )}

      {step === 5 && (
        <div className="mt-5 space-y-4">
          <SectionCard title="Check before you post">
            <div className="mt-2 flex gap-4">
              <img src={shot.url} alt="Your photo" className="size-28 shrink-0 rounded-xl object-cover" />
              <div className="min-w-0 space-y-1">
                <p className="font-bold">{category.name_en}</p>
                <p className="text-sm text-primary">{wardName}</p>
                <p className="line-clamp-4 text-[15px]">{description}</p>
              </div>
            </div>
            <ul className="mt-4 space-y-2 text-[15px]">
              <li className="flex gap-2">
                <Icon name="lock" className="mt-0.5 size-4 shrink-0" />
                The report cannot be edited after you post it.
              </li>
              <li className="flex gap-2">
                <Icon name="clock" className="mt-0.5 size-4 shrink-0" />
                You can post one civic report per day.
              </li>
              <li className="flex gap-2">
                <Icon name="users" className="mt-0.5 size-4 shrink-0" />
                People in {ward ? ward.name_en : "this area"} are asked to verify it.
              </li>
            </ul>
          </SectionCard>
          {error && (
            <p role="alert" className="flex items-start gap-1.5 font-medium text-err">
              <Icon name="alert" className="mt-0.5 size-5 shrink-0" />
              {error}
            </p>
          )}
          <div className="grid grid-cols-[1fr_2fr] gap-3">
            <Button kind="outline" onClick={() => setStep(4)}>
              Back
            </Button>
            <Button onClick={send} busy={busy} busyLabel="Posting…">
              Post report
            </Button>
          </div>
        </div>
      )}
      </m.div>
    </Shell>
  );
}
