import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Award, Loader2, ShieldCheck, AlertTriangle, Download } from "lucide-react";
import { toast } from "sonner";
import {
  evaluateCocReadiness,
  computeChainedHash,
  validateAttestation,
  renderCertificateHtml,
  type CocInspectionInput,
} from "@/lib/certificate-of-compliance";
import { sha256Hex } from "@/lib/file-hash";

interface Props {
  projectId: string;
  project: { name: string; address: string; jurisdiction: string | null; county: string | null };
}

export function CertificateOfComplianceCard({ projectId, project }: Props) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [attestorName, setAttestorName] = useState("");
  const [attestorLicense, setAttestorLicense] = useState("");
  const [attestation, setAttestation] = useState(
    "I attest, under penalty of perjury and pursuant to F.S. 553.791(10), that the construction of the above-referenced project complies with all applicable codes and approved plans.",
  );

  const { data: required } = useQuery({
    queryKey: ["required-inspections", projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from("required_inspections")
        .select("id, inspection_type, status, result")
        .eq("project_id", projectId);
      return data ?? [];
    },
  });

  const { data: reports } = useQuery({
    queryKey: ["inspection-reports-for-coc", projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from("inspection_reports")
        .select("id, inspection_type, performed_at, result, inspector_name, inspector_license, report_html_sha256")
        .eq("project_id", projectId);
      return (data ?? []) as CocInspectionInput[];
    },
  });

  const { data: existingCoc } = useQuery({
    queryKey: ["coc", projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from("certificates_of_compliance")
        .select("id, issued_at, attestor_name, chained_hash, revoked_at")
        .eq("project_id", projectId)
        .order("issued_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const { data: firmRow } = useQuery({
    queryKey: ["firm-settings-coc"],
    queryFn: async () => {
      const { data } = await supabase.from("firm_settings").select("firm_name, license_number, address").maybeSingle();
      return data;
    },
  });

  const readiness = useMemo(() => evaluateCocReadiness(reports ?? []), [reports]);

  const allRequiredHavePassed = useMemo(() => {
    if (!required || required.length === 0) return false;
    return required.every((r) => r.status === "passed" || r.status === "na" || r.status === "waived");
  }, [required]);

  const canIssue = allRequiredHavePassed && readiness.ready && (reports?.length ?? 0) > 0 && !existingCoc;

  const issueCertificate = async () => {
    const validation = validateAttestation({
      attestor_name: attestorName,
      attestor_license: attestorLicense,
      typed_attestation: attestation,
    });
    if (validation.ok === false) {
      toast.error(validation.reason);
      return;
    }
    setSubmitting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Must be signed in");

      const chainedHash = await computeChainedHash(readiness.eligibleReports);
      const html = renderCertificateHtml({
        project: {
          name: project.name,
          address: project.address,
          jurisdiction: project.jurisdiction ?? "",
          county: project.county ?? "",
        },
        firm: firmRow ?? null,
        attestor: { name: attestorName.trim(), license: attestorLicense.trim() },
        reports: readiness.eligibleReports,
        chainedHash,
        issuedAt: new Date(),
        attestationText: attestation.trim(),
      });
      const htmlSha = await sha256Hex(html);

      const { error } = await supabase.from("certificates_of_compliance").insert({
        project_id: projectId,
        issued_by: userData.user.id,
        attestor_name: attestorName.trim(),
        attestor_license: attestorLicense.trim(),
        attestation_text: attestation.trim(),
        included_report_ids: readiness.eligibleReports.map((r) => r.id) as never,
        chained_hash: chainedHash,
        certificate_html: html,
        certificate_html_sha256: htmlSha,
      });
      if (error) throw error;

      await supabase.from("activity_log").insert({
        event_type: "certificate_of_compliance_issued",
        description: `Certificate of Compliance issued by ${attestorName.trim()}`,
        project_id: projectId,
        actor_type: "user",
        actor_id: userData.user.id,
        metadata: { chained_hash: chainedHash, report_count: readiness.eligibleReports.length },
      });

      toast.success("Certificate of Compliance issued.");
      setDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["coc", projectId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to issue");
    } finally {
      setSubmitting(false);
    }
  };

  const downloadExisting = async () => {
    if (!existingCoc) return;
    const { data } = await supabase
      .from("certificates_of_compliance")
      .select("certificate_html")
      .eq("id", existingCoc.id)
      .maybeSingle();
    if (!data?.certificate_html) {
      toast.error("Certificate body unavailable.");
      return;
    }
    const blob = new Blob([data.certificate_html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `certificate-of-compliance-${projectId.slice(0, 8)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <Award className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm">Certificate of Compliance</CardTitle>
          <span className="text-[10px] text-muted-foreground font-mono">F.S. 553.791(10)</span>
        </div>
        {existingCoc && !existingCoc.revoked_at && (
          <Badge variant="outline" className="bg-success/10 text-success border-success/20">
            <ShieldCheck className="h-3 w-3 mr-1" /> Issued
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {existingCoc ? (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Issued {new Date(existingCoc.issued_at).toLocaleString()} by{" "}
              <strong className="text-foreground">{existingCoc.attestor_name}</strong>
            </div>
            <div className="rounded-md bg-muted p-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Chained Hash</div>
              <code className="text-[10px] font-mono break-all">{existingCoc.chained_hash}</code>
            </div>
            <Button size="sm" variant="outline" onClick={downloadExisting}>
              <Download className="h-3 w-3 mr-1" /> Download HTML
            </Button>
          </div>
        ) : !allRequiredHavePassed ? (
          <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-warning flex-shrink-0" />
            <span>
              Certificate cannot be issued until every required inspection has a passed result.
              {required && required.length > 0 && (
                <span className="block mt-1">
                  {required.filter((r) => r.status === "passed").length}/{required.length} inspections passed.
                </span>
              )}
            </span>
          </div>
        ) : !readiness.ready ? (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              {readiness.gaps.length} report{readiness.gaps.length === 1 ? "" : "s"} not yet eligible:
            </div>
            <ul className="text-[11px] space-y-1">
              {readiness.gaps.slice(0, 5).map((g, i) => (
                <li key={i} className="text-muted-foreground">
                  • <strong>{g.inspection_type}</strong>: {g.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              All {readiness.eligibleReports.length} inspection reports are eligible. Issuing the certificate
              will compute a tamper-evident chained hash over them and lock the project as compliant.
            </p>
            <Button size="sm" onClick={() => setDialogOpen(true)} disabled={!canIssue}>
              <Award className="h-3 w-3 mr-1" /> Issue Certificate of Compliance
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Final Attestation — F.S. 553.791(10)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="att-name">Attestor name</Label>
              <Input id="att-name" value={attestorName} onChange={(e) => setAttestorName(e.target.value.slice(0, 200))} />
            </div>
            <div>
              <Label htmlFor="att-lic">Florida professional license #</Label>
              <Input id="att-lic" value={attestorLicense} onChange={(e) => setAttestorLicense(e.target.value.slice(0, 100))} />
            </div>
            <div>
              <Label htmlFor="att-text">Attestation text (must contain "I attest")</Label>
              <Textarea id="att-text" value={attestation} onChange={(e) => setAttestation(e.target.value.slice(0, 2000))} rows={5} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>Cancel</Button>
            <Button onClick={issueCertificate} disabled={submitting}>
              {submitting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
              Sign & Issue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
