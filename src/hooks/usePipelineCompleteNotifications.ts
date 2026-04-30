/**
 * Browser-notification on pipeline complete.
 *
 * Watches `useAllActivePipelines` and fires a desktop Notification + sonner
 * toast the moment a previously-running review's terminal stage flips to
 * `complete`. Opt-in: the user toggles `pipeline-complete-notify` in Settings.
 *
 * No edge-function or schema changes needed — the polling/realtime infra in
 * `useAllActivePipelines` is already firm-scoped, so we're just observing
 * transitions in memory.
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useNavigate, useLocation } from "react-router-dom";
import { useAllActivePipelines } from "@/hooks/useAllActivePipelines";

const PREF_KEY = "pipeline-complete-notify";

export function isPipelineNotifyEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(PREF_KEY) === "1";
}

export function setPipelineNotifyEnabled(on: boolean) {
  if (on) localStorage.setItem(PREF_KEY, "1");
  else localStorage.removeItem(PREF_KEY);
}

/**
 * Mount once at app shell level. Tracks each review's last-known terminal
 * status; when it transitions from non-complete → complete, fires a notice.
 * The first observation is treated as baseline (no false positives on mount).
 */
export function usePipelineCompleteNotifications() {
  const { data: activities } = useAllActivePipelines();
  const navigate = useNavigate();
  const location = useLocation();
  const lastStatusRef = useRef<Map<string, string>>(new Map());
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!activities) return;
    const enabled = isPipelineNotifyEnabled();
    const map = lastStatusRef.current;

    for (const activity of activities) {
      const terminal = activity.rows.find((r) => r.stage === "complete");
      const status = terminal?.status ?? "pending";
      const prev = map.get(activity.planReviewId);
      map.set(activity.planReviewId, status);

      if (!initializedRef.current) continue;
      if (prev === status) continue;
      if (status !== "complete") continue;
      if (!enabled) continue;
      // Suppress toast if the user is already viewing this review's dashboard
      // — the in-page ReviewReadyCta replaces it.
      if (location.pathname === `/plan-review/${activity.planReviewId}/dashboard`) continue;

      const projectName = activity.meta?.project?.name ?? "A plan review";
      const round = activity.meta?.round ?? null;
      const title = `Review complete: ${projectName}`;
      const body = round
        ? `Round ${round} finished — ready for letter review.`
        : "Pipeline finished — ready for letter review.";

      toast.success(title, {
        description: body,
        action: {
          label: "Open",
          onClick: () => navigate(`/plan-review/${activity.planReviewId}/dashboard`),
        },
      });

      // Best-effort browser notification (granted only when the user toggled it on).
      try {
        if (
          typeof window !== "undefined" &&
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          const n = new Notification(title, { body, tag: activity.planReviewId });
          n.onclick = () => {
            window.focus();
            navigate(`/plan-review/${activity.planReviewId}/dashboard`);
            n.close();
          };
        }
      } catch {
        // Notification API can throw on iframes/private modes — silent fail.
      }
    }

    initializedRef.current = true;
  }, [activities, navigate]);
}
