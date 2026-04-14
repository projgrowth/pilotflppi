import { useState, useMemo } from "react";
import { useProjects } from "@/hooks/useProjects";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileCheck, MessageSquare, Building2, ClipboardList, Search } from "lucide-react";

const documents = [
  { icon: FileCheck, title: "Plan Compliance Affidavit", desc: "Certifies plans comply with the Florida Building Code. Required for each submittal and revision. Auto-populated from project data.", color: "text-primary" },
  { icon: MessageSquare, title: "Review Comment Letter", desc: "Professional comment letter organized by discipline with FBC citations. Generated from all active (unresolved) flags.", color: "text-fpp-gold" },
  { icon: Building2, title: "Notice to Building Official", desc: "Required filing before private provider services begin. Auto-populated with firm credentials and project information.", color: "text-status-admin" },
  { icon: ClipboardList, title: "Log of Approved Documents", desc: "Running log of all approved plan sheets with revision history. Updates automatically as sheets are approved.", color: "text-status-pass" },
  { icon: Search, title: "Inspection Record", desc: "Per-phase inspection log for foundation, framing, rough-in, insulation, and final inspections with inspector credentials.", color: "text-fpp-gray-600" },
];

export default function DocumentsPage() {
  const { data: projects } = useProjects();
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [generating, setGenerating] = useState<string | null>(null);

  return (
    <div className="page-enter space-y-6">
      <div>
        <h1 className="font-display text-3xl text-foreground">Document Generator</h1>
        <p className="text-sm text-fpp-gray-600 mt-1">Generate required Florida Private Provider documents from your active review data.</p>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-fpp-gray-600">Generating documents for:</span>
        <Select value={selectedProject} onValueChange={setSelectedProject}>
          <SelectTrigger className="w-80">
            <SelectValue placeholder="Select a project..." />
          </SelectTrigger>
          <SelectContent>
            {(projects || []).map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name} · {p.county}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {documents.map((doc) => (
          <Card key={doc.title} className="shadow-subtle">
            <CardContent className="p-6">
              <doc.icon className={`h-8 w-8 ${doc.color} mb-3`} />
              <h3 className="text-base font-semibold text-foreground">{doc.title}</h3>
              <p className="text-sm text-fpp-gray-600 mt-1.5 leading-relaxed">{doc.desc}</p>
              <Button
                className="mt-4"
                disabled={!selectedProject}
                onClick={() => setGenerating(doc.title)}
              >
                Generate {doc.title.split(" ").slice(0, 2).join(" ")} →
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!generating} onOpenChange={() => setGenerating(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{generating}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2"><span className="text-status-pass">✓</span> Project Name</div>
              <div className="flex items-center gap-2"><span className="text-status-pass">✓</span> Jurisdiction</div>
              <div className="flex items-center gap-2"><span className="text-status-pass">✓</span> Reviewer Credentials</div>
              <div className="flex items-center gap-2"><span className="text-status-minor">⚠</span> Applicant Signature Date — not yet provided</div>
            </div>
            <div className="aspect-[8.5/11] bg-white border rounded p-8 max-h-[400px] overflow-auto">
              <div className="text-center mb-6">
                <h2 className="font-display text-xl">State of Florida</h2>
                <p className="text-sm text-fpp-gray-600">{generating}</p>
              </div>
              <p className="text-sm text-fpp-gray-600 leading-relaxed">
                Document preview will be generated with project-specific data once all required fields are complete.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setGenerating(null)}>Cancel</Button>
              <Button>Download PDF</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
