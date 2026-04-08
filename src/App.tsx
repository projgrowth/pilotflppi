import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import { Loader2 } from "lucide-react";

import Index from "./pages/Index";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import PlanReview from "./pages/PlanReview";
import PlanReviewDetail from "./pages/PlanReviewDetail";
import Inspections from "./pages/Inspections";
import Deadlines from "./pages/Deadlines";
import AIBriefing from "./pages/AIBriefing";
import MilestoneRadar from "./pages/MilestoneRadar";
import LeadRadar from "./pages/LeadRadar";
import Contractors from "./pages/Contractors";
import Documents from "./pages/Documents";
import SettingsPage from "./pages/Settings";
import ProjectDetail from "./pages/ProjectDetail";
import NotFound from "./pages/NotFound";

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
      <Toaster />
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
              <Route path="/plan-review/:id" element={<PlanReviewDetail />} />
              <Route path="/plan-review" element={<PlanReview />} />
              <Route path="/inspections" element={<Inspections />} />
              <Route path="/deadlines" element={<Deadlines />} />
              <Route path="/ai-briefing" element={<AIBriefing />} />
              <Route path="/milestone-radar" element={<MilestoneRadar />} />
              <Route path="/lead-radar" element={<LeadRadar />} />
              <Route path="/contractors" element={<Contractors />} />
              <Route path="/documents" element={<Documents />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
