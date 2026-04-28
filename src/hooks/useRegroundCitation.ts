/**
 * Re-grounds the FBC citation for a single finding (or the whole review when
 * `deficiencyId` is omitted, admin-only). Calls the regroup-citations edge
 * function and returns a mutation suitable for buttons in finding cards.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Args {
  planReviewId: string;
  deficiencyId?: string;
}

export function useRegroundCitation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ planReviewId, deficiencyId }: Args) => {
      const { data, error } = await supabase.functions.invoke(
        "regroup-citations",
        {
          body: {
            plan_review_id: planReviewId,
            deficiency_id: deficiencyId,
          },
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      toast.success(
        vars.deficiencyId
          ? "Re-grounding citation — refresh in a few seconds"
          : "Re-grounding all citations",
      );
      qc.invalidateQueries({ queryKey: ["review_dashboard", vars.planReviewId] });
      qc.invalidateQueries({ queryKey: ["deficiencies_v2", vars.planReviewId] });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error ? err.message : "Failed to re-ground citation";
      toast.error(msg);
    },
  });
}
