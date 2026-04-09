import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useInspections } from "@/hooks/useInspections";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { ClipboardCheck, Video, ChevronLeft, ChevronRight, Loader2, CheckCircle2, FileText } from "lucide-react";
import { format, startOfWeek, addDays, isSameDay } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Inspection } from "@/hooks/useInspections";

const tradeChecklists: Record<string, { item: string; code: string }[]> = {
  building: [
    { item: "Structural framing verified per approved plans", code: "FBC 1604" },
    { item: "Foundation per approved soil report & FBC 1809", code: "FBC 1809" },
    { item: "Roof-to-wall connections per FBC 2304.9", code: "FBC 2304.9" },
    { item: "Fire-stopping at penetrations per FBC 714", code: "FBC 714" },
    { item: "Fire-resistance rated assemblies per FBC 703", code: "FBC 703" },
    { item: "Exit signs & emergency lighting per FBC 1013", code: "FBC 1013" },
    { item: "Egress path width & travel distance per FBC 1005", code: "FBC 1005" },
    { item: "ADA accessible route & clearances per FBC 1104", code: "FBC 1104" },
    { item: "Building envelope sealed & weather-resistant", code: "FBC 1403" },
    { item: "Impact protection / shutters (wind-borne debris)", code: "FBC 1626" },
    { item: "Permits posted & visible on site", code: "F.S. 553.79" },
    { item: "Setbacks and lot coverage verified", code: "Local Zoning" },
    { item: "Previous deficiencies resolved", code: "N/A" },
  ],
  electrical: [
    { item: "Service entrance & panel sizing per NEC 230", code: "NEC 230" },
    { item: "Branch circuit design per NEC 210", code: "NEC 210" },
    { item: "GFCI protection (kitchens, baths, garages, exterior)", code: "NEC 210.8" },
    { item: "AFCI protection in dwelling bedrooms", code: "NEC 210.12" },
    { item: "Grounding electrode system per NEC 250", code: "NEC 250" },
    { item: "Conductor sizing & overcurrent protection", code: "NEC 240" },
    { item: "Panel labeling & directory complete", code: "NEC 408.4" },
    { item: "Outdoor/wet location fixtures rated", code: "NEC 410.10" },
    { item: "Surge protection device (SPD) installed", code: "NEC 230.67" },
    { item: "Load calculations provided per NEC 220", code: "NEC 220" },
    { item: "EV ready parking per FBC-B 406.9", code: "FBC-B 406.9" },
  ],
  plumbing: [
    { item: "Pressure test passed (min 15 min hold)", code: "FPC 312" },
    { item: "Backflow preventers at all cross-connections", code: "FPC 608" },
    { item: "Vent stack connections per FPC 901–917", code: "FPC 901" },
    { item: "Water heater T&P relief valve & pan", code: "FPC 504.6" },
    { item: "Drainage slope ≥ 1/4\"/ft for ≤ 3\" pipe", code: "FPC 704" },
    { item: "Fixture count per occupancy (FPC Table 403.1)", code: "FPC 403" },
    { item: "Water supply sizing per FPC 604", code: "FPC 604" },
    { item: "Cleanout access per FPC 708", code: "FPC 708" },
    { item: "Hot water recirculation or demand system", code: "FECC C404" },
    { item: "Gas piping tested & labeled", code: "FFC 406.4" },
  ],
  mechanical: [
    { item: "HVAC load calculations (Manual J or equiv.)", code: "FMC 301" },
    { item: "Duct sizing per Manual D", code: "FMC 603" },
    { item: "Duct sealing & insulation per FECC C403", code: "FECC C403" },
    { item: "Ventilation rates per ASHRAE 62.1/62.2", code: "FMC 401" },
    { item: "Refrigerant line sizing & brazing", code: "FMC 1101" },
    { item: "Equipment efficiency meets SEER2 minimum", code: "FECC C403.3" },
    { item: "Thermostat wiring & placement correct", code: "FMC 603" },
    { item: "Kitchen/bath exhaust per FMC 501", code: "FMC 501" },
    { item: "Dryer exhaust vent ≤ 35 ft per FMC 504", code: "FMC 504" },
    { item: "Condensate line to approved terminus", code: "FMC 307.2.3" },
    { item: "Platform/clearance for equipment access", code: "FMC 306" },
  ],
  general: [
    { item: "Site conditions acceptable", code: "N/A" },
    { item: "Permits posted & visible", code: "F.S. 553.79" },
    { item: "Safety equipment present", code: "OSHA" },
    { item: "Contractor on-site & licensed", code: "F.S. 489" },
    { item: "Previous deficiencies resolved", code: "N/A" },
    { item: "Approved plans on-site & accessible", code: "FBC 107.3" },
  ],
};

export default function Inspections() {
  const { data: inspections, isLoading } = useInspections();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedInspection, setSelectedInspection] = useState<Inspection | null>(null);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [inspectionNotes, setInspectionNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const getInspectionsForDay = (day: Date) =>
    (inspections || []).filter((insp) => insp.scheduled_at && isSameDay(new Date(insp.scheduled_at), day));

  const openInspection = (insp: Inspection) => {
    setSelectedInspection(insp);
    setCheckedItems(new Set());
    setInspectionNotes(insp.notes || "");
  };

  const submitResult = async (result: "pass" | "fail" | "partial") => {
    if (!selectedInspection) return;
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("inspections")
        .update({
          result,
          notes: inspectionNotes || null,
          certificate_issued: result === "pass",
        })
        .eq("id", selectedInspection.id);
      if (error) throw error;

      if (result === "pass") {
        await supabase
          .from("projects")
          .update({ status: "inspection_complete" as const })
          .eq("id", selectedInspection.project_id);
      }

      queryClient.invalidateQueries({ queryKey: ["inspections"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success(`Inspection marked as ${result}`);
      setSelectedInspection(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save result");
    } finally {
      setSubmitting(false);
    }
  };

  const tradeType = selectedInspection?.project?.trade_type || "general";
  const checklist = tradeChecklists[tradeType] || tradeChecklists.general;

  return (
    <div className="p-8 md:p-10 max-w-7xl">
      <PageHeader title="Inspections" />

      {/* Week navigation */}
      <div className="mb-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setWeekStart(addDays(weekStart, -7))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium">
          {format(weekStart, "MMM d")} — {format(addDays(weekStart, 6), "MMM d, yyyy")}
        </span>
        <Button variant="ghost" size="icon" onClick={() => setWeekStart(addDays(weekStart, 7))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
          Today
        </Button>
      </div>

      {/* Weekly calendar grid */}
      <div className="grid grid-cols-7 gap-2">
        {weekDays.map((day) => {
          const dayInspections = getInspectionsForDay(day);
          const isToday = isSameDay(day, new Date());
          return (
            <div key={day.toISOString()} className="min-h-[160px]">
              <div className={cn(
                "text-center py-1.5 rounded-t-lg text-xs font-medium",
                isToday ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"
              )}>
                <div>{format(day, "EEE")}</div>
                <div className="text-lg font-semibold">{format(day, "d")}</div>
              </div>
              <div className="border border-t-0 rounded-b-lg p-1.5 space-y-1.5 min-h-[120px]">
                {isLoading ? (
                  <div className="h-14 rounded bg-muted animate-pulse" />
                ) : dayInspections.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground/50 text-center pt-4">No inspections</p>
                ) : (
                  dayInspections.map((insp) => (
                    <button
                      key={insp.id}
                      onClick={() => openInspection(insp)}
                      className={cn(
                        "w-full text-left rounded border p-1.5 transition-colors",
                        insp.result === "pass" ? "bg-success/10 border-success/20" :
                        insp.result === "fail" ? "bg-destructive/10 border-destructive/20" :
                        insp.result === "partial" ? "bg-warning/10 border-warning/20" :
                        "bg-teal/10 border-teal/20 hover:bg-teal/20"
                      )}
                    >
                      <p className="text-[11px] font-medium truncate">{insp.project?.name || "Unnamed"}</p>
                      <p className="text-[10px] text-muted-foreground capitalize">{insp.inspection_type}</p>
                      {insp.scheduled_at && (
                        <p className="text-[10px] text-muted-foreground">{format(new Date(insp.scheduled_at), "h:mm a")}</p>
                      )}
                      <div className="flex items-center gap-1 mt-0.5">
                        {insp.virtual && <Video className="h-3 w-3 text-teal" />}
                        {insp.result !== "pending" && (
                          <span className={cn("text-[9px] font-medium capitalize",
                            insp.result === "pass" ? "text-success" : insp.result === "fail" ? "text-destructive" : "text-warning"
                          )}>
                            {insp.result}
                          </span>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* No inspections empty state */}
      {!isLoading && (inspections || []).length === 0 && (
        <EmptyState
          icon={ClipboardCheck}
          title="No inspections scheduled"
          description="Schedule inspections from project details"
          className="mt-6"
        />
      )}

      {/* Start Inspection side panel */}
      <Sheet open={!!selectedInspection} onOpenChange={(open) => !open && setSelectedInspection(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-lg">
              {selectedInspection?.result !== "pending" ? "Inspection Results" : "Start Inspection"}
            </SheetTitle>
          </SheetHeader>

          {selectedInspection && (
            <div className="mt-6 space-y-6">
              <Card className="shadow-subtle border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground">Project Brief</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm font-medium">{selectedInspection.project?.name}</p>
                  <p className="text-xs text-muted-foreground">{selectedInspection.project?.address}</p>
                  <div className="flex gap-2">
                    <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium capitalize">{selectedInspection.project?.trade_type}</span>
                    <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium capitalize">{selectedInspection.inspection_type}</span>
                  </div>
                    {selectedInspection.virtual && selectedInspection.video_call_url && (
                      <a href={selectedInspection.video_call_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-teal hover:underline">
                        <Video className="h-3.5 w-3.5" /> Join Video Call
                      </a>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs gap-1.5"
                      onClick={() => {
                        setSelectedInspection(null);
                        navigate(`/projects/${selectedInspection.project_id}`);
                      }}
                    >
                      <FileText className="h-3.5 w-3.5" /> View Project Plans
                    </Button>
                  {selectedInspection.result !== "pending" && (
                    <div className={cn("flex items-center gap-2 mt-2 rounded-lg p-2 text-sm font-medium",
                      selectedInspection.result === "pass" ? "bg-success/10 text-success" :
                      selectedInspection.result === "fail" ? "bg-destructive/10 text-destructive" :
                      "bg-warning/10 text-warning"
                    )}>
                      <CheckCircle2 className="h-4 w-4" />
                      Result: {selectedInspection.result.toUpperCase()}
                      {selectedInspection.certificate_issued && " — Certificate Issued"}
                    </div>
                  )}
                </CardContent>
              </Card>

              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
                  {tradeType.charAt(0).toUpperCase() + tradeType.slice(1)} Checklist
                </h3>
                <div className="space-y-2">
                  {checklist.map((entry) => (
                    <label key={entry.item} className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/30 transition-colors">
                      <Checkbox
                        checked={checkedItems.has(entry.item)}
                        onCheckedChange={(checked) => {
                          const next = new Set(checkedItems);
                          checked ? next.add(entry.item) : next.delete(entry.item);
                          setCheckedItems(next);
                        }}
                        disabled={selectedInspection.result !== "pending"}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm">{entry.item}</span>
                        <code className="block text-[9px] font-mono text-muted-foreground mt-0.5">{entry.code}</code>
                      </div>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {checkedItems.size}/{checklist.length} items checked
                </p>
              </div>

              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Notes</h3>
                <Textarea
                  value={inspectionNotes}
                  onChange={(e) => setInspectionNotes(e.target.value)}
                  placeholder="Add inspection notes..."
                  rows={4}
                  readOnly={selectedInspection.result !== "pending"}
                />
              </div>

              {selectedInspection.result === "pending" && (
                <div className="flex gap-2">
                  <Button
                    className="flex-1 bg-success text-success-foreground hover:bg-success/90"
                    onClick={() => submitResult("pass")}
                    disabled={submitting}
                  >
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Pass
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 border-warning text-warning hover:bg-warning/10"
                    onClick={() => submitResult("partial")}
                    disabled={submitting}
                  >
                    Partial
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 border-destructive text-destructive hover:bg-destructive/10"
                    onClick={() => submitResult("fail")}
                    disabled={submitting}
                  >
                    Fail
                  </Button>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
