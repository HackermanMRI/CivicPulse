// Routes. Sign-in pages are open; everything else needs a session. Map and admin code load lazily (B14).
import { Suspense, lazy } from "react";
import { Alerts, Profile } from "./pages/Account.jsx";
import { Forgot, Login, ModulePicker, Signup } from "./pages/auth/Auth.jsx";
import { Feed, Pinned, ReportForm } from "./pages/GreenGuard.jsx";
import { Explore, PriceDashboard, PriceReport } from "./pages/prices/Prices.jsx";
import { Skeleton } from "./components/ui.jsx";
import { Redirect, useRoute } from "./lib/router.jsx";
import { useApp } from "./lib/store.jsx";

const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const Admin = lazy(() => import("./pages/admin/Admin.jsx"));

const OPEN = { "/login": Login, "/signup": Signup, "/forgot": Forgot };

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center" aria-busy="true">
      <span className="cp-pulse relative grid size-16 place-items-center rounded-full bg-primary">
        <span className="size-4 rounded-full bg-white" />
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
    return <Page />;
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
    "/alerts": Alerts,
    "/profile": Profile,
    "/pp": PriceDashboard,
    "/pp/explore": Explore,
    "/pp/report": PriceReport,
  };
  if (path === "/gg/dashboard")
    return (
      <Suspense fallback={<div className="p-6"><Skeleton className="h-96 w-full" /></div>}>
        <Dashboard />
      </Suspense>
    );
  const Page = routes[path];
  if (!Page) return <Redirect to={home(user)} />;
  return <Page />;
}
