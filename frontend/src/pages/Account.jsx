// Alerts (two tabs, B10, C4) and the profile: reputation, my reports, areas and account
// (boards: Alerts and notifications, Profile).
import { useEffect, useState } from "react";
import { AreaEditor, kindLabel } from "../components/Areas.jsx";
import { Icon, categoryIcon } from "../components/icons.jsx";
import { ReportDialog } from "../components/Report.jsx";
import { Shell } from "../components/Shell.jsx";
import { Button, DemoBadge, Dialog, ErrorState, ScoreBar, Skeleton, StateBlock, StatusChip, Tabs, cx } from "../components/ui.jsx";
import { api } from "../lib/api.js";
import { ago, bdt, fmtDate, fmtRelDay, fmtTime, initials } from "../lib/format.js";
import { Link, navigate } from "../lib/router.jsx";
import { useApp, useData } from "../lib/store.jsx";

export function moduleOf(user) {
  return user?.preferred_module === "price_patrol" ? "pp" : "gg";
}

// ---------- alerts ----------

const CATEGORY_CODE_BY_NAME = {
  Waterlogging: "waterlogging", Garbage: "garbage", "Garbage accumulation": "garbage", "Damaged road / pothole": "damaged_road",
  "Damaged road": "damaged_road", Drainage: "drainage", "Drainage problem": "drainage", "Water pollution": "water_pollution",
  Deforestation: "deforestation", "Broken streetlight": "streetlight", Streetlight: "streetlight",
};

function alertLook(n) {
  const p = n.payload || {};
  const code = p.category_code || CATEGORY_CODE_BY_NAME[p.category];
  switch (n.kind) {
    case "new_report_in_ward":
      return {
        icon: categoryIcon(code),
        tile: "bg-soft text-primary",
        text: (
          <>
            New <b>{p.category}</b> report is placed near your locality <b>{p.ward}</b>. You should check it out and verify.
          </>
        ),
      };
    case "emerging_issue":
      return {
        icon: "trend",
        tile: "bg-warn-soft text-warn",
        label: "Emerging issue",
        text: (
          <>
            Unusually many <b>{p.category}</b> reports today in <b>{p.ward}</b>.
          </>
        ),
      };
    case "price_alert":
      return { icon: "trend", tile: p.direction === "drop" ? "bg-ok-soft text-ok" : "bg-err-soft text-err", label: "Price alert", text: p.text };
    case "own_report_status":
    case "pinned_report_status":
      return { icon: n.kind === "pinned_report_status" ? "pin" : "checks", tile: "bg-info-soft text-st-high", text: p.text };
    default:
      return { icon: "bell", tile: "bg-soft text-primary", text: p.text };
  }
}

function AlertItem({ n, onOpen }) {
  const look = alertLook(n);
  return (
    <li>
      <button onClick={() => onOpen(n)} className={cx("flex w-full items-start gap-3.5 rounded-2xl border bg-white p-4 text-left hover:bg-soft/20", n.read ? "border-line/60" : "border-line")}>
        <span className={cx("grid size-12 shrink-0 place-items-center rounded-xl", n.read ? "border border-line/70 bg-white text-ink" : look.tile)}>
          <Icon name={look.icon} className="size-6" />
        </span>
        <span className="min-w-0 flex-1">
          {look.label && <span className="block text-[13px] font-bold text-warn-ink">{look.label}</span>}
          <span className="block text-[16px] leading-relaxed">{look.text}</span>
          <span className="mt-1 block text-[13px] text-primary">{n.read ? fmtRelDay(n.created_at) : ago(n.created_at)}</span>
        </span>
        {!n.read && <span className="mt-2 size-3 shrink-0 rounded-full bg-st-high" aria-label="Unread" />}
      </button>
    </li>
  );
}

export function Alerts() {
  const { user, unread, refreshUnread, live } = useApp();
  const module = moduleOf(user);
  const [tab, setTab] = useState("alerts");
  const [open, setOpen] = useState(null);
  const { data, error, loading, reload, setData } = useData(() => api("/api/notifications", { query: { tab } }), [tab, live?.id]);

  async function read(n) {
    if (!n.read) {
      await api(`/api/notifications/${n.id}/read`, { method: "POST" }).catch(() => {});
      setData({ ...data, items: data.items.map((x) => (x.id === n.id ? { ...x, read: true } : x)) });
      refreshUnread();
    }
    if (n.report_id) setOpen(n.report_id);
    else if (n.kind === "price_alert") navigate("/pp");
    else if (n.kind === "emerging_issue") navigate("/gg/dashboard");
  }
  async function readAll() {
    await api("/api/notifications/read-all", { method: "POST", query: { tab } }).catch(() => {});
    reload();
    refreshUnread();
  }
  const fresh = (data?.items || []).filter((n) => !n.read);
  const earlier = (data?.items || []).filter((n) => n.read);

  return (
    <Shell module={module} title={module === "pp" ? "Price Patrol" : "Green Guard"}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="display text-[28px]">Alerts</h1>
        <Button kind="text" className="font-bold" onClick={readAll}>
          Mark all as read
        </Button>
      </div>
      <Tabs
        className="mt-3"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "alerts", label: "Alerts", badge: unread.alerts },
          { value: "notifications", label: "Notifications", badge: unread.notifications },
        ]}
      />
      <p className="mt-3 text-sm leading-relaxed text-primary">
        Alerts: new reports in your areas and unusual activity.
        <br />
        Notifications: every status change on your own and pinned reports.
      </p>
      {loading && !data && (
        <div className="mt-5 space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      )}
      {error && <ErrorState error={error} onRetry={reload} title="Couldn't load alerts" />}
      {data && data.items.length === 0 && (
        <StateBlock icon="bell" title="All quiet">
          {tab === "alerts" ? "New reports in your areas and unusual activity show up here." : "When one of your reports or a report you pinned changes status, you see it here."}
        </StateBlock>
      )}
      {fresh.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2.5 text-[15px] font-bold text-primary">New</h2>
          <ul className="space-y-3">
            {fresh.map((n) => (
              <AlertItem key={n.id} n={n} onOpen={read} />
            ))}
          </ul>
        </section>
      )}
      {earlier.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2.5 text-[15px] font-bold text-primary">Earlier</h2>
          <ul className="space-y-3">
            {earlier.map((n) => (
              <AlertItem key={n.id} n={n} onOpen={read} />
            ))}
          </ul>
        </section>
      )}
      <ReportDialog id={open} onClose={() => setOpen(null)} />
    </Shell>
  );
}

// ---------- profile ----------

const monthYear = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", month: "short", year: "numeric" });

function RowLink({ title, sub, onClick, danger }) {
  return (
    <li>
      <button onClick={onClick} className="flex min-h-[64px] w-full items-center gap-3 border-b border-line/70 py-3 text-left">
        <span className="min-w-0 flex-1">
          <span className={cx("block text-[17px] font-bold", danger && "text-err")}>{title}</span>
          {sub && <span className="block text-sm text-ink/75">{sub}</span>}
        </span>
        <Icon name="chevronRight" className={cx("size-5 shrink-0", danger ? "text-err" : "text-ink")} strokeWidth={2.4} />
      </button>
    </li>
  );
}

function SectionHead({ title, action }) {
  return (
    <div className="flex items-center justify-between border-b border-line/70 pb-2.5">
      <h2 className="display text-xl">{title}</h2>
      {action}
    </div>
  );
}

function ReportRow({ r, onOpen }) {
  const price = r.type === "price" && r.price;
  return (
    <li>
      <button onClick={() => onOpen(r.id)} className="flex min-h-[68px] w-full items-center gap-3 border-b border-line/70 py-3 text-left">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-[17px] font-bold">
            <span className="truncate">{price ? `${price.commodity.name_en} · ${price.market.name_en}` : r.category?.name_en}</span>
            {r.is_seed && <DemoBadge />}
          </span>
          <span className="num block text-sm text-ink/75">
            {fmtRelDay(r.submitted_at)}
            {price && ` · ${bdt(price.price_bdt)} per ${price.commodity.unit}`}
          </span>
        </span>
        <StatusChip status={r.results ? r.results.status : "pending"} />
      </button>
    </li>
  );
}

function HowReputation({ open, onClose }) {
  return (
    <Dialog open={open} onClose={onClose} title="How reputation works">
      <div className="space-y-3 text-[16px] leading-relaxed">
        <p>Everyone starts at 50. Your reputation goes up when your reports end up credible and when your on-the-spot votes match the final result. It goes down when they don't.</p>
        <p>Older results count less: their weight halves every 90 days, so an inactive account slowly returns toward 50.</p>
        <p>Uncertainty shows how sure the number is. It is high for new accounts and falls as you build a record. Votes from brand-new accounts count zero until there is a record (C9).</p>
        <p>Admins can't change anyone's reputation by hand.</p>
      </div>
    </Dialog>
  );
}

function Permissions({ open, onClose, consents }) {
  const names = { location: "Location", camera: "Camera", research_use: "Research use" };
  return (
    <Dialog open={open} onClose={onClose} title="Permissions">
      <p className="text-[15px] text-ink/85">Each consent is saved with its version and time. All three are needed to take part in the pilot (C2).</p>
      <ul className="mt-3 divide-y divide-line/70">
        {Object.entries(consents || {}).map(([k, v]) => (
          <li key={k} className="flex items-center justify-between gap-3 py-3">
            <span>
              <span className="block font-bold">{names[k] || k}</span>
              <span className="block text-sm text-ink/75">
                Version {v.version} · {fmtDate(v.at)}, {fmtTime(v.at)}
              </span>
            </span>
            <span className={cx("rounded-full px-3 py-1 text-sm font-bold", v.granted ? "bg-ok-soft text-ok" : "bg-err-soft text-err")}>{v.granted ? "Given" : "Withdrawn"}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-ink/75">Location and camera are also controlled by your browser. To withdraw research use, delete your account.</p>
    </Dialog>
  );
}

export function Profile() {
  const { user, signOut, toast } = useApp();
  const module = moduleOf(user);
  const [me, setMe] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);
  const [dialog, setDialog] = useState(null);
  const type = module === "pp" ? "price" : "civic";
  const mine = useData(() => api("/api/me/reports", { query: { type, limit: 3 } }), [type]);
  useEffect(() => {
    api("/api/me").then(setMe).catch(setError);
  }, []);

  async function remove() {
    if (!window.confirm("Delete your account? Your name is removed. Your reports stay, shown as “reporter unavailable”. This cannot be undone.")) return;
    try {
      await api("/api/me", { method: "DELETE" });
      await signOut();
      navigate("/login", { replace: true });
    } catch (e) {
      toast(e.message, "error");
    }
  }

  return (
    <Shell module={module} title="Profile">
      {error && <ErrorState error={error} title="Couldn't load your profile" />}
      {!me && !error && (
        <div className="space-y-4">
          <Skeleton className="h-16 w-2/3" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}
      {me && (
        <div>
          <section className="flex items-center gap-4 pb-5">
            <span className="grid size-16 shrink-0 place-items-center rounded-full bg-primary text-xl font-extrabold text-white">{initials(me.display_name)}</span>
            <div className="min-w-0">
              <h1 className="display truncate text-2xl">{me.display_name}</h1>
              <p className="num text-sm text-primary">
                {me.phone_masked} · Member since {monthYear.format(new Date(me.member_since))}
              </p>
            </div>
          </section>
          <section className="border-t-2 border-ink pt-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[15px] font-bold text-primary">Your reputation</p>
                <p className="num text-[52px] font-extrabold leading-[1.05] text-st-high">{me.reputation.display}</p>
              </div>
              <div className="pb-1 text-right">
                <p className="text-sm text-primary">Uncertainty</p>
                <p className="num text-2xl font-extrabold">{me.reputation.uncertainty_display}</p>
              </div>
            </div>
            <ScoreBar value={me.reputation.display} color="bg-st-high" className="mt-3 h-2.5" />
            <p className="mt-3 text-[16px] leading-relaxed">It goes up when your reports end up credible and when your on-the-spot votes match the final result. Older results count less: their weight halves every 90 days.</p>
            <button onClick={() => setDialog("rep")} className="mt-2 min-h-11 font-bold underline underline-offset-4">
              How reputation works
            </button>
          </section>
          <section className="mt-3 grid grid-cols-3 border-y border-line">
            {[
              [me.stats.reports, "Reports"],
              [me.stats.on_spot_votes, "On-the-spot votes"],
              [me.stats.pinned, "Pinned", "/gg/pinned"],
            ].map(([n, label, to], i) => {
              const body = (
                <>
                  <span className="num block text-[26px] font-extrabold">{n}</span>
                  <span className="block text-sm text-ink/80">{label}</span>
                </>
              );
              return to ? (
                <Link key={label} to={to} className={cx("px-3 py-3.5 hover:bg-soft/30", i > 0 && "border-l border-line")}>
                  {body}
                </Link>
              ) : (
                <div key={label} className={cx("px-3 py-3.5", i > 0 && "border-l border-line")}>
                  {body}
                </div>
              );
            })}
          </section>

          <section className="mt-7">
            <SectionHead
              title={type === "price" ? "My prices" : "My reports"}
              action={
                <Link to="/profile/reports" className="min-h-11 content-center font-bold underline underline-offset-4">
                  See all
                </Link>
              }
            />
            {mine.loading && <Skeleton className="mt-3 h-20 w-full" />}
            {mine.data && mine.data.length === 0 && <p className="py-4 text-ink/80">{type === "civic" ? "You haven't posted a report yet." : "You haven't reported a price yet."}</p>}
            {mine.data && (
              <ul>
                {mine.data.map((r) => (
                  <ReportRow key={r.id} r={r} onOpen={setOpen} />
                ))}
              </ul>
            )}
          </section>

          <section className="mt-7">
            <SectionHead
              title="My areas"
              action={
                <Link to="/profile/areas" className="min-h-11 content-center font-bold underline underline-offset-4">
                  Edit
                </Link>
              }
            />
            <ul>
              {me.addresses.map((a) => (
                <li key={a.id} className="border-b border-line/70 py-3.5 text-[17px]">
                  <b>{kindLabel(a.kind)}</b>: {a.ward_name_en}
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-7">
            <SectionHead title="Account" />
            <ul>
              <RowLink title="Permissions" sub="Location, camera, research use" onClick={() => setDialog("perm")} />
              <RowLink title="Language" sub="English" onClick={() => setDialog("lang")} />
              <RowLink
                title="Log out"
                onClick={async () => {
                  await signOut();
                  navigate("/login", { replace: true });
                }}
              />
              <RowLink title="Delete account" sub={"Your name is removed. Your reports stay, shown as “reporter unavailable”."} danger onClick={remove} />
            </ul>
          </section>
        </div>
      )}
      <ReportDialog id={open} onClose={() => setOpen(null)} />
      <HowReputation open={dialog === "rep"} onClose={() => setDialog(null)} />
      <Permissions open={dialog === "perm"} onClose={() => setDialog(null)} consents={me?.consents} />
      <Dialog open={dialog === "lang"} onClose={() => setDialog(null)} title="Language">
        <p className="text-[16px] leading-relaxed">The app is in English for the pilot. Categories and wards also show their Bangla names. A full Bangla interface is planned (C3).</p>
      </Dialog>
    </Shell>
  );
}

// "See all": every report and price the user posted.
export function MyReports() {
  const { user } = useApp();
  const module = moduleOf(user);
  const [type, setType] = useState(module === "pp" ? "price" : "civic");
  const [open, setOpen] = useState(null);
  const { data, error, loading, reload } = useData(() => api("/api/me/reports", { query: { type } }), [type]);
  return (
    <Shell module={module} title="My reports">
      <BackTitle title="My reports" />
      <Tabs className="mt-2" value={type} onChange={setType} tabs={[{ value: "civic", label: "Civic problems" }, { value: "price", label: "Prices" }]} />
      {loading && <Skeleton className="mt-4 h-40 w-full" />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && data.length === 0 && (
        <StateBlock icon={type === "civic" ? "mapPin" : "tag"} title="Nothing here yet">
          {type === "civic" ? "Reports you post show up here with their status." : "Prices you report show up here."}
        </StateBlock>
      )}
      {data && data.length > 0 && (
        <ul className="mt-3">
          {data.map((r) => (
            <ReportRow key={r.id} r={r} onOpen={setOpen} />
          ))}
        </ul>
      )}
      <ReportDialog id={open} onClose={() => setOpen(null)} />
    </Shell>
  );
}

function BackTitle({ title }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <button onClick={() => navigate("/profile")} className="-ml-2 grid size-11 place-items-center rounded-full hover:bg-soft/50" aria-label="Back to profile">
        <Icon name="chevronLeft" className="size-6" strokeWidth={2.4} />
      </button>
      <h1 className="display text-[28px]">{title}</h1>
    </div>
  );
}

// Profile → My areas → Edit (same parts as sign-up step 5; changes save at once).
export function EditAreas() {
  const { user, setUser, toast } = useApp();
  const module = moduleOf(user);
  const [addresses, setAddresses] = useState(null);
  const [busy, setBusy] = useState(false);
  const wards = useData(() => api("/api/wards"), []);
  useEffect(() => {
    api("/api/me/addresses").then(setAddresses).catch((e) => toast(e.message, "error"));
  }, [toast]);
  const save = (list) => {
    setAddresses(list);
    setUser({ ...user, addresses: list });
  };
  return (
    <Shell module={module} title="My areas">
      <BackTitle title="Your areas" />
      <p className="text-[17px] leading-relaxed">Pick wards where you live, work or often go. Your feed and alerts come from these wards.</p>
      <div className="mt-5">
        {!addresses || !wards.data ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <AreaEditor
            busy={busy}
            areas={addresses.map((a) => ({ key: a.id, id: a.id, kind: a.kind, ward_id: a.ward_id, name: a.ward_name_en }))}
            wards={wards.data}
            onAdd={async (kind, ward_id) => {
              setBusy(true);
              try {
                save(await api("/api/me/addresses", { method: "POST", body: { kind, ward_id } }));
                toast("Area added. Your feed now includes it.", "ok");
              } catch (e) {
                toast(e.message, "error");
              } finally {
                setBusy(false);
              }
            }}
            onRemove={async (a) => {
              try {
                save(await api(`/api/me/addresses/${a.id}`, { method: "DELETE" }));
              } catch (e) {
                toast(e.message, "error");
              }
            }}
          />
        )}
      </div>
    </Shell>
  );
}
