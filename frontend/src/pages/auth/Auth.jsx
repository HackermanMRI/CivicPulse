// Login, sign-up (phone → code → name & password → permissions → areas) and forgot password (C2, C7, W1).
import { useEffect, useState } from "react";
import { Plain } from "../../components/Shell.jsx";
import { Button, Field, inputCls } from "../../components/ui.jsx";
import { api } from "../../lib/api.js";
import { Link, navigate } from "../../lib/router.jsx";
import { useApp } from "../../lib/store.jsx";

function Brand({ subtitle }) {
  return (
    <div className="mb-8 flex flex-col items-center gap-3 text-center">
      <span className="relative grid size-16 place-items-center rounded-full bg-primary">
        <span className="size-4 rounded-full bg-white" />
        <span className="absolute inset-0 rounded-full border-2 border-primary/40" style={{ transform: "scale(1.35)" }} />
      </span>
      <h1 className="text-3xl font-bold">CivicPulse</h1>
      {subtitle && <p className="text-ink/75">{subtitle}</p>}
    </div>
  );
}

function DevCode({ code }) {
  if (!code) return null;
  return (
    <p className="rounded-md border-2 border-dashed border-info/60 bg-info/10 px-3 py-2 text-sm">
      Demo build: no SMS is sent. Your code is <b className="num text-base tracking-widest">{code}</b>
    </p>
  );
}

function useAfterLogin() {
  return (me) => {
    if (me.role === "admin") navigate("/admin", { replace: true });
    else if (!me.preferred_module) navigate("/modules", { replace: true });
    else navigate(me.preferred_module === "price_patrol" ? "/pp" : "/gg/feed", { replace: true });
  };
}

export function Login() {
  const { signIn } = useApp();
  const after = useAfterLogin();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState(null); // admin second step
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (otp) {
        const s = await api("/api/auth/login/admin", { method: "POST", body: { phone, password, code } });
        after(await signIn(s));
      } else {
        const s = await api("/api/auth/login", { method: "POST", body: { phone, password } });
        if (s.otp_required) setOtp(s);
        else after(await signIn(s));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Plain>
      <Brand subtitle="Report civic problems and market prices. See how credible each report is." />
      <form onSubmit={submit} className="space-y-4">
        <Field label="Phone number" id="phone">
          <input id="phone" className={inputCls} inputMode="tel" autoComplete="tel" placeholder="01712345678" required value={phone} onChange={(e) => setPhone(e.target.value)} disabled={Boolean(otp)} />
        </Field>
        <Field label="Password" id="password">
          <input id="password" type="password" className={inputCls} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} disabled={Boolean(otp)} />
        </Field>
        {otp && (
          <>
            <DevCode code={otp.dev_code} />
            <Field label="Admin code" id="code" hint="Admin accounts need a code every time.">
              <input id="code" className={inputCls} inputMode="numeric" autoComplete="one-time-code" pattern="\d{4,10}" required value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
          </>
        )}
        {error && (
          <p role="alert" className="font-medium text-err">
            {error}
          </p>
        )}
        <Button size="lg" className="w-full" busy={busy}>
          Log in
        </Button>
      </form>
      <div className="mt-6 flex justify-between text-sm font-semibold">
        <Link to="/forgot" className="text-primary underline">
          Forgot password?
        </Link>
        <Link to="/signup" className="text-primary underline">
          Create an account
        </Link>
      </div>
      <p className="mt-8 text-center text-xs text-ink/60">Email is optional and can be added later in your profile.</p>
    </Plain>
  );
}

function PhoneCode({ purpose, onTicket, title }) {
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function request(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSent(await api("/api/auth/otp/request", { method: "POST", body: { phone, purpose } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function verify(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api("/api/auth/otp/verify", { method: "POST", body: { phone, purpose, code } });
      onTicket(r.ticket, phone);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={sent ? verify : request} className="space-y-4">
      <h2 className="text-xl font-semibold">{title}</h2>
      <Field label="Phone number" id="p" hint="Bangladeshi mobile number">
        <input id="p" className={inputCls} inputMode="tel" autoComplete="tel" placeholder="01712345678" required value={phone} onChange={(e) => setPhone(e.target.value)} disabled={Boolean(sent)} />
      </Field>
      {sent && (
        <>
          <DevCode code={sent.dev_code} />
          <Field label="6-digit code" id="c" hint="The code works for 5 minutes, with 5 tries.">
            <input id="c" className={inputCls} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
        </>
      )}
      {error && (
        <p role="alert" className="font-medium text-err">
          {error}
        </p>
      )}
      <Button size="lg" className="w-full" busy={busy}>
        {sent ? "Verify code" : "Send code"}
      </Button>
      {sent && (
        <button type="button" className="text-sm font-semibold text-primary underline" onClick={() => setSent(null)}>
          Use another number or get a new code
        </button>
      )}
    </form>
  );
}

function Steps({ n, total }) {
  return (
    <ol className="mb-6 flex gap-1.5" aria-label={`Step ${n} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <li key={i} className={`h-1.5 flex-1 rounded-full ${i < n ? "bg-primary" : "bg-soft"}`} />
      ))}
    </ol>
  );
}

export function Signup() {
  const { signIn } = useApp();
  const after = useAfterLogin();
  const [step, setStep] = useState(1);
  const [ticket, setTicket] = useState(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [consents, setConsents] = useState({ location: false, camera: false, research_use: false });
  const [wards, setWards] = useState([]);
  const [addresses, setAddresses] = useState([{ kind: "home", ward_id: "" }]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/api/wards").then(setWards).catch(() => setWards([]));
  }, []);

  async function finish(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await api("/api/auth/register", {
        method: "POST",
        body: {
          ticket, display_name: name, password, consents,
          addresses: addresses.map((a) => ({ kind: a.kind, ward_id: a.ward_id === "" || a.ward_id === "none" ? null : Number(a.ward_id) })),
        },
      });
      const me = await signIn(s);
      after(me);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Plain>
      <Brand />
      <Steps n={step} total={4} />
      {step === 1 && (
        <PhoneCode
          purpose="signup"
          title="Create your account"
          onTicket={(t) => {
            setTicket(t);
            setStep(2);
          }}
        />
      )}
      {step === 2 && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setStep(3);
          }}
        >
          <h2 className="text-xl font-semibold">About you</h2>
          <Field label="Your name" id="n" hint="Shown on your reports.">
            <input id="n" className={inputCls} autoComplete="name" minLength={2} maxLength={80} required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Password" id="pw" hint="At least 8 characters, not only numbers. Pasting from a password manager is fine.">
            <input id="pw" type="password" className={inputCls} autoComplete="new-password" minLength={8} maxLength={128} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button size="lg" className="w-full">
            Continue
          </Button>
        </form>
      )}
      {step === 3 && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setStep(4);
          }}
        >
          <h2 className="text-xl font-semibold">Permissions</h2>
          <p className="text-ink/75">CivicPulse is a university research pilot. All three are needed to take part (C2).</p>
          {[
            ["location", "Location", "To check where a report or an on-the-spot vote was made. Your home is stored as a ward only, never as a point."],
            ["camera", "Camera", "Photos are taken in the app only, so they are fresh."],
            ["research_use", "Research use", "Your reports and votes (without your phone number) may be used in the final-year research."],
          ].map(([k, title, text]) => (
            <label key={k} className="flex cursor-pointer gap-3 rounded-md border-2 border-line/60 bg-white p-3">
              <input type="checkbox" required className="mt-1 size-5 accent-[var(--primary)]" checked={consents[k]} onChange={(e) => setConsents({ ...consents, [k]: e.target.checked })} />
              <span>
                <span className="block font-semibold">{title}</span>
                <span className="block text-sm text-ink/75">{text}</span>
              </span>
            </label>
          ))}
          <Button size="lg" className="w-full" disabled={!Object.values(consents).every(Boolean)}>
            Continue
          </Button>
        </form>
      )}
      {step === 4 && (
        <form className="space-y-4" onSubmit={finish}>
          <h2 className="text-xl font-semibold">Your areas</h2>
          <p className="text-ink/75">Add home, work or other places. Your feed and alerts come from these wards.</p>
          {addresses.map((a, i) => (
            <div key={i} className="grid grid-cols-[7rem_1fr_auto] items-end gap-2">
              <select className={inputCls} value={a.kind} onChange={(e) => setAddresses(addresses.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))} aria-label="Kind">
                <option value="home">Home</option>
                <option value="work">Work</option>
                <option value="other">Other</option>
              </select>
              <select className={inputCls} required value={a.ward_id} onChange={(e) => setAddresses(addresses.map((x, j) => (j === i ? { ...x, ward_id: e.target.value } : x)))} aria-label="Ward">
                <option value="" disabled>
                  Choose a ward
                </option>
                {wards.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name_en} · {w.name_bn}
                  </option>
                ))}
                <option value="none">Outside the pilot area</option>
              </select>
              {addresses.length > 1 ? (
                <button type="button" className="grid size-11 place-items-center rounded-md text-xl hover:bg-soft" aria-label="Remove" onClick={() => setAddresses(addresses.filter((_, j) => j !== i))}>
                  ×
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
          <Button type="button" kind="outline" onClick={() => setAddresses([...addresses, { kind: "other", ward_id: "" }])}>
            Add another area
          </Button>
          {error && (
            <p role="alert" className="font-medium text-err">
              {error}
            </p>
          )}
          <Button size="lg" className="w-full" busy={busy}>
            Create account
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        Already have an account?{" "}
        <Link to="/login" className="font-semibold text-primary underline">
          Log in
        </Link>
      </p>
    </Plain>
  );
}

export function Forgot() {
  const { toast } = useApp();
  const [ticket, setTicket] = useState(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  return (
    <Plain>
      <Brand />
      {!ticket ? (
        <PhoneCode purpose="reset" title="Reset your password" onTicket={(t) => setTicket(t)} />
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api("/api/auth/password/reset", { method: "POST", body: { ticket, new_password: password } });
              toast("Password changed. Log in with the new one.", "ok");
              navigate("/login", { replace: true });
            } catch (err) {
              setError(err.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2 className="text-xl font-semibold">New password</h2>
          <Field label="New password" id="np" hint="At least 8 characters. You will be logged out on other phones.">
            <input id="np" type="password" className={inputCls} autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && (
            <p role="alert" className="font-medium text-err">
              {error}
            </p>
          )}
          <Button size="lg" className="w-full" busy={busy}>
            Save password
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="font-semibold text-primary underline">
          Back to log in
        </Link>
      </p>
    </Plain>
  );
}

export function ModulePicker() {
  const { user, setUser } = useApp();
  async function pick(module) {
    try {
      await api("/api/me", { method: "PATCH", body: { preferred_module: module } });
      setUser({ ...user, preferred_module: module });
    } catch {
      /* the choice is only a default; navigation still works */
    }
    navigate(module === "price_patrol" ? "/pp" : "/gg/feed");
  }
  return (
    <Plain>
      <Brand subtitle={`Hi ${user?.display_name || ""}, where do you want to start?`} />
      <div className="grid gap-4">
        <button data-module="gg" onClick={() => pick("green_guard")} className="rounded-xl border-2 border-line bg-bg p-5 text-left shadow-1 hover:shadow-2">
          <span className="block text-xl font-bold text-primary">Green Guard</span>
          <span className="block text-ink">Report waterlogging, garbage, broken roads and more. Verify reports near you.</span>
        </button>
        <button data-module="pp" onClick={() => pick("price_patrol")} className="rounded-xl border-2 border-line bg-bg p-5 text-left shadow-1 hover:shadow-2">
          <span className="block text-xl font-bold text-primary">Price Patrol</span>
          <span className="block text-ink">Share what rice, onion or eggs cost today. See verified market prices.</span>
        </button>
      </div>
      <p className="mt-6 text-center text-sm text-ink/70">You can switch any time from the top bar.</p>
    </Plain>
  );
}
