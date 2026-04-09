import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import { Loader2 } from "lucide-react";

import Index from "./pages/Index";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import PlanReviewDetail from "./pages/PlanReviewDetail";
import Inspections from "./pages/Inspections";
import LeadRadar from "./pages/LeadRadar";
import MilestoneRadar from "./pages/MilestoneRadar";
import Contractors from "./pages/Contractors";
import SettingsPage from "./pages/Settings";
import ProjectDetail from "./pages/ProjectDetail";
import NotFound from "./pages/NotFound";
import Invoices from "./pages/Invoices";

const queryClient = new QueryClient();

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Index />} />

            <Route element={<AuthGuard><AppLayout /></AuthGuard>}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/projects/:id" element={<ProjectDetail />} />
              <Route path="/invoices" element={<Invoices />} />
              <Route path="/plan-review/:id" element={<PlanReviewDetail />} />
              <Route path="/inspections" element={<Inspections />} />
              <Route path="/lead-radar" element={<LeadRadar />} />
              <Route path="/milestone-radar" element={<MilestoneRadar />} />
              <Route path="/contractors" element={<Contractors />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>

            {/* Redirects for removed routes */}
            <Route path="/deadlines" element={<Navigate to="/dashboard" replace />} />
            <Route path="/plan-review" element={<Navigate to="/projects" replace />} />
            <Route path="/documents" element={<Navigate to="/projects" replace />} />
            <Route path="/ai-briefing" element={<Navigate to="/dashboard" replace />} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
