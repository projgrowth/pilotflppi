/**
 * Compact tab strip for the plan review right panel.
 *
 * Findings + Letter live as primary tabs (the everyday flow). The remaining
 * supporting views — Checklist, Completeness, County — are tucked behind a
 * "More" dropdown so the strip stays calm and readable. The active mode
 * surfaces in the "More" trigger when one of those secondary views is open,
 * so users always know where they are.
 */
import { ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type RightPanelMode = "findings" | "checklist" | "completeness" | "letter" | "county";

interface Props {
  active: RightPanelMode;
  onChange: (m: RightPanelMode) => void;
  findingsCount?: number;
}

const PRIMARY: { id: RightPanelMode; label: string }[] = [
  { id: "findings", label: "Findings" },
  { id: "letter", label: "Letter" },
];

const SECONDARY: { id: RightPanelMode; label: string; description: string }[] = [
  { id: "checklist", label: "Checklist", description: "Discipline review checklist" },
  { id: "completeness", label: "Completeness", description: "Site plan completeness" },
  { id: "county", label: "County", description: "County requirements" },
];

const SECONDARY_LABEL: Record<RightPanelMode, string> = {
  findings: "Findings",
  letter: "Letter",
  checklist: "Checklist",
  completeness: "Completeness",
  county: "County",
};

export function RightPanelTabs({ active, onChange, findingsCount }: Props) {
  const isSecondaryActive = SECONDARY.some((s) => s.id === active);

  return (
    <>
      {PRIMARY.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "px-3 py-1 rounded-md text-xs font-medium transition-all whitespace-nowrap",
            active === tab.id ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted/50"
          )}
        >
          {tab.label}
          {tab.id === "findings" && typeof findingsCount === "number" && findingsCount > 0 && (
            <span className="ml-1 text-caption opacity-70">{findingsCount}</span>
          )}
        </button>
      ))}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium transition-all whitespace-nowrap",
              isSecondaryActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted/50"
            )}
          >
            {isSecondaryActive ? SECONDARY_LABEL[active] : "More"}
            <ChevronDown className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[180px]">
          {SECONDARY.map((s) => (
            <DropdownMenuItem
              key={s.id}
              onClick={() => onChange(s.id)}
              className={cn("flex flex-col items-start gap-0.5", active === s.id && "bg-accent/10")}
            >
              <span className="text-xs font-medium">{s.label}</span>
              <span className="text-[10px] text-muted-foreground">{s.description}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
