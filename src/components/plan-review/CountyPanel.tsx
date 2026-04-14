import { MapPin, Info } from "lucide-react";
import { getCountyRequirements, getSupplementalSectionLabel } from "@/lib/county-requirements";

interface CountyPanelProps {
  county: string;
}

export function CountyPanel({ county }: CountyPanelProps) {
  const config = getCountyRequirements(county);
  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <MapPin className="h-4 w-4 text-accent" />
        <span className="text-sm font-semibold">{config.label} County Requirements</span>
        {config.hvhz && (
          <span className="text-[9px] font-bold text-destructive bg-destructive/10 px-1.5 py-0.5 rounded">HVHZ</span>
        )}
      </div>

      <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
        <div className="text-[11px]">
          <span className="text-muted-foreground">Design Wind Speed:</span>{" "}
          <span className="font-medium">{config.designWindSpeed}</span>
        </div>
        <div className="text-[11px]">
          <span className="text-muted-foreground">Product Approval:</span>{" "}
          <span className="font-medium">{config.productApprovalFormat === "NOA" ? "Miami-Dade NOA Required" : "Florida Product Approval (FL#)"}</span>
        </div>
        <div className="text-[11px]">
          <span className="text-muted-foreground">Resubmission:</span>{" "}
          <span className="font-medium">{config.resubmissionDays} calendar days</span>
        </div>
        <div className="text-[11px]">
          <span className="text-muted-foreground">Energy Path:</span>{" "}
          <span className="font-medium capitalize">{config.energyCodePath}</span>
        </div>
        {config.cccl && (
          <div className="text-[11px]">
            <span className="text-muted-foreground">CCCL:</span>{" "}
            <span className="font-medium text-destructive">Coastal Construction Control Line may apply</span>
          </div>
        )}
      </div>

      {config.amendments.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Local Amendments</h4>
          {config.amendments.map((a, i) => (
            <div key={i} className="rounded border bg-background p-2">
              <p className="text-[11px] font-medium text-accent">{a.ref}</p>
              <p className="text-[10px] text-muted-foreground">{a.description}</p>
            </div>
          ))}
        </div>
      )}

      {config.submissionNotes.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Submission Notes</h4>
          <ul className="space-y-1">
            {config.submissionNotes.map((note, i) => (
              <li key={i} className="text-[10px] text-muted-foreground flex gap-1.5">
                <Info className="h-3 w-3 text-accent shrink-0 mt-0.5" />
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-1.5">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Required Document Sections</h4>
        <div className="flex flex-wrap gap-1">
          {config.supplementalSections.map((s) => (
            <span key={s} className="text-[9px] bg-accent/10 text-accent px-2 py-0.5 rounded-full">
              {getSupplementalSectionLabel(s)}
            </span>
          ))}
        </div>
      </div>

      {config.buildingDepartment.address && (
        <div className="rounded-lg border bg-background p-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Building Department</h4>
          <p className="text-[11px] font-medium">{config.buildingDepartment.name}</p>
          <p className="text-[10px] text-muted-foreground">{config.buildingDepartment.officialTitle}</p>
          <p className="text-[10px] text-muted-foreground">{config.buildingDepartment.address}</p>
        </div>
      )}
    </div>
  );
}