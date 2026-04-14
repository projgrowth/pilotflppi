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
      <AppSidebar onOpenAI={() => setAiDrawerOpen(true)} />
      <main className="flex-1 overflow-x-hidden pb-16 md:pb-0">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
      <CommandPalette onOpenAI={() => setAiDrawerOpen(true)} />
      <AIDrawer open={aiDrawerOpen} onOpenChange={setAiDrawerOpen} />
    </div>
  );
}
