import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getStatutoryStatus, type ClockPauseEvent } from "@/lib/statutory-deadlines";

export interface Project {
  id: string;
  name: string;
  address: string;
  county: string;
  jurisdiction: string;
  trade_type: string;
  services: string[];
  status: string;
  notice_filed_at: string | null;
  deadline_at: string | null;
  assigned_to: string | null;
  contractor_id: string | null;
  created_at: string;
  updated_at: string;
  contractor?: { id: string; name: string } | null;
  // Statutory fields (F.S. 553.791)
  statutory_review_days: number;
  statutory_inspection_days: number;
  statutory_deadline_at: string | null;
  review_clock_started_at: string | null;
  review_clock_paused_at: string | null;
  inspection_clock_started_at: string | null;
  clock_pause_history?: ClockPauseEvent[] | null;
  hold_reason: string | null;
  zoning_data: Record<string, unknown> | null;
  /** Earliest plan_review_files.uploaded_at across all reviews. */
  first_uploaded_at?: string | null;
  /** Latest of plan_reviews.updated_at across all reviews. */
  last_activity_at?: string | null;
}

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, contractor:contractors(id, name)")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const projects = (data ?? []) as Project[];
      if (projects.length === 0) return projects;

      // One round-trip for plan_reviews (id + project_id + updated_at) so we
      // can compute both "last activity" and the review-id→project-id map
      // needed to attribute uploaded files back to projects.
      const ids = projects.map((p) => p.id);
      const { data: reviews } = await supabase
        .from("plan_reviews")
        .select("id, project_id, updated_at")
        .in("project_id", ids)
        .is("deleted_at", null);
      const reviewToProject = new Map<string, string>();
      const lastActivityByProject = new Map<string, string>();
      for (const r of reviews ?? []) {
        reviewToProject.set(r.id, r.project_id);
        const prev = lastActivityByProject.get(r.project_id);
        if (!prev || (r.updated_at && r.updated_at > prev)) {
          lastActivityByProject.set(r.project_id, r.updated_at);
        }
      }

      const reviewIds = Array.from(reviewToProject.keys());
      const firstUploadByProject = new Map<string, string>();
      if (reviewIds.length > 0) {
        const { data: files } = await supabase
          .from("plan_review_files")
          .select("plan_review_id, uploaded_at")
          .in("plan_review_id", reviewIds)
          .is("deleted_at", null)
          .order("uploaded_at", { ascending: true });
        for (const f of files ?? []) {
          const pid = reviewToProject.get(f.plan_review_id);
          if (!pid) continue;
          if (!firstUploadByProject.has(pid)) {
            firstUploadByProject.set(pid, f.uploaded_at);
          }
        }
      }

      return projects.map((p) => ({
        ...p,
        first_uploaded_at: firstUploadByProject.get(p.id) ?? null,
        last_activity_at: lastActivityByProject.get(p.id) ?? p.updated_at ?? null,
      }));
    },
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ["project", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, contractor:contractors(id, name)")
        .eq("id", id)
        .is("deleted_at", null)
        .single();
      if (error) throw error;
      return data as Project;
    },
    enabled: !!id,
  });
}

export function getDaysElapsed(noticeFiledAt: string | null): number {
  if (!noticeFiledAt) return 0;
  const filed = new Date(noticeFiledAt);
  const now = new Date();
  return Math.max(0, Math.floor((now.getTime() - filed.getTime()) / (1000 * 60 * 60 * 24)));
}

export function getDaysRemaining(
  deadlineAt: string | null,
  project?: {
    status: string;
    review_clock_started_at?: string | null;
    review_clock_paused_at?: string | null;
    statutory_review_days?: number | null;
    clock_pause_history?: ClockPauseEvent[] | null;
  },
): number {
  if (project) {
    const s = getStatutoryStatus({
      status: project.status,
      review_clock_started_at: project.review_clock_started_at,
      review_clock_paused_at: project.review_clock_paused_at,
      statutory_review_days: project.statutory_review_days,
      clock_pause_history: project.clock_pause_history,
    });
    return s.reviewDaysRemaining;
  }
  // Fallback: use statutory deadline date if provided
  if (!deadlineAt) return 30;
  const deadline = new Date(deadlineAt);
  const now = new Date();
  return Math.max(0, Math.floor((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}
