// Alerts (two tabs, B10, C4) and the profile: reputation, my reports, areas and account
// (boards: Alerts and notifications, Profile).
import { m } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { AreaEditor, kindLabel } from "../components/Areas.jsx";
import { Icon, categoryIcon } from "../components/icons.jsx";
import { ReportDialog } from "../components/Report.jsx";
import { Badges, Completeness, EditProfile, PhotoEditor, ProfileHeader, StatTiles } from "./People.jsx";
import { Shell } from "../components/Shell.jsx";
import { Button, DemoBadge, Dialog, ErrorState, Segmented, Skeleton, StateBlock, StatusChip, Switch, Tabs, cx } from "../components/ui.jsx";
import { api } from "../lib/api.js";
import { ago, bdt, fmtDate, fmtRelDay, fmtTime, initials } from "../lib/format.js";
import { Link, MODULE_KEY, moduleFromPath, navigate, useRoute } from "../lib/router.jsx";
import { useApp, useData } from "../lib/store.jsx";
import { enter, pop, stagger } from "../lib/motion.js";
import { useAppearance } from "../lib/theme.jsx";

// The module comes from the URL (/gg/… or /pp/…), never from the preferred module, so Alerts and Profile stay in
// the area the person opened them from.
function useModuleRoute() {
  const { path } = useRoute();
  const module = moduleFromPath(path);
  return { module, base: `/${module}`, key: MODULE_KEY[module] };
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
    <m.li initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={enter()}>
      <button onClick={() => onOpen(n)} className={cx("press flex w-full items-start gap-3.5 rounded-2xl border bg-surface p-4 text-left shadow-1 hover:bg-soft/20", n.read ? "border-hair" : "border-line")}>
        <span className={cx("grid size-12 shrink-0 place-items-center rounded-xl", n.read ? "border border-line/70 bg-surface text-ink" : look.tile)}>
          <Icon name={look.icon} className="size-6" />
        </span>
        <span className="min-w-0 flex-1">
          {look.label && <span className="block text-[13px] font-bold text-warn-ink">{look.label}</span>}
          <span className="block text-[16px] leading-relaxed">{look.text}</span>
          <span className="mt-1 block text-[13px] text-primary">{n.read ? fmtRelDay(n.created_at) : ago(n.created_at)}</span>
        </span>
        {!n.read && <span className="mt-2 size-3 shrink-0 rounded-full bg-st-high shadow-[0_0_0_4px_rgb(42_111_214/0.18)]" aria-label="Unread" />}
      </button>
    </m.li>
  );
}

export function Alerts() {
  const { unread, refreshUnread, live } = useApp();
  const { module, key } = useModuleRoute();
  const [tab, setTab] = useState("alerts");
  const [open, setOpen] = useState(null);
  const { data, error, loading, reload, setData } = useData(() => api("/api/notifications", { query: { tab, module: key } }), [tab, key, live?.id], `notifications:${tab}:${key}`);

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
    await api("/api/notifications/read-all", { method: "POST", query: { tab, module: key } }).catch(() => {});
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
        key={module}
        className="mt-3"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "alerts", label: "Alerts", badge: unread[module]?.alerts },
          { value: "notifications", label: "Notifications", badge: unread[module]?.notifications },
        ]}
        label="Alert lists"
      >
        <p className="mt-3 text-sm leading-relaxed text-primary">
          {module === "pp" ? "Alerts: a product's verified price moved 10% or more in 7 days." : "Alerts: new reports in your areas and unusual activity."}
          <br />
          {module === "pp" ? "Notifications: every status change on the prices you reported." : "Notifications: every status change on your own and pinned reports."}
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
            {module === "pp"
              ? tab === "alerts" ? "Price changes of 10% or more show up here. Watch products on the Prices page to get them first." : "When a price you reported changes status, you see it here."
              : tab === "alerts" ? "New reports in your areas and unusual activity show up here." : "When one of your reports or a report you pinned changes status, you see it here."}
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
      </Tabs>
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

// Appearance (UI v2): saved on this phone only. "Reduce transparency" exists because Safari has no system setting
// the web can read for it; "Reduce motion" mirrors the phone's own setting for people who want it only here.
function Appearance() {
  const { prefs, set } = useAppearance();
  return (
    <section className="mt-7">
      <SectionHead title="Appearance" />
      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-hair bg-surface px-4 py-3 shadow-1">
          <span>
            <span className="block font-bold">Theme</span>
            <span className="block text-sm text-muted">System follows your phone's light or dark mode</span>
          </span>
          <Segmented
            label="Theme"
            value={prefs.theme}
            onChange={(theme) => set({ theme })}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </div>
        <Switch id="glass" checked={prefs.glass === "off"} onChange={(on) => set({ glass: on ? "off" : "on" })} label="Reduce transparency" sub="Solid bars instead of see-through glass. Easier to read." />
        <Switch id="motion" checked={prefs.motion === "reduce"} onChange={(on) => set({ motion: on ? "reduce" : "system" })} label="Reduce motion" sub="Simple fades instead of moving and bouncing." />
      </div>
    </section>
  );
}

export function Profile() {
  const { signOut, toast, loadMe } = useApp();
  const { module, base } = useModuleRoute();
  const [me, setMe] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);
  const [dialog, setDialog] = useState(null); // rep | perm | lang | edit | photo
  const [tab, setTab] = useState("overview");
  const type = module === "pp" ? "price" : "civic";
  const mine = useData(() => api("/api/me/reports", { query: { type, limit: 3 } }), [type], `my-reports:${type}:3`);
  const cats = useData(() => api("/api/categories"), [], "categories");
  const load = useCallback(() => api("/api/me").then(setMe).catch(setError), []);
  useEffect(() => {
    load();
  }, [load]);
  // After an edit: this page, and the session user (the avatar in the nav bars) both refresh.
  const refresh = () => {
    load();
    loadMe().catch(() => {});
  };

  async function remove() {
    if (!window.confirm("Delete your account? Your name, photo and profile details are removed. Your reports stay, shown as “reporter unavailable”. This cannot be undone.")) return;
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
          <Skeleton className="h-36 w-full rounded-[28px]" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}
      {me && (
        <div className="space-y-6">
          <ProfileHeader
            person={me}
            own
            categories={cats.data}
            onEdit={() => setDialog("edit")}
            onPhoto={() => setDialog("photo")}
            onHowReputation={() => setDialog("rep")}
            extra={
              <button onClick={() => navigate(`${base}/people/${me.id}`)} className="mt-4 inline-flex min-h-11 items-center gap-2 text-[15px] font-bold text-primary underline-offset-4 hover:underline">
                <Icon name="eye" className="size-5" />
                See how neighbours see your profile
              </button>
            }
          />
          <Completeness me={me} onEdit={() => setDialog("edit")} onPhoto={() => setDialog("photo")} />
          <Tabs
            label="Profile sections"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "overview", label: "Overview" },
              { value: "activity", label: "Activity" },
              { value: "settings", label: "Settings" },
            ]}
          >
            <m.div key={tab} className="mt-5 space-y-6" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={enter()}>
              {tab === "overview" && (
                <>
                  <StatTiles stats={me.stats} />
                  <Badges stats={me.stats} rep={me.reputation} />
                </>
              )}
              {tab === "activity" && (
                <>
                  <section>
                    <SectionHead
                      title={type === "price" ? "My prices" : "My reports"}
                      action={
                        <Link to={`${base}/profile/reports`} className="min-h-11 content-center font-bold underline underline-offset-4">
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
                  <section>
                    <SectionHead title="Saved" />
                    <ul>
                      <RowLink title="Pinned reports" sub={`${me.stats.pinned} pinned · you get a notification when their status changes`} onClick={() => navigate("/gg/pinned")} />
                    </ul>
                  </section>
                </>
              )}
              {tab === "settings" && (
                <>
                  <section>
                    <SectionHead
                      title="My areas"
                      action={
                        <Link to={`${base}/profile/areas`} className="min-h-11 content-center font-bold underline underline-offset-4">
                          Edit
                        </Link>
                      }
                    />
                    <p className="mt-2 text-sm text-muted">Your feed and alerts come from these wards. They also show on your profile.</p>
                    <ul>
                      {me.addresses.map((a) => (
                        <li key={a.id} className="border-b border-line/70 py-3.5 text-[17px]">
                          <b>{kindLabel(a.kind)}</b>: {a.ward_name_en}
                        </li>
                      ))}
                    </ul>
                  </section>
                  <Appearance />
                  <section>
                    <SectionHead title="Account" />
                    <ul>
                      <RowLink title="Edit profile" sub="Name, bio, what you do, link, email, interests" onClick={() => setDialog("edit")} />
                      <RowLink title="Profile photo" sub={me.avatar_url ? "Change or remove" : "Add a photo"} onClick={() => setDialog("photo")} />
                      <RowLink title="Permissions" sub="Location, camera, research use" onClick={() => setDialog("perm")} />
                      <RowLink title="Language" sub="English" onClick={() => setDialog("lang")} />
                      <RowLink
                        title="Log out"
                        onClick={async () => {
                          await signOut();
                          navigate("/login", { replace: true });
                        }}
                      />
                      <RowLink title="Delete account" sub={"Your name, photo and profile details are removed. Your reports stay, shown as “reporter unavailable”."} danger onClick={remove} />
                    </ul>
                  </section>
                </>
              )}
            </m.div>
          </Tabs>
        </div>
      )}
      <ReportDialog id={open} onClose={() => setOpen(null)} />
      <HowReputation open={dialog === "rep"} onClose={() => setDialog(null)} />
      <Permissions open={dialog === "perm"} onClose={() => setDialog(null)} consents={me?.consents} />
      <Dialog open={dialog === "lang"} onClose={() => setDialog(null)} title="Language">
        <p className="text-[16px] leading-relaxed">The app is in English for the pilot. Categories and wards also show their Bangla names. A full Bangla interface is planned (C3).</p>
      </Dialog>
      {me && <EditProfile open={dialog === "edit"} onClose={() => setDialog(null)} me={me} categories={cats.data} onSaved={refresh} />}
      <PhotoEditor open={dialog === "photo"} onClose={() => setDialog(null)} hasPhoto={Boolean(me?.avatar_url)} onSaved={refresh} />
    </Shell>
  );
}

// "See all": every report and price the user posted.
export function MyReports() {
  const { module } = useModuleRoute();
  const [type, setType] = useState(module === "pp" ? "price" : "civic");
  const [open, setOpen] = useState(null);
  const { data, error, loading, reload } = useData(() => api("/api/me/reports", { query: { type } }), [type], `my-reports:${type}`);
  return (
    <Shell module={module} title="My reports">
      <BackTitle title="My reports" />
      <Tabs className="mt-2" label="Report types" value={type} onChange={setType} tabs={[{ value: "civic", label: "Civic problems" }, { value: "price", label: "Prices" }]}>
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
      </Tabs>
      <ReportDialog id={open} onClose={() => setOpen(null)} />
    </Shell>
  );
}

function BackTitle({ title }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <button onClick={() => navigate(`/${moduleFromPath(location.pathname)}/profile`)} className="-ml-2 grid size-11 place-items-center rounded-full hover:bg-soft/50" aria-label="Back to profile">
        <Icon name="chevronLeft" className="size-6" strokeWidth={2.4} />
      </button>
      <h1 className="display text-[28px]">{title}</h1>
    </div>
  );
}

// Profile → My areas → Edit (same parts as sign-up step 5; changes save at once).
export function EditAreas() {
  const { user, setUser, toast } = useApp();
  const { module } = useModuleRoute();
  const [addresses, setAddresses] = useState(null);
  const [busy, setBusy] = useState(false);
  const wards = useData(() => api("/api/wards"), [], "wards");
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
