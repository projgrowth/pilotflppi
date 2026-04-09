import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getStatutoryStatus } from "@/lib/statutory-deadlines";

export function useDashboardStats() {
  return useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const [projectsRes, completedRes] = await Promise.all([
        supabase.from("projects").select("id, status, deadline_at, notice_filed_at, review_clock_started_at, review_clock_paused_at, statutory_review_days, statutory_inspection_days"),
        supabase.from("projects").select("id").eq("status", "certificate_issued").gte("updated_at", startOfMonth),
      ]);

      if (projectsRes.error) throw projectsRes.error;
      if (completedRes.error) throw completedRes.error;

      const projects = projectsRes.data || [];
      const activeStatuses = ["intake", "plan_review", "comments_sent", "resubmitted", "approved", "permit_issued", "inspection_scheduled"];
      const active = projects.filter((p) => activeStatuses.includes(p.status));

      const criticalDeadlines = projects.filter((p) => {
        if (!p.deadline_at) return false;
        const remaining = Math.floor((new Date(p.deadline_at).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return remaining <= 3 && remaining >= 0 && activeStatuses.includes(p.status);
      });

      // Statutory due: projects within 5 business days of statutory limit
      const statutoryDue = active.filter((p) => {
        const stat = getStatutoryStatus(p);
        if (stat.phase === "review") return stat.reviewDaysRemaining <= 5 && stat.reviewDaysRemaining > 0;
        if (stat.phase === "inspection") return stat.inspectionDaysRemaining <= 3 && stat.inspectionDaysRemaining > 0;
        return false;
      });

      // Avg review time: days from notice_filed_at for active projects
      const reviewDays = active
        .filter((p) => p.notice_filed_at)
        .map((p) => Math.floor((now.getTime() - new Date(p.notice_filed_at!).getTime()) / (1000 * 60 * 60 * 24)));
      const avgReview = reviewDays.length > 0 ? (reviewDays.reduce((a, b) => a + b, 0) / reviewDays.length).toFixed(1) : "0";

      return {
        activeProjects: active.length,
        criticalDeadlines: criticalDeadlines.length,
        avgReviewTime: `${avgReview}d`,
        completedMTD: completedRes.data?.length || 0,
        statutoryDue: statutoryDue.length,
      };
    },
  });
}
