import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { getDisciplineIcon, getDisciplineColor, getDisciplineLabel, type Discipline } from "@/lib/county-utils";
import type { Finding } from "@/components/FindingCard";
import { CheckCircle2, AlertTriangle } from "lucide-react";

interface ChecklistItem {
  id: string;
  label: string;
  codeRef: string;
  required: boolean;
}

const CHECKLIST_TEMPLATES: Record<string, Record<Discipline, ChecklistItem[]>> = {
  building: {
    structural: [
      { id: "s1", label: "Verify design loads per ASCE 7-22 (wind, seismic, live, dead)", codeRef: "FBC 1603", required: true },
      { id: "s2", label: "Foundation design adequate for soil conditions", codeRef: "FBC 1809", required: true },
      { id: "s3", label: "Concrete specifications per ACI 318", codeRef: "FBC 1903", required: true },
      { id: "s4", label: "Wood framing per NDS/AWC", codeRef: "FBC 2301", required: true },
      { id: "s5", label: "Structural connection details adequate", codeRef: "FBC 2304", required: true },
    ],
    life_safety: [
      { id: "ls1", label: "Occupancy classification & load factors correct", codeRef: "FBC 302", required: true },
      { id: "ls2", label: "Egress path width & travel distance compliant", codeRef: "FBC 1005", required: true },
      { id: "ls3", label: "Exit signs and emergency lighting shown", codeRef: "FBC 1013", required: true },
      { id: "ls4", label: "Stairway construction meets requirements", codeRef: "FBC 1011", required: true },
    ],
    fire: [
      { id: "f1", label: "Fire-resistance ratings per occupancy type", codeRef: "FBC 602", required: true },
      { id: "f2", label: "Sprinkler system required/shown (NFPA 13/13R)", codeRef: "FBC 903", required: true },
      { id: "f3", label: "Fire alarm system per NFPA 72", codeRef: "FBC 907", required: true },
    ],
    mechanical: [
      { id: "m1", label: "HVAC load calculations provided", codeRef: "FMC 301", required: true },
      { id: "m2", label: "Duct sizing and insulation adequate", codeRef: "FMC 603", required: true },
      { id: "m3", label: "Ventilation rates per ASHRAE 62.1", codeRef: "FMC 401", required: true },
    ],
    electrical: [
      { id: "e1", label: "Service entrance and panel sizing adequate", codeRef: "NEC 230", required: true },
      { id: "e2", label: "Branch circuit design per NEC", codeRef: "NEC 210", required: true },
      { id: "e3", label: "GFCI/AFCI protection where required", codeRef: "NEC 210.8", required: true },
    ],
    plumbing: [
      { id: "p1", label: "Fixture count per occupancy (FPC Table 403.1)", codeRef: "FPC 403", required: true },
      { id: "p2", label: "Water supply sizing adequate", codeRef: "FPC 604", required: true },
      { id: "p3", label: "DWV system properly sized", codeRef: "FPC 702", required: true },
    ],
    energy: [
      { id: "en1", label: "Envelope insulation per IECC climate zone", codeRef: "FECC C402", required: true },
      { id: "en2", label: "Lighting power density compliance", codeRef: "FECC C405", required: true },
      { id: "en3", label: "HVAC efficiency meets minimum requirements", codeRef: "FECC C403", required: true },
    ],
    ada: [
      { id: "a1", label: "Accessible route from site arrival to building entry", codeRef: "FBC 1104", required: true },
      { id: "a2", label: "Accessible restrooms provided", codeRef: "FBC 1109", required: true },
      { id: "a3", label: "Door hardware & clearances compliant", codeRef: "FBC 1008", required: true },
    ],
    site: [
      { id: "si1", label: "Setback and lot coverage requirements met", codeRef: "Local Zoning", required: true },
      { id: "si2", label: "Flood zone compliance (if applicable)", codeRef: "FBC 3107", required: false },
      { id: "si3", label: "Stormwater/drainage plan adequate", codeRef: "Local Ordinance", required: true },
      { id: "si4", label: "Utility connections shown (water, sewer, electric)", codeRef: "FBC 3301", required: true },
      { id: "si5", label: "Landscape buffer and tree preservation requirements", codeRef: "Local Zoning", required: false },
      { id: "si6", label: "Fire department access road and hydrant locations", codeRef: "FFC 503", required: true },
      { id: "si7", label: "Driveway and sight triangle clearance", codeRef: "Local DOT", required: true },
      { id: "si8", label: "Easements and right-of-way delineated", codeRef: "Local Zoning", required: true },
    ],
  },
};

// Copy building as default for other trade types with minor variations
for (const trade of ["structural", "mechanical", "electrical", "plumbing", "roofing", "fire"]) {
  CHECKLIST_TEMPLATES[trade] = { ...CHECKLIST_TEMPLATES.building };
}

interface DisciplineChecklistProps {
  tradeType: string;
  findings: Finding[];
  className?: string;
}

export function DisciplineChecklist({ tradeType, findings, className }: DisciplineChecklistProps) {
  const template = CHECKLIST_TEMPLATES[tradeType] || CHECKLIST_TEMPLATES.building;
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  // Auto-fill based on AI findings
  const autoFilled = new Set<string>();
  for (const f of findings) {
    const discipline = f.discipline as Discipline;
    const items = template[discipline];
    if (!items) continue;
    for (const item of items) {
      if (f.code_ref?.includes(item.codeRef.split(" ")[0]) || f.description?.toLowerCase().includes(item.label.split(" ").slice(0, 3).join(" ").toLowerCase())) {
        autoFilled.add(item.id);
      }
    }
  }

  const disciplines = Object.keys(template) as Discipline[];
  const totalItems = disciplines.reduce((sum, d) => sum + (template[d]?.length || 0), 0);
  const checkedCount = Object.values(checked).filter(Boolean).length + autoFilled.size;
  const completionPct = totalItems > 0 ? Math.round((checkedCount / totalItems) * 100) : 0;

  return (
    <div className={cn("space-y-3", className)}>
      {/* Progress summary */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Compliance Checklist</span>
          <Badge variant="outline" className="text-[10px]">{completionPct}% Complete</Badge>
        </div>
        <span className="text-[10px] text-muted-foreground">{checkedCount}/{totalItems} items verified</span>
      </div>

      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", completionPct === 100 ? "bg-[hsl(var(--success))]" : "bg-accent")}
          style={{ width: `${completionPct}%` }}
        />
      </div>

      {disciplines.map((discipline) => {
        const items = template[discipline];
        if (!items || items.length === 0) return null;
        const Icon = getDisciplineIcon(discipline);
        const allChecked = items.every((item) => checked[item.id] || autoFilled.has(item.id));

        return (
          <Card key={discipline} className={cn("shadow-subtle border", allChecked && "border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/5")}>
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <Icon className={cn("h-3.5 w-3.5", getDisciplineColor(discipline))} />
                <span className="text-xs font-semibold">{getDisciplineLabel(discipline)}</span>
                {allChecked && <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--success))]" />}
              </div>
              <div className="space-y-1.5">
                {items.map((item) => {
                  const isAutoFilled = autoFilled.has(item.id);
                  const isChecked = checked[item.id] || isAutoFilled;
                  return (
                    <label key={item.id} className="flex items-start gap-2 cursor-pointer group">
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(val) => setChecked((prev) => ({ ...prev, [item.id]: !!val }))}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <p className={cn("text-[11px] leading-relaxed", isChecked && "line-through text-muted-foreground/60")}>
                          {item.label}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <code className="text-[9px] font-mono text-muted-foreground bg-muted/60 px-1 rounded">{item.codeRef}</code>
                          {isAutoFilled && (
                            <span className="flex items-center gap-0.5 text-[9px] text-destructive">
                              <AlertTriangle className="h-2.5 w-2.5" /> AI flagged
                            </span>
                          )}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
