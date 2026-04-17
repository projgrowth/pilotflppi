import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface CorrectionRow {
  id: string;
  correction_type: string | null;
}

export function useAILearningStats() {
  return useQuery({
    queryKey: ["ai_learning_stats"],
    queryFn: async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const [outputsRes, correctionsRes] = await Promise.all([
        supabase
          .from("ai_outputs")
          .select("id")
          .gte("created_at", thirtyDaysAgo.toISOString()),
        supabase
          .from("corrections")
          .select("id, correction_type")
          .gte("created_at", thirtyDaysAgo.toISOString()),
      ]);

      const totalFlags = outputsRes.data?.length || 0;
      const corrections = (correctionsRes.data || []) as CorrectionRow[];
      const totalCorrections = corrections.length;
      const byType: Record<string, number> = {};
      corrections.forEach((c) => {
        const key = c.correction_type ?? "unknown";
        byType[key] = (byType[key] || 0) + 1;
      });

      const hcr = totalFlags > 0 ? totalCorrections / totalFlags : 0;
      return { hcr, totalFlags, totalCorrections, byType };
    },
  });
}
