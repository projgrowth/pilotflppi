/**
 * Reads a cached external_data_snapshots row for a plan review and exposes a
 * `refresh()` mutation that calls the matching edge function. Edge functions
 * upsert the snapshot row, so a successful refresh invalidates this query
 * and the new payload streams in.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type {
  AsceHazardPayload,
  ExternalSource,
  FemaFloodPayload,
} from "@/lib/sources/types";

type PayloadFor<S extends ExternalSource> = S extends "fema_flood"
  ? FemaFloodPayload
  : S extends "asce_hazard"
    ? AsceHazardPayload
    : never;

interface SnapshotRow<S extends ExternalSource> {
  id: string;
  plan_review_id: string;
  source: S;
  payload: PayloadFor<S>;
  fetched_at: string;
  expires_at: string | null;
}

interface Args {
  planReviewId: string | undefined;
  source: ExternalSource;
  lat: number | null | undefined;
  lng: number | null | undefined;
  enabled?: boolean;
}

const FN_FOR_SOURCE: Record<ExternalSource, string> = {
  fema_flood: "fetch-fema-flood",
  asce_hazard: "fetch-asce-hazard",
};

export function useExternalData<S extends ExternalSource>({
  planReviewId,
  source,
  lat,
  lng,
  enabled = true,
}: Args & { source: S }) {
  const qc = useQueryClient();
  const queryKey = ["external-data", planReviewId, source];

  const query = useQuery({
    queryKey,
    enabled: enabled && Boolean(planReviewId),
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<SnapshotRow<S> | null> => {
      if (!planReviewId) return null;
      const { data, error } = await supabase
        .from("external_data_snapshots")
        .select("id, plan_review_id, source, payload, fetched_at, expires_at")
        .eq("plan_review_id", planReviewId)
        .eq("source", source)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown) as SnapshotRow<S> | null;
    },
  });

  const refresh = useMutation({
    mutationFn: async (force: boolean) => {
      if (!planReviewId) throw new Error("Missing plan review");
      if (typeof lat !== "number" || typeof lng !== "number") {
        throw new Error("Address has no coordinates yet");
      }
      const { data, error } = await supabase.functions.invoke(
        FN_FOR_SOURCE[source],
        { body: { plan_review_id: planReviewId, lat, lng, force } },
      );
      if (error) throw error;
      const ok = (data as { ok?: boolean })?.ok;
      if (!ok) {
        const reason = (data as { reason?: string })?.reason ?? "Unknown error";
        throw new Error(reason);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast.success("Site data refreshed");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    },
  });

  return {
    snapshot: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refreshError: refresh.error instanceof Error ? refresh.error.message : null,
    refresh: (force = false) => refresh.mutate(force),
    isRefreshing: refresh.isPending,
  };
}
