// Routes. Sign-in pages are open; everything else needs a session. Map and admin code load lazily (B14).
// UI v2: Price Patrol, account pages and the sign-in pages are their own chunks too, so the feed's first load stays
// inside the B14 budget (≤ 180 KB gz). They are fetched quietly once the browser is idle, so a tap still opens
// them at once.
import { Suspense, lazy, useEffect } from "react";
import { Feed, Pinned, ReportForm } from "./pages/GreenGuard.jsx";
import { Logo } from "./components/icons.jsx";
import { Skeleton } from "./components/ui.jsx";
import { Redirect, useRoute } from "./lib/router.jsx";
import { useApp } from "./lib/store.jsx";

const loadAccount = () => import("./pages/Account.jsx");
const loadAuth = () => import("./pages/auth/Auth.jsx");
const loadPrices = () => import("./pages/prices/Prices.jsx");
const loadDashboard = () => import("./pages/Dashboard.jsx");
const loadPeople = () => import("./pages/People.jsx");
const loadAdmin = () => import("./pages/admin/Admin.jsx");

// A page from a lazy chunk. Once its chunk has arrived (the idle prefetch below), the page renders straight away
// like normal code. Plain React.lazy can't do that: it always suspends on its first render, even when the chunk is
// already downloaded, and React then holds the fallback on screen for at least 300 ms (its Suspense reveal throttle).
// That was the ~300 ms "dead" pause measured on every first visit to a tab.
const loaded = new Map(); // loader -> module
function load(loader) {
  return loader().then((mod) => {
    loaded.set(loader, mod);
    return mod;
  });
}
function page(loader, name = "default") {
  const Lazy = lazy(() => load(loader).then((mod) => ({ default: mod[name] })));
  function Page(props) {
    const Ready = loaded.get(loader)?.[name];
    return Ready ? <Ready {...props} /> : <Lazy {...props} />;
  }
  Page.displayName = `Page(${name})`;
  return Page;
}

const Dashboard = page(loadDashboard);
const Admin = page(loadAdmin);
const Alerts = page(loadAccount, "Alerts");
const EditAreas = page(loadAccount, "EditAreas");
const MyReports = page(loadAccount, "MyReports");
const Profile = page(loadAccount, "Profile");
const Login = page(loadAuth, "Login");
const Signup = page(loadAuth, "Signup");
const Forgot = page(loadAuth, "Forgot");
const ModulePicker = page(loadAuth, "ModulePicker");
const PriceDashboard = page(loadPrices, "PriceDashboard");
const Explore = page(loadPrices, "Explore");
const PriceReport = page(loadPrices, "PriceReport");
const PersonPage = page(loadPeople, "PersonPage");
const PERSON = /^\/(gg|pp)\/people\/[0-9a-f-]{36}$/;

const OPEN = { "/login": Login, "/signup": Signup, "/forgot": Forgot };

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center" aria-busy="true">
      <span className="cp-pulse relative rounded-[18px]">
        <Logo size="lg" />
      </span>
    </div>
  );
}

// While a page's code arrives (first visit on a slow network): the page background and a few skeleton blocks.
function PageFallback() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pt-24" aria-busy="true">
      <Skeleton className="h-9 w-1/2" />
      <Skeleton className="h-40 w-full rounded-3xl" />
      <Skeleton className="h-64 w-full rounded-3xl" />
    </div>
  );
}

function usePrefetch(user) {
  useEffect(() => {
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
    const id = idle(() => {
      // Small page chunks (16–24 KB each). The map library (MapView, ~1 MB) is not here: it loads only when the map opens.
      const loaders = !user ? [loadAuth] : user.role === "admin" ? [loadAdmin] : [loadAccount, loadPrices, loadDashboard, loadPeople, loadAuth];
      loaders.forEach((l) => load(l).catch(() => {}));
    });
    return () => (window.cancelIdleCallback || clearTimeout)(id);
  }, [user]);
}

function home(user) {
  if (user.role === "admin") return "/admin";
  if (!user.preferred_module) return "/modules";
  return user.preferred_module === "price_patrol" ? "/pp" : "/gg/feed";
}

export default function App() {
  const { path } = useRoute();
  const { user, booting } = useApp();
  usePrefetch(user);
  if (booting) return <Splash />;
  if (OPEN[path]) {
    if (user) return <Redirect to={home(user)} />;
    const Page = OPEN[path];
    return (
      <Suspense fallback={<Splash />}>
        <Page key={path} />
      </Suspense>
    );
  }
  if (!user) return <Redirect to="/login" />;
  if (path.startsWith("/admin"))
    return (
      <Suspense fallback={<Splash />}>
        <Admin />
      </Suspense>
    );
  const routes = {
    "/modules": ModulePicker,
    "/gg/feed": Feed,
    "/gg/report": ReportForm,
    "/gg/pinned": Pinned,
    "/gg/alerts": Alerts,
    "/pp/alerts": Alerts,
    "/gg/profile": Profile,
    "/pp/profile": Profile,
    "/gg/profile/reports": MyReports,
    "/pp/profile/reports": MyReports,
    "/gg/profile/areas": EditAreas,
    "/pp/profile/areas": EditAreas,
    "/pp": PriceDashboard,
    "/pp/explore": Explore,
    "/pp/report": PriceReport,
  };
  // Old links (/alerts, /profile/…) go to the same page in the person's preferred module.
  if (path === "/alerts" || path === "/profile" || path.startsWith("/profile/"))
    return <Redirect to={`/${user.preferred_module === "price_patrol" ? "pp" : "gg"}${path}`} />;
  if (path === "/gg/dashboard")
    return (
      <Suspense fallback={<div className="p-6"><Skeleton className="h-96 w-full" /></div>}>
        <Dashboard />
      </Suspense>
    );
  const Page = routes[path] || (PERSON.test(path) ? PersonPage : null);
  if (!Page) return <Redirect to={home(user)} />;
  return (
    <Suspense fallback={<PageFallback />}>
      <Page key={path} />
    </Suspense>
  );
}
