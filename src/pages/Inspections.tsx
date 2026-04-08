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

const tradeChecklists: Record<string, string[]> = {
  building: ["Structural framing verified", "Fire-stopping in place", "Egress paths clear", "ADA compliance checked", "Building envelope sealed"],
  electrical: ["Panel wiring per NEC", "GFCI protection verified", "Grounding system tested", "Arc-fault breakers installed", "Load calculations confirmed"],
  plumbing: ["Pressure test passed", "Backflow preventers installed", "Vent stack connections verified", "Water heater compliance", "Drainage slope confirmed"],
  mechanical: ["Ductwork sealed & insulated", "HVAC load calculations verified", "Refrigerant lines tested", "Thermostat wiring correct", "Exhaust ventilation confirmed"],
  general: ["Site conditions acceptable", "Permits posted & visible", "Safety equipment present", "Contractor on-site", "Previous deficiencies resolved"],
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
    <div className="p-6 md:p-8 max-w-7xl">
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
                  {checklist.map((item) => (
                    <label key={item} className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/30 transition-colors">
                      <Checkbox
                        checked={checkedItems.has(item)}
                        onCheckedChange={(checked) => {
                          const next = new Set(checkedItems);
                          checked ? next.add(item) : next.delete(item);
                          setCheckedItems(next);
                        }}
                        disabled={selectedInspection.result !== "pending"}
                      />
                      <span className="text-sm">{item}</span>
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
