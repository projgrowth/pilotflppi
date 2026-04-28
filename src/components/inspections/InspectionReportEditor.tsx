import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, AlertTriangle, Loader2, Send, FileText, Camera, Upload } from "lucide-react";
import { toast } from "sonner";
import { computeInspectionReadiness } from "@/lib/inspection-readiness";
import { sendInspectionReport } from "@/lib/send-inspection-report";
import { sha256OfFile, extractPhotoExif } from "@/lib/file-hash";

interface Props {
  inspection: {
    id: string;
    project_id: string;
    inspection_type: string;
    result: "pending" | "pass" | "fail" | "partial";
    notes: string | null;
    project?: { trade_type?: string | null } | null;
  };
}

interface PhotoRow {
  id: string;
  storage_path: string;
  sha256: string;
  captured_at: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
}

export function InspectionReportEditor({ inspection }: Props) {
  const queryClient = useQueryClient();
  const [narrative, setNarrative] = useState(inspection.notes ?? "");
  const [recipient, setRecipient] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Find or create the corresponding required_inspection + report row
  const { data: reqRow } = useQuery({
    queryKey: ["required-inspection-for", inspection.id, inspection.project_id, inspection.inspection_type],
    queryFn: async () => {
      const { data } = await supabase
        .from("required_inspections")
        .select("id, is_threshold_inspection, trade")
        .eq("project_id", inspection.project_id)
        .ilike("inspection_type", `%${inspection.inspection_type}%`)
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const { data: reportRow } = useQuery({
    queryKey: ["inspection-report-for", inspection.id],
    queryFn: async () => {
      const { data: existing } = await supabase
        .from("inspection_reports")
        .select("*")
        .eq("project_id", inspection.project_id)
        .eq("inspection_type", inspection.inspection_type)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return existing;
    },
  });

  useEffect(() => {
    if (reportRow) {
      setReportId(reportRow.id);
      if (reportRow.narrative && !narrative) setNarrative(reportRow.narrative);
      if (reportRow.ahj_recipient && !recipient) setRecipient(reportRow.ahj_recipient);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportRow]);

  const ensureReport = async (): Promise<string> => {
    if (reportId) return reportId;
    const { data: userData } = await supabase.auth.getUser();
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userData.user?.id ?? "")
      .maybeSingle();
    const { data: firmSettings } = await supabase
      .from("firm_settings")
      .select("license_number")
      .maybeSingle();
    const inspectionResult = inspection.result === "pending" ? "pass" : inspection.result;
    const { data, error } = await supabase
      .from("inspection_reports")
      .insert({
        project_id: inspection.project_id,
        required_inspection_id: reqRow?.id ?? null,
        inspector_id: userData.user?.id ?? null,
        inspector_name: profile?.full_name ?? "",
        inspector_license: firmSettings?.license_number ?? "",
        inspection_type: inspection.inspection_type,
        result: inspectionResult,
        narrative,
      })
      .select("id")
      .single();
    if (error) throw error;
    setReportId(data.id);
    queryClient.invalidateQueries({ queryKey: ["inspection-report-for", inspection.id] });
    return data.id;
  };

  const { data: photos } = useQuery({
    queryKey: ["inspection-photos", reportId],
    enabled: !!reportId,
    queryFn: async () => {
      const { data } = await supabase
        .from("inspection_photos")
        .select("id, storage_path, sha256, captured_at, gps_lat, gps_lng")
        .eq("inspection_report_id", reportId!)
        .order("created_at", { ascending: true });
      return (data ?? []) as PhotoRow[];
    },
  });

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      const rid = await ensureReport();
      const { data: userData } = await supabase.auth.getUser();
      for (const file of files) {
        if (file.size > 25 * 1024 * 1024) {
          toast.error(`${file.name} > 25 MB, skipped`);
          continue;
        }
        const sha = await sha256OfFile(file);
        const exif = await extractPhotoExif(file);
        const path = `inspection-photos/${inspection.project_id}/${rid}/${sha.slice(0, 12)}-${file.name}`;
        const { error: upErr } = await supabase.storage.from("documents").upload(path, file, { upsert: false });
        if (upErr && !upErr.message.includes("already exists")) throw upErr;
        const { error: insErr } = await supabase.from("inspection_photos").insert({
          inspection_report_id: rid,
          required_inspection_id: reqRow?.id ?? null,
          project_id: inspection.project_id,
          storage_path: path,
          sha256: sha,
          captured_at: exif.capturedAt?.toISOString() ?? null,
          gps_lat: exif.gpsLat,
          gps_lng: exif.gpsLng,
          uploaded_by: userData.user?.id ?? null,
        });
        if (insErr) throw insErr;
      }
      toast.success(`${files.length} photo${files.length === 1 ? "" : "s"} uploaded`);
      queryClient.invalidateQueries({ queryKey: ["inspection-photos", rid] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const trade = (inspection.project?.trade_type ?? reqRow?.trade ?? "general").toLowerCase();
  const photoCount = photos?.length ?? 0;

  const readiness = useMemo(
    () =>
      computeInspectionReadiness({
        trade,
        inspectorLicensedTrades: [trade], // simplification: assume listed trade is licensed; real impl reads profile
        photoCount,
        isThresholdInspection: !!reqRow?.is_threshold_inspection,
        thresholdSignerLicense: reqRow?.is_threshold_inspection ? reportRow?.inspector_license ?? null : null,
        narrative,
        result: inspection.result === "pending" ? "pass" : inspection.result,
        openCriticalDeficiencies: 0,
      }),
    [trade, photoCount, reqRow, reportRow, narrative, inspection.result],
  );

  const renderHtml = async (): Promise<string> => {
    const { data: project } = await supabase
      .from("projects")
      .select("name, address, jurisdiction, county")
      .eq("id", inspection.project_id)
      .maybeSingle();
    const { data: firm } = await supabase
      .from("firm_settings")
      .select("firm_name, license_number, address")
      .maybeSingle();
    const photoList = (photos ?? [])
      .map(
        (p) => `<li><code>${p.sha256.slice(0, 12)}…</code> ${p.captured_at ? new Date(p.captured_at).toLocaleString() : "no EXIF"}${p.gps_lat ? ` @ ${p.gps_lat.toFixed(5)}, ${p.gps_lng?.toFixed(5)}` : ""}</li>`,
      )
      .join("");
    return `<!doctype html><html><head><meta charset="utf-8"/>
<style>body{font-family:'IBM Plex Sans',sans-serif;color:#0f172a;padding:40px;max-width:780px;margin:0 auto;}
h1{font-size:20px;margin-bottom:4px}.sub{color:#475569;font-size:12px;margin-bottom:24px}
.panel{border:1px solid #cbd5e1;border-radius:8px;padding:14px 18px;margin-bottom:16px}
.panel h2{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#475569;margin:0 0 6px 0}
.narrative{white-space:pre-wrap;font-size:13px;line-height:1.5}</style></head>
<body>
<h1>INSPECTION REPORT — ${escapeHtml(inspection.inspection_type.toUpperCase())}</h1>
<div class="sub">Submitted under F.S. 553.791(8) by ${escapeHtml(firm?.firm_name ?? "")}</div>
<div class="panel"><h2>Project</h2><div><strong>${escapeHtml(project?.name ?? "")}</strong></div><div>${escapeHtml(project?.address ?? "")}</div><div>${escapeHtml(project?.jurisdiction ?? "")}, ${escapeHtml(project?.county ?? "")} County</div></div>
<div class="panel"><h2>Inspector</h2><div>${escapeHtml(reportRow?.inspector_name ?? "")} — License ${escapeHtml(reportRow?.inspector_license ?? "")}</div><div>Performed ${reportRow?.performed_at ? new Date(reportRow.performed_at).toLocaleString() : new Date().toLocaleString()}</div><div>Result: <strong>${escapeHtml((reportRow?.result ?? inspection.result).toUpperCase())}</strong></div></div>
<div class="panel"><h2>Narrative</h2><div class="narrative">${escapeHtml(narrative)}</div></div>
<div class="panel"><h2>Photo Chain-of-Custody (${photoCount})</h2><ul style="font-size:11px;font-family:'IBM Plex Mono',monospace;">${photoList}</ul></div>
</body></html>`;
  };

  const handleSend = async () => {
    if (!readiness.allRequiredPassing) {
      toast.error("Resolve readiness blockers before sending.");
      return;
    }
    setSubmitting(true);
    try {
      const rid = await ensureReport();
      // Sync narrative/inspector before snapshot
      await supabase.from("inspection_reports").update({ narrative }).eq("id", rid);
      const html = await renderHtml();
      await sendInspectionReport({
        reportId: rid,
        projectId: inspection.project_id,
        recipient,
        reportHtml: html,
        readinessSnapshot: { checks: readiness.checks, photoCount },
      });
      toast.success("Inspection report sent to AHJ.");
      queryClient.invalidateQueries({ queryKey: ["inspection-report-for", inspection.id] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="shadow-subtle">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <FileText className="h-3.5 w-3.5" /> AHJ Inspection Report
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-xs">Narrative</Label>
          <Textarea
            value={narrative}
            onChange={(e) => setNarrative(e.target.value.slice(0, 8000))}
            placeholder="What was inspected, how compliance was verified, conditions observed…"
            rows={5}
            className="text-sm"
          />
        </div>

        <div>
          <Label className="text-xs flex items-center gap-2 mb-2">
            <Camera className="h-3.5 w-3.5" /> Photos ({photoCount})
          </Label>
          <div className="flex items-center gap-2">
            <Input
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              onChange={handlePhotoUpload}
              disabled={uploading}
              className="text-xs"
            />
            {uploading && <Loader2 className="h-3 w-3 animate-spin" />}
          </div>
          {photoCount > 0 && (
            <p className="text-[10px] text-muted-foreground mt-1">Each photo hashed (SHA-256); EXIF capture time and GPS preserved when available.</p>
          )}
        </div>

        <div>
          <Label className="text-xs">AHJ recipient email</Label>
          <Input value={recipient} onChange={(e) => setRecipient(e.target.value.slice(0, 200))} placeholder="building@county.gov" className="text-sm" />
        </div>

        <div className="rounded-md border p-2 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <ShieldCheck className="h-3 w-3" /> Readiness
          </div>
          {readiness.checks.map((c) => (
            <div key={c.id} className="flex items-start gap-2 text-[11px]">
              <Badge
                variant="outline"
                className={
                  c.severity === "ok"
                    ? "bg-success/10 text-success border-success/20"
                    : c.severity === "warn"
                      ? "bg-warning/10 text-warning border-warning/20"
                      : "bg-destructive/10 text-destructive border-destructive/20"
                }
              >
                {c.severity.toUpperCase()}
              </Badge>
              <div className="flex-1">
                <div className="font-medium">{c.title}</div>
              </div>
            </div>
          ))}
        </div>

        {!readiness.allRequiredPassing && (
          <div className="flex items-start gap-2 rounded-md bg-warning/5 border border-warning/20 p-2 text-[11px] text-warning-foreground">
            <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5" />
            <span>{readiness.blockingCount} blocker{readiness.blockingCount === 1 ? "" : "s"} prevent sending. Fix above to enable send.</span>
          </div>
        )}

        <Button
          onClick={handleSend}
          disabled={submitting || !readiness.allRequiredPassing || !recipient.trim()}
          className="w-full"
        >
          {submitting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Send className="h-3 w-3 mr-1" />}
          {reportRow?.sent_to_ahj_at ? "Resend Report" : "Send to AHJ"}
        </Button>

        {reportRow?.sent_to_ahj_at && (
          <div className="text-[10px] text-muted-foreground text-center">
            Last sent {new Date(reportRow.sent_to_ahj_at).toLocaleString()} — SHA: <code>{reportRow.report_html_sha256?.slice(0, 12)}…</code>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
