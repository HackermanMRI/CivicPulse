// Login, sign-up (phone → code → name & password → permissions → areas), forgot password and the module picker
// (boards: Login, Module picker, Sign-up steps 2/4/5; C2, C7, W1).
import { useEffect, useMemo, useRef, useState } from "react";
import { AreaEditor } from "../../components/Areas.jsx";
import { Icon, Logo } from "../../components/icons.jsx";
import { Plain } from "../../components/Shell.jsx";
import { Button, Field, StepBar, cx, inputBase, inputCls } from "../../components/ui.jsx";
import { api } from "../../lib/api.js";
import { Link, navigate } from "../../lib/router.jsx";
import { useApp } from "../../lib/store.jsx";

// ---------- shared parts ----------

// Topographic lines behind the login card (decorative, generated once).
function contour(cx0, cy0, rings, base, seed) {
  const out = [];
  for (let k = 1; k <= rings; k++) {
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const t = (i / 64) * Math.PI * 2;
      const r = base * k * (1 + 0.13 * Math.sin(3 * t + seed + k * 0.35) + 0.07 * Math.sin(5 * t + seed * 2 + k * 0.6));
      pts.push(`${(cx0 + r * Math.cos(t)).toFixed(1)},${(cy0 + r * 0.82 * Math.sin(t)).toFixed(1)}`);
    }
    out.push(`M${pts.join("L")}Z`);
  }
  return out;
}
const CONTOURS = [...contour(330, 110, 9, 24, 1.3), ...contour(-10, 600, 8, 30, 4.1)];

function Contours() {
  return (
    <svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 400 860" preserveAspectRatio="xMidYMin slice" aria-hidden>
      {CONTOURS.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="var(--line)" strokeOpacity="0.55" strokeWidth="1.2" />
      ))}
    </svg>
  );
}

// Phone field with a fixed +880 prefix. Accepts 1XXXXXXXXX, 01XXXXXXXXX or +8801XXXXXXXXX and sends +880….
export function toE164(raw) {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("880")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  return `+880${d}`;
}
function PhoneInput({ id, value, onChange, disabled, invalid }) {
  return (
    <div className={cx("flex min-h-[52px] overflow-hidden rounded-lg border-[1.5px] bg-white focus-within:border-ink focus-within:ring-1 focus-within:ring-ink", invalid ? "border-err" : "border-line")}>
      <span className="grid place-items-center border-r-[1.5px] border-line bg-soft/40 px-3.5 text-[17px] font-bold">+880</span>
      <input
        id={id}
        className="min-w-0 flex-1 bg-transparent px-3.5 text-[17px] placeholder:text-ink/45 focus:outline-none disabled:text-ink/55"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder="1XXXXXXXXX"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={invalid || undefined}
      />
    </div>
  );
}

function PasswordInput({ id, value, onChange, autoComplete, placeholder, minLength, invalid }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? "text" : "password"}
        className={cx(inputBase, "min-h-[52px] py-2.5 pl-3.5 pr-12 text-[17px]")}
        autoComplete={autoComplete}
        placeholder={placeholder}
        minLength={minLength}
        maxLength={128}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
      />
      <button type="button" onClick={() => setShow(!show)} className="absolute right-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-lg text-ink/80 hover:bg-soft/50" aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}>
        <Icon name={show ? "eyeOff" : "eye"} className="size-5" />
      </button>
    </div>
  );
}

function FormError({ children }) {
  if (!children) return null;
  return (
    <p role="alert" className="flex items-start gap-1.5 text-sm font-medium text-err">
      <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
      {children}
    </p>
  );
}

function DemoCode({ code }) {
  if (!code) return null;
  return (
    <div className="rounded-xl border-[1.5px] border-dashed border-primary/70 px-4 py-3">
      <p className="text-[13px] font-bold">Demo mode only</p>
      <p className="mt-0.5 text-[15px] leading-relaxed">
        Your code is <b className="num tracking-[0.2em]">{code}</b>. Real SMS is turned off for the defence.
      </p>
    </div>
  );
}

// Six boxes, one real input on top (one-time-code autofill and screen readers see a single field).
function CodeBoxes({ value, onChange, invalid, id }) {
  const ref = useRef(null);
  const [focus, setFocus] = useState(false);
  return (
    <div className="relative" onClick={() => ref.current?.focus()}>
      <div className="grid grid-cols-6 gap-2.5" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => {
          const current = focus && i === Math.min(value.length, 5);
          return (
            <span
              key={i}
              className={cx(
                "num grid aspect-[5/6] place-items-center rounded-lg border-[1.5px] bg-white text-2xl font-bold",
                current ? "border-ink ring-1 ring-ink" : invalid && value.length === 6 ? "border-err" : value[i] ? "border-line" : "border-line/70",
              )}
            >
              {value[i] || ""}
            </span>
          );
        })}
      </div>
      <input
        ref={ref}
        id={id}
        className="absolute inset-0 size-full cursor-text opacity-0"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        value={value}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        aria-invalid={invalid || undefined}
      />
    </div>
  );
}

function useCountdown(seconds, key) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    setLeft(seconds);
    const t = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [seconds, key]);
  return left;
}

function FlowHeader({ onBack }) {
  return (
    <div className="relative flex min-h-12 items-center justify-center">
      {onBack && (
        <button type="button" onClick={onBack} className="absolute left-0 grid size-11 place-items-center rounded-full hover:bg-soft/50" aria-label="Back">
          <Icon name="chevronLeft" className="size-6" strokeWidth={2.4} />
        </button>
      )}
      <span className="flex items-center gap-2.5">
        <Logo size="sm" />
        <span className="display text-[17px]">CivicPulse</span>
      </span>
    </div>
  );
}

function StepTitle({ step, total, what, title, children }) {
  return (
    <div className="mt-5">
      <StepBar step={step} total={total} currentFull />
      <p className="mt-2.5 text-sm text-primary">
        <b className="text-ink">
          Step {step} of {total},
        </b>{" "}
        {what}
      </p>
      <h1 className="display mt-5 text-[28px] leading-[34px]">{title}</h1>
      {children && <p className="mt-3 text-[17px] leading-relaxed">{children}</p>}
    </div>
  );
}

function useAfterLogin() {
  return (me) => {
    if (me.role === "admin") navigate("/admin", { replace: true });
    else if (!me.preferred_module) navigate("/modules", { replace: true });
    else navigate(me.preferred_module === "price_patrol" ? "/pp" : "/gg/feed", { replace: true });
  };
}

// ---------- login ----------

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
      const body = { phone: toE164(phone), password };
      if (otp) {
        after(await signIn(await api("/api/auth/login/admin", { method: "POST", body: { ...body, code } })));
      } else {
        const s = await api("/api/auth/login", { method: "POST", body });
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
    <Plain className="relative overflow-hidden">
      <Contours />
      <div className="relative flex flex-1 flex-col">
        <div className="mt-14 flex flex-col items-center text-center">
          <Logo size="lg" />
          <h1 className="display mt-5 text-[32px] leading-10">CivicPulse</h1>
          <p className="mt-3 text-[17px] leading-relaxed text-primary">Report civic problems and market prices. See what the evidence says.</p>
        </div>
        <form onSubmit={submit} className="mt-8 space-y-4 rounded-2xl border border-line/80 bg-white p-5 shadow-1" noValidate={false}>
          <Field label="Phone number" id="phone">
            <PhoneInput id="phone" value={phone} onChange={setPhone} disabled={Boolean(otp)} invalid={Boolean(error)} />
          </Field>
          <Field label="Password" id="password">
            <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" placeholder="Your password" invalid={Boolean(error)} />
          </Field>
          {otp && (
            <>
              <DemoCode code={otp.dev_code} />
              <Field label="Admin code" id="code" hint="Admin accounts need a code every time.">
                <input id="code" className={inputCls} inputMode="numeric" autoComplete="one-time-code" pattern="\d{4,10}" required value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
            </>
          )}
          <FormError>{error}</FormError>
          <Button size="lg" className="w-full" busy={busy}>
            Log in
          </Button>
          <div className="text-center">
            <Link to="/forgot" className="inline-flex min-h-11 items-center font-bold underline underline-offset-4">
              Forgot password?
            </Link>
          </div>
          <div className="border-t border-line/70 pt-4">
            <Button type="button" kind="soft" size="lg" className="w-full" onClick={() => navigate("/signup")}>
              Create new account
            </Button>
          </div>
        </form>
        <div className="mt-auto space-y-1 pt-10 text-center text-sm text-primary">
          <p>You stay logged in on this device for up to 30 days.</p>
          <p>Email is optional. You can add it later in your profile.</p>
        </div>
      </div>
    </Plain>
  );
}

// ---------- phone + code (sign-up steps 1–2 and forgot password) ----------

function PhoneStep({ purpose, onSent, step, total, title, intro }) {
  const [phone, setPhone] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const e164 = toE164(phone);
      onSent(e164, await api("/api/auth/otp/request", { method: "POST", body: { phone: e164, purpose } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-1 flex-col">
      <StepTitle step={step} total={total} what="your phone" title={title}>
        {intro}
      </StepTitle>
      <Field label="Phone number" id="p" className="mt-6" hint="A Bangladeshi mobile number. We send a 6-digit code to it.">
        <PhoneInput id="p" value={phone} onChange={setPhone} invalid={Boolean(error)} />
      </Field>
      <div className="mt-3">
        <FormError>{error}</FormError>
      </div>
      <Button size="lg" className="mt-auto w-full" busy={busy}>
        Send code
      </Button>
    </form>
  );
}

function CodeStep({ phone, purpose, sent, onResent, onTicket, onChangeNumber, step, total }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const left = useCountdown(60, sent);
  const masked = phone.replace(/^\+880(\d)\d+(\d{2})$/, "+880 $1XXX-XXX-X$2");
  async function verify(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api("/api/auth/otp/verify", { method: "POST", body: { phone, purpose, code } });
      onTicket(r.ticket);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    setError(null);
    setCode("");
    try {
      onResent(await api("/api/auth/otp/request", { method: "POST", body: { phone, purpose } }));
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <form onSubmit={verify} className="flex flex-1 flex-col">
      <StepTitle step={step} total={total} what="confirm your number" title="Enter the code">
        We sent a 6-digit code to <b className="num">{masked}</b>.
      </StepTitle>
      <div className="mt-5">
        <DemoCode code={sent?.dev_code} />
      </div>
      <Field label="6-digit code" id="otp" className="mt-5" error={error}>
        <CodeBoxes id="otp" value={code} onChange={setCode} invalid={Boolean(error)} />
      </Field>
      <div className="mt-4 flex items-center justify-between gap-3 text-[15px]">
        {left > 0 ? (
          <span className="num text-ink/80">
            Send a new code in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
          </span>
        ) : (
          <button type="button" onClick={resend} className="min-h-11 font-bold underline underline-offset-4">
            Send a new code
          </button>
        )}
        <button type="button" onClick={onChangeNumber} className="min-h-11 font-bold underline underline-offset-4">
          Change number
        </button>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ink/75">The code works for 5 minutes. After 5 wrong tries it stops working and you need a new one.</p>
      <Button size="lg" className="mt-auto w-full" busy={busy} disabled={code.length !== 6}>
        Confirm code
      </Button>
    </form>
  );
}

// ---------- sign-up ----------

const CONSENTS = [
  ["location", "Location", "Required", "Needed to post a report and to vote on the spot. We save your ward, never your home address."],
  ["camera", "Camera", "Required", "Photos are taken inside the app. You can retake one before you post."],
  ["research_use", "Research use", "Required for the pilot", "Your reports, votes and photos may be used without your name in our university study. Deleting your account removes your name."],
];

export function Signup() {
  const { signIn } = useApp();
  const after = useAfterLogin();
  const [step, setStep] = useState(1);
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState(null);
  const [ticket, setTicket] = useState(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [consents, setConsents] = useState({ location: false, camera: false, research_use: false });
  const [wards, setWards] = useState([]);
  const [areas, setAreas] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const TOTAL = 5;

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
        body: { ticket, display_name: name.trim(), password, consents, addresses: areas.map((a) => ({ kind: a.kind, ward_id: a.ward_id })) },
      });
      after(await signIn(s));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const back = step > 1 ? () => setStep(step === 3 ? 1 : step - 1) : () => navigate("/login");
  const allConsents = Object.values(consents).every(Boolean);

  return (
    <Plain>
      <FlowHeader onBack={back} />
      {step === 1 && (
        <PhoneStep
          purpose="signup"
          step={1}
          total={TOTAL}
          title="Create your account"
          intro="One account per phone. Your number is never shown to other people."
          onSent={(p, s) => {
            setPhone(p);
            setSent(s);
            setStep(2);
          }}
        />
      )}
      {step === 2 && (
        <CodeStep
          phone={phone}
          purpose="signup"
          sent={sent}
          step={2}
          total={TOTAL}
          onResent={setSent}
          onChangeNumber={() => setStep(1)}
          onTicket={(t) => {
            setTicket(t);
            setStep(3);
          }}
        />
      )}
      {step === 3 && (
        <form
          className="flex flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            setStep(4);
          }}
        >
          <StepTitle step={3} total={TOTAL} what="about you" title="About you">
            Your name is shown on your reports.
          </StepTitle>
          <div className="mt-6 space-y-5">
            <Field label="Your name" id="n">
              <input id="n" className={inputCls} autoComplete="name" minLength={2} maxLength={80} required value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Password" id="pw" hint="At least 8 characters, not only numbers. Pasting from a password manager is fine.">
              <PasswordInput id="pw" value={password} onChange={setPassword} autoComplete="new-password" minLength={8} />
            </Field>
          </div>
          <Button size="lg" className="mt-auto w-full">
            Continue
          </Button>
        </form>
      )}
      {step === 4 && (
        <form
          className="flex flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (allConsents) setStep(5);
          }}
        >
          <StepTitle step={4} total={TOTAL} what="permissions" title="What CivicPulse needs">
            You can read and change these later in your profile.
          </StepTitle>
          <div className="mt-6 space-y-3">
            {CONSENTS.map(([k, title, tag, text]) => (
              <label key={k} htmlFor={`c-${k}`} className={cx("flex cursor-pointer gap-3 rounded-2xl border-[1.5px] bg-white p-4", consents[k] ? "border-ink/80" : "border-line")}>
                <span className="relative mt-0.5 grid size-7 shrink-0 place-items-center">
                  <input id={`c-${k}`} type="checkbox" className="peer absolute inset-0 cursor-pointer appearance-none rounded-md border-[1.5px] border-ink/60 bg-white checked:border-primary checked:bg-primary" checked={consents[k]} onChange={(e) => setConsents({ ...consents, [k]: e.target.checked })} />
                  <Icon name="check" className="pointer-events-none relative size-5 text-white opacity-0 peer-checked:opacity-100" strokeWidth={3} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[17px] font-bold">{title}</span>
                    <span className="rounded-full bg-soft/70 px-2.5 py-0.5 text-[13px] font-bold">{tag}</span>
                  </span>
                  <span className="mt-1 block text-[15px] leading-relaxed text-ink/85">{text}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-4 flex items-start gap-2 text-[15px] leading-relaxed">
            <Icon name="info" className="mt-0.5 size-4 shrink-0" />
            Tick all three to continue. Consent version 1.0, 11 Oct 2026.
          </p>
          <Button size="lg" className="mt-auto w-full" disabled={!allConsents}>
            Continue
          </Button>
        </form>
      )}
      {step === 5 && (
        <form className="flex flex-1 flex-col" onSubmit={finish}>
          <StepTitle step={5} total={TOTAL} what="your areas" title="Your areas">
            Pick wards where you live, work or often go. Your feed and alerts come from these wards.
          </StepTitle>
          <div className="mt-6">
            <AreaEditor
              areas={areas}
              wards={wards}
              onAdd={(kind, ward_id, wname) => setAreas([...areas, { key: `${kind}-${ward_id}-${Date.now()}`, kind, ward_id, name: wname }])}
              onRemove={(a) => setAreas(areas.filter((x) => x.key !== a.key))}
            />
          </div>
          <div className="mt-4">
            <FormError>{error}</FormError>
          </div>
          <Button size="lg" className="mt-auto w-full" busy={busy} disabled={!areas.length}>
            Finish and start
          </Button>
        </form>
      )}
    </Plain>
  );
}

// ---------- forgot password (C7: phone → code → new password) ----------

export function Forgot() {
  const { toast } = useApp();
  const [step, setStep] = useState(1);
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState(null);
  const [ticket, setTicket] = useState(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  return (
    <Plain>
      <FlowHeader onBack={() => (step === 1 ? navigate("/login") : setStep(step - 1))} />
      {step === 1 && (
        <PhoneStep
          purpose="reset"
          step={1}
          total={3}
          title="Reset your password"
          intro="Enter the number of your account. We send a code to it."
          onSent={(p, s) => {
            setPhone(p);
            setSent(s);
            setStep(2);
          }}
        />
      )}
      {step === 2 && (
        <CodeStep
          phone={phone}
          purpose="reset"
          sent={sent}
          step={2}
          total={3}
          onResent={setSent}
          onChangeNumber={() => setStep(1)}
          onTicket={(t) => {
            setTicket(t);
            setStep(3);
          }}
        />
      )}
      {step === 3 && (
        <form
          className="flex flex-1 flex-col"
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
          <StepTitle step={3} total={3} what="new password" title="New password">
            You will be logged out on other phones.
          </StepTitle>
          <Field label="New password" id="np" className="mt-6" hint="At least 8 characters, not only numbers." error={error}>
            <PasswordInput id="np" value={password} onChange={setPassword} autoComplete="new-password" minLength={8} invalid={Boolean(error)} />
          </Field>
          <Button size="lg" className="mt-auto w-full" busy={busy}>
            Save password
          </Button>
        </form>
      )}
    </Plain>
  );
}

// ---------- module picker ----------

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
  const cards = useMemo(
    () => [
      ["gg", "green_guard", "pinUp", "Green Guard", "Report and verify civic and environmental problems: waterlogging, garbage, damaged roads, drainage and more.", "Open Green Guard"],
      ["pp", "price_patrol", "tag", "Price Patrol", "Check today's market prices near you and share the prices you see.", "Open Price Patrol"],
    ],
    [],
  );
  return (
    <Plain>
      <div className="mt-4 flex items-center gap-3">
        <Logo />
        <span className="display text-lg">CivicPulse</span>
      </div>
      <h1 className="display mt-8 text-[28px] leading-[34px]">Where do you want to start?</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-primary">We will open this one every time you log in. You can switch any time with the button at the top right.</p>
      <div className="mt-6 grid gap-5">
        {cards.map(([mod, value, icon, title, text, cta]) => (
          <button key={mod} data-module={mod} onClick={() => pick(value)} className="group rounded-[22px] bg-primary p-6 text-left text-white shadow-2 transition-[filter] duration-150 hover:brightness-105">
            <span className="grid size-14 place-items-center rounded-2xl bg-white/95 text-primary">
              <Icon name={icon} className="size-7" />
            </span>
            <span className="display mt-5 block text-[26px]">{title}</span>
            <span className="mt-3 block text-[17px] leading-relaxed text-white/95">{text}</span>
            <span className="mt-5 flex items-center gap-2 font-bold text-soft">
              {cta}
              <Icon name="arrowRight" className="size-5 transition-transform duration-150 group-hover:translate-x-0.5" />
            </span>
          </button>
        ))}
      </div>
    </Plain>
  );
}
