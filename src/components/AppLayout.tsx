import { useState } from "react";
import { Outlet } from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CommandPalette } from "@/components/CommandPalette";
import { AIDrawer } from "@/components/AIDrawer";

export function AppLayout() {
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-screen w-full">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-3 focus:bg-background focus:text-foreground">
        Skip to content
      </a>
      <AppSidebar onOpenAI={() => setAiDrawerOpen(true)} />
      <main id="main-content" className="flex-1 overflow-x-hidden pb-16 md:pb-0">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
      <CommandPalette onOpenAI={() => setAiDrawerOpen(true)} />
      <AIDrawer open={aiDrawerOpen} onOpenChange={setAiDrawerOpen} />
    </div>
  );
}
