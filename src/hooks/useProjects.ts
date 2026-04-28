import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getStatutoryStatus } from "@/lib/statutory-deadlines";

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

      // Pull plan_reviews timestamps in one shot — we project the earliest
      // upload time and the latest activity per project. Cheap query, runs
      // once per Projects-page render.
      const ids = projects.map((p) => p.id);
      const { data: reviews } = await supabase
        .from("plan_reviews")
        .select("project_id, updated_at, created_at")
        .in("project_id", ids)
        .is("deleted_at", null);
      const { data: files } = await supabase
        .from("plan_review_files")
        .select("plan_review_id, uploaded_at")
        .is("deleted_at", null)
        .order("uploaded_at", { ascending: true });

      // Map plan_review_id → project_id via the reviews we just fetched.
      const reviewToProject = new Map<string, string>();
      const lastActivityByProject = new Map<string, string>();
      for (const r of reviews ?? []) {
        reviewToProject.set(r.project_id, r.project_id);
        const prev = lastActivityByProject.get(r.project_id);
        if (!prev || (r.updated_at && r.updated_at > prev)) {
          lastActivityByProject.set(r.project_id, r.updated_at);
        }
      }
      // We need plan_review_id → project_id specifically; redo above with
      // both keys preserved.
      const prToProject = new Map<string, string>();
      for (const r of reviews ?? []) {
        // r is { project_id, updated_at, created_at } but we also need its id.
      }
      // Re-fetch ids alongside project_id since we omitted them above.
      const { data: reviewIds } = await supabase
        .from("plan_reviews")
        .select("id, project_id")
        .in("project_id", ids)
        .is("deleted_at", null);
      for (const r of reviewIds ?? []) prToProject.set(r.id, r.project_id);

      const firstUploadByProject = new Map<string, string>();
      for (const f of files ?? []) {
        const projectId = prToProject.get(f.plan_review_id);
        if (!projectId) continue;
        if (!firstUploadByProject.has(projectId)) {
          firstUploadByProject.set(projectId, f.uploaded_at);
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
  project?: { status: string; review_clock_started_at?: string | null; review_clock_paused_at?: string | null; statutory_review_days?: number | null }
): number {
  if (project) {
    const s = getStatutoryStatus({
      status: project.status,
      review_clock_started_at: project.review_clock_started_at,
      review_clock_paused_at: project.review_clock_paused_at,
      statutory_review_days: project.statutory_review_days,
    });
    return s.reviewDaysRemaining;
  }
  // Fallback: use statutory deadline date if provided
  if (!deadlineAt) return 30;
  const deadline = new Date(deadlineAt);
  const now = new Date();
  return Math.max(0, Math.floor((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}
