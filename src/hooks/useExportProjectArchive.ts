/**
 * useExportProjectArchive — invokes the export-project-archive edge function
 * and triggers a browser download of the resulting ZIP. One-call helper for
 * the Florida private-provider records-retention workflow.
 */
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export function useExportProjectArchive() {
  const [exporting, setExporting] = useState(false);

  async function exportArchive(projectId: string, filenameHint?: string) {
    if (!projectId) return;
    setExporting(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Not signed in");

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-project-archive`;
      const r = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ project_id: projectId }),
      });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`Export failed (${r.status}): ${txt.slice(0, 200)}`);
      }
      const blob = await r.blob();
      const safeName = (filenameHint ?? projectId).replace(/[^a-z0-9-_]/gi, "_").slice(0, 60);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `archive-${safeName}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      toast.success("Archive downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  return { exportArchive, exporting };
}
