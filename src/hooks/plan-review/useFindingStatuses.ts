/**
 * Per-finding triage status (open/resolved/deferred) with debounced JSONB
 * persistence to plan_reviews.finding_statuses, and audit-trail logging on
 * each transition.
 *
 * Keys: finding UUIDs (deficiencies_v2.id), NOT array indices. Prior versions
 * keyed by integer position in the findings array, which silently corrupted
 * statuses whenever findings were filtered, reordered, or a new round changed
 * the list length. Hydration auto-migrates legacy integer-keyed payloads by
 * dropping them — losing recent status flags is preferable to assigning them
 * to the wrong finding.
 *
 * Hydrates from the review row once when it loads; thereafter the local
 * state is the source of truth and writes are debounced 800ms.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logFindingStatusChange } from "@/hooks/useFindingHistory";
import type { FindingStatus } from "@/components/FindingStatusFilter";
import type { PlanReviewRow } from "@/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useFindingStatuses(
  review: PlanReviewRow | undefined,
  userId: string | undefined,
  refetchHistory: () => void,
) {
  const [findingStatuses, setFindingStatuses] = useState<Record<string, FindingStatus>>({});

  useEffect(() => {
    if (review?.finding_statuses) {
      const loaded: Record<string, FindingStatus> = {};
      for (const [k, v] of Object.entries(review.finding_statuses as Record<string, string>)) {
        // Only carry forward UUID-keyed entries. Integer-keyed legacy data is
        // dropped: those keys can't be safely re-mapped to finding UUIDs.
        if (UUID_RE.test(k)) loaded[k] = v as FindingStatus;
      }
      setFindingStatuses(loaded);
    } else {
      setFindingStatuses({});
    }
  }, [review?.id]);

  const statusSaveTimer = useRef<NodeJS.Timeout | null>(null);
  const persistFindingStatuses = useCallback((reviewId: string, statuses: Record<string, FindingStatus>) => {
    if (statusSaveTimer.current) clearTimeout(statusSaveTimer.current);
    statusSaveTimer.current = setTimeout(async () => {
      await supabase
        .from("plan_reviews")
        .update({ finding_statuses: JSON.parse(JSON.stringify(statuses)) })
        .eq("id", reviewId);
    }, 800);
  }, []);

  const updateFindingStatus = useCallback(
    (findingId: string, status: FindingStatus) => {
      if (!findingId) return;
      setFindingStatuses((prev) => {
        const oldStatus = prev[findingId] || "open";
        const next = { ...prev, [findingId]: status };
        if (review) {
          persistFindingStatuses(review.id, next);
          if (userId && oldStatus !== status) {
            // finding_status_history.finding_index is an int column from the
            // legacy schema; we write -1 and stash the finding UUID in `note`
            // so the audit trail remains queryable without a migration.
            logFindingStatusChange(review.id, -1, oldStatus, status, userId, `finding_id=${findingId}`).then(() =>
              refetchHistory(),
            );
          }
        }
        return next;
      });
    },
    [review, persistFindingStatuses, userId, refetchHistory],
  );

  return { findingStatuses, updateFindingStatus };
}
