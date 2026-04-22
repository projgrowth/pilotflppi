import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle } from "lucide-react";

export default function CitationDbBanner() {
  const { data: count, isLoading } = useQuery({
    queryKey: ["fbc_code_sections_count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("fbc_code_sections")
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading || (count !== undefined && count > 0)) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="text-amber-800 dark:text-amber-300">
        <span className="font-medium">FBC citation database not seeded.</span>{" "}
        Citation grounding is unavailable — all findings show{" "}
        <code className="rounded bg-amber-100 px-1 text-xs dark:bg-amber-900">unverified</code>{" "}
        until an admin runs the seed migration. Citation warnings in the letter quality gate are suppressed.
      </div>
    </div>
  );
}
