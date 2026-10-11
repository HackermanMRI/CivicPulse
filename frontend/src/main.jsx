import { TooltipProvider } from "@radix-ui/react-tooltip";
import { LazyMotion, MotionConfig, domMax } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { RouterProvider } from "./lib/router.jsx";
import { AppProvider } from "./lib/store.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {/* B5: LazyMotion + domMax (strict: only the light `m` components). reducedMotion="user" follows the
        system setting: transforms are dropped, short fades stay. */}
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion="user">
        <TooltipProvider delayDuration={300}>
          <RouterProvider>
            <AppProvider>
              <App />
            </AppProvider>
          </RouterProvider>
        </TooltipProvider>
      </MotionConfig>
    </LazyMotion>
  </StrictMode>,
);
