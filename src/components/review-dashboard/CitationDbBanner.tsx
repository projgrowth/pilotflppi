/**
 * CitationDbBanner — shown when fbc_code_sections table is empty.
 * Warns reviewers that citation grounding is unavailable so they don't
 * mistake silent not_found results for verified findings.
 */
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
    staleTime: 5 * 60 * 1000, // Re-check every 5 min — table gets seeded once
  });

  // Don't render while loading or once the table has data
  if (isLoading || (count !== undefined && count > 0)) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <div className="text-foreground">
        <span className="font-medium">FBC citation database not seeded.</span>{" "}
        Citation grounding is unavailable — all findings will show{" "}
        <code className="rounded bg-muted px-1 text-xs">unverified</code> until
        an admin runs the seed migration. Citation warnings in the quality gate
        are suppressed until the database is populated.
      </div>
    </div>
  );
}
