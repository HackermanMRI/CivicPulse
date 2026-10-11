// Green Guard: ward feed, pinned posts and the civic report form (W2, W3, T3, T6).
import { useEffect, useState } from "react";
import { Camera, ensureFreshToken } from "../components/Camera.jsx";
import { ReportCard, ReportDialog } from "../components/Report.jsx";
import { Shell } from "../components/Shell.jsx";
import { Button, CardSkeleton, Empty, ErrorState, Field, PageTitle, Tabs, cx, inputCls } from "../components/ui.jsx";
import { api } from "../lib/api.js";
import { getPosition } from "../lib/geo.js";
import { Link, navigate } from "../lib/router.jsx";
import { useApp, useData } from "../lib/store.jsx";

function useCategories() {
  return useData(() => api("/api/categories"), []);
}

function CardList({ items, setItems }) {
  const [open, setOpen] = useState(null);
  const replace = (r) => setItems(items.map((x) => (x.id === r.id ? { ...x, ...r } : x)));
  return (
    <>
      <div className="grid gap-4">
        {items.map((r) => (
          <ReportCard key={r.id} report={r} onOpen={(x) => setOpen(x.id)} onSaved={(saved) => replace({ ...r, saved })} />
        ))}
      </div>
      <ReportDialog id={open} onClose={() => setOpen(null)} onChanged={(full) => replace(full)} />
    </>
  );
}

export function Feed() {
  const cats = useCategories();
  const [category, setCategory] = useState("");
  const [voted, setVoted] = useState("all");
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [state, setState] = useState({ loading: true, error: null, wards: [] });

  async function load(reset) {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await api("/api/feed", {
        query: { category, voted: voted === "all" ? undefined : voted === "voted", cursor: reset ? undefined : cursor },
      });
      setItems(reset ? res.items : [...items, ...res.items]);
      setCursor(res.next_cursor);
      setState({ loading: false, error: null, wards: res.wards });
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error }));
    }
  }
  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, voted]);

  return (
    <Shell module="gg">
      <PageTitle title="Your areas" subtitle="Reports from the wards in your profile." action={<Link to="/gg/report" className="hidden rounded-md bg-primary px-4 py-2 font-semibold text-white md:inline-flex">Report an issue</Link>} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <select className={cx(inputCls, "sm:w-60")} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {(cats.data || []).map((c) => (
            <option key={c.code} value={c.code}>
              {c.name_en} · {c.name_bn}
            </option>
          ))}
        </select>
        <Tabs
          className="flex-1"
          value={voted}
          onChange={setVoted}
          tabs={[
            { value: "all", label: "All" },
            { value: "todo", label: "To verify" },
            { value: "voted", label: "Voted" },
          ]}
        />
      </div>
      {state.error && <ErrorState error={state.error} onRetry={() => load(true)} />}
      {!state.error && state.loading && items.length === 0 && (
        <div className="grid gap-4">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      )}
      {!state.loading && !state.error && items.length === 0 && (
        <Empty title={state.wards.length ? "Nothing here yet" : "No areas in your profile"} action={state.wards.length ? <Link to="/gg/report" className="font-semibold text-primary underline">Report an issue</Link> : <Link to="/profile" className="font-semibold text-primary underline">Add an area</Link>}>
          {state.wards.length ? "No reports match these filters in your wards." : "Add your home or work ward to see reports near you."}
        </Empty>
      )}
      {items.length > 0 && <CardList items={items} setItems={setItems} />}
      {cursor && (
        <div className="mt-6 flex justify-center">
          <Button kind="outline" onClick={() => load(false)} busy={state.loading}>
            Show more
          </Button>
        </div>
      )}
    </Shell>
  );
}

export function Pinned() {
  const { data, error, loading, reload, setData } = useData(() => api("/api/me/saved"), []);
  return (
    <Shell module="gg">
      <PageTitle title="Pinned reports" subtitle="Posts you saved to verify later." />
      {loading && <CardSkeleton />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && data.length === 0 && <Empty title="No pinned reports">Use “Pin” on a feed card to keep it here.</Empty>}
      {data && data.length > 0 && <CardList items={data} setItems={setData} />}
    </Shell>
  );
}

const STEPS = ["Category", "Describe", "Photo", "Send"];

export function ReportForm() {
  const { toast, user } = useApp();
  const cats = useCategories();
  const [step, setStep] = useState(0);
  const [category, setCategory] = useState(null);
  const [description, setDescription] = useState("");
  const [shot, setShot] = useState(null);
  const [pos, setPos] = useState(null);
  const [posError, setPosError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  async function locate() {
    setPosError(null);
    try {
      setPos(await getPosition());
    } catch (e) {
      setPosError(e.message);
    }
  }
  useEffect(() => {
    if (step === 3 && !pos) locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function send() {
    setBusy(true);
    try {
      const token = await ensureFreshToken(shot);
      const r = await api("/api/reports/civic", {
        method: "POST",
        form: { category: category.code, description, lat: pos.lat, lon: pos.lon, accuracy: pos.accuracy, capture_token: token, photo: shot.blob },
      });
      setDone(r);
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (user?.role === "admin")
    return (
      <Shell module="gg">
        <Empty title="Admin accounts cannot report">Use a citizen account to post reports (W5).</Empty>
      </Shell>
    );

  if (done)
    return (
      <Shell module="gg">
        <div className="flex flex-col items-center gap-6 py-12 text-center">
          <span className="cp-pulse relative grid size-24 place-items-center rounded-full bg-primary text-4xl text-white">✓</span>
          <h1 className="text-2xl font-bold">Report sent</h1>
          <p className="max-w-sm text-ink/75">We are checking it now. People in this ward are told about it, and you will get a notification when its status changes.</p>
          <div className="flex gap-3">
            <Button onClick={() => navigate("/gg/feed")}>Go to the feed</Button>
            <Button kind="outline" onClick={() => navigate("/profile")}>
              My reports
            </Button>
          </div>
        </div>
      </Shell>
    );

  return (
    <Shell module="gg">
      <PageTitle title="Report an issue" subtitle={`Step ${step + 1} of 4 · ${STEPS[step]}`} />
      <ol className="mb-6 flex gap-1.5" aria-hidden>
        {STEPS.map((s, i) => (
          <li key={s} className={cx("h-1.5 flex-1 rounded-full", i <= step ? "bg-primary" : "bg-soft")} />
        ))}
      </ol>
      {step === 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {(cats.data || []).map((c) => (
            <button
              key={c.code}
              onClick={() => {
                setCategory(c);
                setStep(1);
              }}
              className={cx("min-h-16 rounded-lg border-2 bg-white p-4 text-left shadow-1", category?.code === c.code ? "border-primary" : "border-line/60")}
            >
              <span className="block font-semibold">{c.name_en}</span>
              <span className="block text-ink/65" lang="bn">
                {c.name_bn}
              </span>
            </button>
          ))}
        </div>
      )}
      {step === 1 && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setStep(2);
          }}
        >
          <Field label={`What is the ${category.name_en.toLowerCase()} problem?`} id="d" hint={`Bangla, English or Banglish. ${description.length}/2000`}>
            <textarea id="d" className={inputCls} rows={5} minLength={3} maxLength={2000} required value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Example: Water is standing on the road after the rain, rickshaws cannot pass." />
          </Field>
          <div className="flex gap-3">
            <Button type="button" kind="outline" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button className="flex-1">Continue</Button>
          </div>
        </form>
      )}
      {step === 2 && (
        <div className="space-y-4">
          <p className="text-ink/75">Take a new photo of the problem. Photos from the gallery are not allowed, so every report is fresh.</p>
          <Camera
            purpose="report"
            onShot={(s) => {
              setShot(s);
              setStep(3);
            }}
            onCancel={() => setStep(1)}
          />
        </div>
      )}
      {step === 3 && (
        <div className="space-y-4">
          <div className="flex gap-4 rounded-lg border border-line/60 bg-white p-3">
            {shot && <img src={shot.url} alt="Your photo" className="size-28 rounded-md object-cover" />}
            <div className="min-w-0 space-y-1">
              <p className="font-semibold">{category.name_en}</p>
              <p className="line-clamp-4 text-ink/80">{description}</p>
            </div>
          </div>
          <div className="rounded-lg bg-soft/50 p-3">
            <p className="font-semibold">Location</p>
            {pos && (
              <p className="num text-sm">
                {pos.lat.toFixed(5)}, {pos.lon.toFixed(5)} · accuracy {Math.round(pos.accuracy)} m {pos.accuracy > 50 && <span className="font-medium text-warn-ink">(weak, move to an open spot for a better fix)</span>}
              </p>
            )}
            {posError && (
              <p role="alert" className="text-sm font-medium text-err">
                {posError}
              </p>
            )}
            {!pos && !posError && <p className="text-sm">Getting your location…</p>}
            <button className="mt-1 min-h-11 text-sm font-semibold text-primary underline" onClick={locate}>
              Update location
            </button>
          </div>
          <div className="flex gap-3">
            <Button kind="outline" onClick={() => setStep(2)}>
              Retake
            </Button>
            <Button size="lg" className="flex-1" onClick={send} disabled={!pos} busy={busy}>
              Send report
            </Button>
          </div>
          <p className="text-sm text-ink/65">You can post one civic report per day.</p>
        </div>
      )}
    </Shell>
  );
}
