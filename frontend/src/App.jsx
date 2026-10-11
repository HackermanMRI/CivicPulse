// Routes. Sign-in pages are open; everything else needs a session. Map and admin code load lazily (B14).
import { Suspense, lazy } from "react";
import { Alerts, EditAreas, MyReports, Profile } from "./pages/Account.jsx";
import { Forgot, Login, ModulePicker, Signup } from "./pages/auth/Auth.jsx";
import { Feed, Pinned, ReportForm } from "./pages/GreenGuard.jsx";
import { Explore, PriceDashboard, PriceReport } from "./pages/prices/Prices.jsx";
import { Logo } from "./components/icons.jsx";
import { Skeleton } from "./components/ui.jsx";
import { Redirect, useRoute } from "./lib/router.jsx";
import { useApp } from "./lib/store.jsx";

const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const Admin = lazy(() => import("./pages/admin/Admin.jsx"));

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

function home(user) {
  if (user.role === "admin") return "/admin";
  if (!user.preferred_module) return "/modules";
  return user.preferred_module === "price_patrol" ? "/pp" : "/gg/feed";
}

export default function App() {
  const { path } = useRoute();
  const { user, booting } = useApp();
  if (booting) return <Splash />;
  if (OPEN[path]) {
    if (user) return <Redirect to={home(user)} />;
    const Page = OPEN[path];
    return <Page key={path} />; // a fresh page per URL, so /gg/alerts and /pp/alerts never share state
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
  const Page = routes[path];
  if (!Page) return <Redirect to={home(user)} />;
  return <Page key={path} />; // a fresh page per URL, so /gg/alerts and /pp/alerts never share state
}
