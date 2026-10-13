// Green Guard: ward feed with the pinned-reports bar, the pinned list and the 5-step report form
// (boards: Green Guard feed, States, Report form step 4; W2, W3, T3, T6).
import { m } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Camera, ensureFreshToken } from "../components/Camera.jsx";
import { Icon, categoryIcon } from "../components/icons.jsx";
import { ReportCard, ReportDialog } from "../components/Report.jsx";
import { Shell } from "../components/Shell.jsx";
import { Button, CardSkeleton, enter, ErrorState, FormHeader, StateBlock, StepBar, cx, textareaCls, useNow } from "../components/ui.jsx";
import { api } from "../lib/api.js";
import { fmtLongStamp, fmtTime } from "../lib/format.js";
import { getPosition } from "../lib/geo.js";
import { Link, navigate } from "../lib/router.jsx";
import { useApp, useData } from "../lib/store.jsx";

function useCategories() {
  return useData(() => api("/api/categories"), []);
}

function CardList({ items, setItems, onPin }) {
  const [open, setOpen] = useState(null); // { id, mode, focus }
  const replace = (r) => {
    const before = items.find((x) => x.id === r.id);
    if (before && r.saved !== undefined && before.saved !== r.saved) onPin?.(r.saved ? 1 : -1);
    setItems(items.map((x) => (x.id === r.id ? { ...x, ...r } : x)));
  };
  return (
    <>
      <div className="grid gap-4">
        {items.map((r, i) => (
          // Stagger 40 ms, at most 6 items (motion tokens); later pages appear without delay.
          <m.div key={r.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...enter(), delay: Math.min(i % 10, 5) * 0.04 }}>
            <ReportCard report={r} onOpen={(x, mode, focus) => setOpen({ id: x.id, mode, focus })} onSaved={(saved) => replace({ ...r, saved })} />
          </m.div>
        ))}
      </div>
      <ReportDialog id={open?.id} initialMode={open?.mode} focus={open?.focus} onClose={() => setOpen(null)} onChanged={(full) => replace(full)} />
    </>
  );
}

function PinnedBar({ count }) {
  return (
    <Link to="/gg/pinned" className="mb-4 flex min-h-12 items-center gap-2.5 rounded-xl bg-soft/80 px-4 font-bold hover:bg-soft">
      <Icon name="pinFilled" className="size-5" />
      <span className="flex-1">Pinned Reports</span>
      <span className="num flex items-center">
        {count ?? ""}
        <Icon name="chevronRight" className="size-5" strokeWidth={2.4} />
      </span>
    </Link>
  );
}

export function Feed() {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [state, setState] = useState({ loading: true, error: null, wards: [] });
  const pinned = useData(() => api("/api/me/saved"), []);
  const sentinel = useRef(null);

  async function load(reset) {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await api("/api/feed", { query: { cursor: reset ? undefined : cursor } });
      setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
      setCursor(res.next_cursor);
      setState({ loading: false, error: null, wards: res.wards });
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error }));
    }
  }
  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <Shell module="gg">
      <PinnedBar count={pinnedCount} />
      {state.error && items.length === 0 && <ErrorState error={state.error} onRetry={() => load(true)} title="Couldn't load the feed" note="Your pinned reports are still saved." />}
      {!state.error && state.loading && items.length === 0 && (
        <div className="grid gap-4">
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
    </Shell>
  );
}

export function Pinned() {
  const { data, error, loading, reload, setData } = useData(() => api("/api/me/saved"), []);
  return (
    <Shell module="gg" title="Pinned Reports">
      <div className="mb-4 flex items-center gap-2">
        <button onClick={() => navigate("/gg/feed")} className="-ml-2 grid size-11 place-items-center rounded-full hover:bg-soft/50" aria-label="Back to the feed">
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
    <span className="inline-flex min-h-10 items-center gap-2 rounded-full border-[1.5px] border-line bg-white px-3.5 text-[14px] font-bold">
      {icon && <Icon name={icon} className="size-4" />}
      {children}
    </span>
  );
}

function SectionCard({ title, children, className }) {
  return (
    <section className={cx("rounded-2xl border border-line/80 bg-white p-4", className)}>
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
          <span className="cp-pulse relative grid size-28 place-items-center rounded-full bg-primary text-white">
            <Icon name="mapPin" className="size-12" />
          </span>
          <h1 className="display text-[28px]">Report sent</h1>
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

      {step === 1 && (
        <div className="mt-5">
          <h2 className="display text-xl">What kind of problem is it?</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {cats.loading && Array.from({ length: 6 }, (_, i) => <div key={i} className="cp-skeleton h-[72px] rounded-2xl" />)}
            {(cats.data || []).map((c) => (
              <button
                key={c.code}
                onClick={() => {
                  setCategory(c);
                  setStep(2);
                }}
                className={cx("flex min-h-[72px] items-center gap-3 rounded-2xl border-[1.5px] bg-white px-4 text-left", category?.code === c.code ? "border-primary" : "border-line/80 hover:border-primary/60")}
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-soft text-primary">
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
              <span className="num absolute bottom-3 left-3 rounded-full bg-ink/90 px-3 py-1 text-[13px] font-bold text-white">Taken {fmtTime(shot.taken_at)}</span>
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
    </Shell>
  );
}
