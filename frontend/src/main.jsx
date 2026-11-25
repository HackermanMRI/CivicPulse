import { TooltipProvider } from "@radix-ui/react-tooltip";
import { LazyMotion, MotionConfig, domMax } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { RouterProvider } from "./lib/router.jsx";
import { AppProvider } from "./lib/store.jsx";
import { AppearanceProvider, initialAppearance, useAppearance } from "./lib/theme.jsx";

// Theme, glass and motion attributes go on <html> before the first render, so there is no light flash in dark mode.
initialAppearance();

// B5: LazyMotion + domMax (strict: only the light `m` components). reducedMotion="user" follows the system
// setting (transforms are dropped, short fades stay); the in-app "Reduce motion" switch forces the same.
function Motion({ children }) {
  const { resolved } = useAppearance();
  return <MotionConfig reducedMotion={resolved.reduceMotion ? "always" : "user"}>{children}</MotionConfig>;
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AppearanceProvider>
      <LazyMotion features={domMax} strict>
        <Motion>
          <TooltipProvider delayDuration={300}>
            <RouterProvider>
              <AppProvider>
                <App />
              </AppProvider>
            </RouterProvider>
          </TooltipProvider>
        </Motion>
      </LazyMotion>
    </AppearanceProvider>
  </StrictMode>,
);
