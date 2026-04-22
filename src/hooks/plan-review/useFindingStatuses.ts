import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logFindingStatusChange } from "@/hooks/useFindingHistory";
import type { FindingStatus } from "@/components/FindingStatusFilter";
import type { PlanReviewRow } from "@/types";

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
        if (/^\d+$/.test(k)) continue; // skip legacy integer keys
        loaded[k] = v as FindingStatus;
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
      setFindingStatuses((prev) => {
        const oldStatus = prev[findingId] || "open";
        const next = { ...prev, [findingId]: status };
        if (review) {
          persistFindingStatuses(review.id, next);
          if (userId && oldStatus !== status) {
            logFindingStatusChange(review.id, findingId, oldStatus, status, userId).then(() => refetchHistory());
          }
        }
        return next;
      });
    },
    [review, persistFindingStatuses, userId, refetchHistory],
  );

  return { findingStatuses, updateFindingStatus };
}
