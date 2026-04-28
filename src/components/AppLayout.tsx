import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { RouteBoundary } from "@/components/RouteBoundary";
import { OfflineBanner } from "@/components/OfflineBanner";
import { SessionExpiryWatcher } from "@/components/SessionExpiryWatcher";
import { CommandPalette } from "@/components/CommandPalette";
import { AIDrawer } from "@/components/AIDrawer";
import { BetaFeedbackButton } from "@/components/BetaFeedbackButton";
import { usePipelineCompleteNotifications } from "@/hooks/usePipelineCompleteNotifications";

export function AppLayout() {
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const location = useLocation();
  usePipelineCompleteNotifications();

  return (
    <div className="flex min-h-screen w-full">
      <SessionExpiryWatcher />
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-3 focus:bg-background focus:text-foreground">
        Skip to content
      </a>
      <AppSidebar onOpenAI={() => setAiDrawerOpen(true)} />
      <main id="main-content" className="flex-1 overflow-x-hidden pb-16 md:pb-0">
        <OfflineBanner />
        <ErrorBoundary>
          {/* Keyed by pathname so a crash on one route resets when the user navigates away. */}
          <RouteBoundary key={location.pathname} routeName={location.pathname}>
            <Outlet />
          </RouteBoundary>
        </ErrorBoundary>
      </main>
      <CommandPalette onOpenAI={() => setAiDrawerOpen(true)} />
      <AIDrawer open={aiDrawerOpen} onOpenChange={setAiDrawerOpen} />
      {/* Floating beta-feedback button — every page, every route. */}
      <div className="fixed bottom-4 right-4 z-40 rounded-full border bg-card/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <BetaFeedbackButton />
      </div>
    </div>
  );
}
