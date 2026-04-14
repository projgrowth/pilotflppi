import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  SITE_PLAN_REQUIRED_ELEMENTS,
  GENERAL_PLAN_REQUIRED_ELEMENTS,
  type CompletenessItem,
} from "@/lib/county-utils";
import type { Finding } from "@/components/FindingCard";
import {
  CheckCircle2, XCircle, MinusCircle, ClipboardList, AlertTriangle, FileWarning,
} from "lucide-react";

type ItemState = "present" | "missing" | "na";

interface SitePlanChecklistProps {
  findings: Finding[];
  county?: string;
  className?: string;
}

/** Keywords in AI findings that map to checklist items */
const MATCH_KEYWORDS: Record<string, string[]> = {
  "sp-legal": ["legal description", "survey"],
  "sp-boundaries": ["property boundar", "boundary"],
  "sp-setbacks": ["setback"],
  "sp-structures": ["structure", "building footprint", "distance to property"],
  "sp-parking": ["parking", "ada space", "accessible space"],
  "sp-driveways": ["driveway", "sight triangle"],
  "sp-drainage": ["drainage", "stormwater", "swale"],
  "sp-utilities": ["utility connection", "water", "sewer", "electric service"],
  "sp-easements": ["easement", "right-of-way", "r.o.w"],
  "sp-landscape": ["landscape", "tree survey", "tree preservation"],
  "sp-flood": ["flood zone", "bfe", "base flood"],
  "sp-cccl": ["cccl", "coastal construction"],
  "sp-trash": ["trash enclosure", "dumpster"],
  "sp-fire-access": ["fire department access", "hydrant", "fire access"],
  "gp-title": ["title block", "architect", "engineer of record", "sealed drawing"],
  "gp-index": ["index of drawing", "sheet index", "drawing index"],
  "gp-code-summary": ["code summary", "occupancy class", "construction type", "allowable area"],
  "gp-life-safety": ["life safety", "egress plan", "exit path", "occupant load"],
  "gp-structural-notes": ["structural note", "design load", "wind speed", "exposure category"],
  "gp-energy": ["energy compliance", "comcheck", "form 402", "energy code"],
  "gp-product-approvals": ["product approval", "noa", "fl#", "fl number"],
  "gp-threshold": ["threshold building", "threshold inspector"],
  "gp-special-inspector": ["special inspector"],
  "gp-fbc-edition": ["fbc edition", "code edition", "florida building code"],
  "gp-noa": ["noa", "notice of acceptance"],
};

function shouldShowItem(item: CompletenessItem, county: string): boolean {
  if (!item.condition) return true;
  const c = county.toLowerCase();
  if (item.condition === "hvhz") return ["miami-dade", "broward"].includes(c);
  if (item.condition === "coastal") return ["miami-dade", "broward", "palm-beach", "martin", "st-lucie", "indian-river", "brevard", "volusia", "flagler", "st-johns", "duval", "nassau", "bay", "walton", "okaloosa", "escambia", "santa-rosa", "gulf", "franklin", "wakulla", "jefferson", "taylor", "dixie", "levy", "citrus", "hernando", "pasco", "pinellas", "hillsborough", "manatee", "sarasota", "charlotte", "lee", "collier", "monroe"].includes(c);
  return true; // flood & threshold always visible
}

export function SitePlanChecklist({ findings, county = "", className }: SitePlanChecklistProps) {
  const allItems = useMemo(() => {
    return [...SITE_PLAN_REQUIRED_ELEMENTS, ...GENERAL_PLAN_REQUIRED_ELEMENTS]
      .filter((item) => shouldShowItem(item, county));
  }, [county]);

  // Auto-detect missing items from AI findings
  const aiMissing = useMemo(() => {
    const missing = new Set<string>();
    for (const f of findings) {
      if (f.severity !== "critical" && f.severity !== "major") continue;
      const desc = (f.description || "").toLowerCase();
      const rec = (f.recommendation || "").toLowerCase();
      const combined = `${desc} ${rec}`;
      for (const [itemId, keywords] of Object.entries(MATCH_KEYWORDS)) {
        if (keywords.some((kw) => combined.includes(kw))) {
          // Only mark as missing if the finding indicates absence
          if (combined.includes("missing") || combined.includes("not shown") || combined.includes("not provided") || combined.includes("absent") || combined.includes("no ")) {
            missing.add(itemId);
          }
        }
      }
    }
    return missing;
  }, [findings]);

  const [states, setStates] = useState<Record<string, ItemState>>({});

  const getState = (id: string): ItemState => {
    if (states[id]) return states[id];
    if (aiMissing.has(id)) return "missing";
    return "present"; // default assumption
  };

  const cycleState = (id: string) => {
    const current = getState(id);
    const next: ItemState = current === "present" ? "missing" : current === "missing" ? "na" : "present";
    setStates((prev) => ({ ...prev, [id]: next }));
  };

  const siteItems = allItems.filter((i) => i.category === "site_plan");
  const generalItems = allItems.filter((i) => i.category === "general");

  const missingCount = allItems.filter((i) => getState(i.id) === "missing").length;
  const presentCount = allItems.filter((i) => getState(i.id) === "present").length;
  const naCount = allItems.filter((i) => getState(i.id) === "na").length;
  const applicableCount = allItems.length - naCount;
  const readinessPct = applicableCount > 0 ? Math.round((presentCount / applicableCount) * 100) : 100;

  const stateIcons: Record<ItemState, React.ReactNode> = {
    present: <CheckCircle2 className="h-3.5 w-3.5 text-success" />,
    missing: <XCircle className="h-3.5 w-3.5 text-destructive" />,
    na: <MinusCircle className="h-3.5 w-3.5 text-muted-foreground/40" />,
  };

  const renderSection = (title: string, items: CompletenessItem[], icon: React.ReactNode) => (
    <Card className="shadow-subtle">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <span className="text-xs font-semibold">{title}</span>
          <Badge variant="outline" className="text-caption ml-auto">
            {items.filter((i) => getState(i.id) === "missing").length} missing
          </Badge>
        </div>
        <div className="space-y-1">
          {items.map((item) => {
            const state = getState(item.id);
            const isAiFlagged = aiMissing.has(item.id) && !states[item.id];
            return (
              <button
                key={item.id}
                onClick={() => cycleState(item.id)}
                className={cn(
                  "w-full flex items-start gap-2 text-left px-2 py-1.5 rounded-md transition-colors hover:bg-muted/40",
                  state === "missing" && "bg-destructive/5",
                  state === "na" && "opacity-50"
                )}
              >
                {stateIcons[state]}
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    "text-xs leading-relaxed",
                    state === "na" && "line-through text-muted-foreground/50",
                    state === "missing" && "text-destructive"
                  )}>
                    {item.label}
                  </p>
                  {isAiFlagged && (
                    <span className="flex items-center gap-0.5 text-caption text-destructive mt-0.5">
                      <AlertTriangle className="h-2.5 w-2.5" /> AI flagged as missing
                    </span>
                  )}
                </div>
                {item.required && state !== "na" && (
                  <span className="text-caption font-semibold text-muted-foreground/60 shrink-0 mt-0.5">REQ</span>
                )}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className={cn("space-y-3", className)}>
      {/* Readiness bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold">Plan Completeness</span>
            <Badge
              variant="outline"
              className={cn(
                "text-2xs",
                readinessPct === 100 && "border-success/40 text-success",
                readinessPct < 80 && missingCount > 0 && "border-destructive/40 text-destructive"
              )}
            >
              {readinessPct}% Ready
            </Badge>
          </div>
          <span className="text-2xs text-muted-foreground">
            {presentCount}/{applicableCount} present · {missingCount} missing
          </span>
        </div>
        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              readinessPct === 100 ? "bg-success" : readinessPct >= 80 ? "bg-accent" : "bg-destructive"
            )}
            style={{ width: `${readinessPct}%` }}
          />
        </div>
      </div>

      {/* Missing items summary */}
      {missingCount > 0 && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2">
          <div className="flex items-center gap-1.5 mb-1">
            <FileWarning className="h-3.5 w-3.5 text-destructive" />
            <span className="text-xs font-semibold text-destructive">
              {missingCount} item{missingCount > 1 ? "s" : ""} missing — likely rejection by building official
            </span>
          </div>
          <ul className="space-y-0.5">
            {allItems.filter((i) => getState(i.id) === "missing").map((item) => (
              <li key={item.id} className="text-2xs text-destructive/80 flex gap-1.5">
                <span>•</span> {item.label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Click hint */}
      <p className="text-caption text-muted-foreground italic">Click items to cycle: Present → Missing → N/A</p>

      {renderSection("Site Plan Elements", siteItems, <ClipboardList className="h-3.5 w-3.5 text-accent" />)}
      {renderSection("General Plan Requirements", generalItems, <ClipboardList className="h-3.5 w-3.5 text-accent" />)}
    </div>
  );
}