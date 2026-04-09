import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Info, Save, Loader2, Building2, Sparkles, Upload } from "lucide-react";
import {
  ZoningData,
  EMPTY_ZONING,
  ZoningCheck,
  runZoningChecks,
  COMMON_OCCUPANCY_GROUPS,
} from "@/lib/zoning-utils";
import { renderPDFPagesToImages } from "@/lib/pdf-utils";

interface ZoningAnalysisPanelProps {
  projectId: string;
  initialData?: ZoningData | null;
  onSaved?: () => void;
}

function numOrNull(v: string): number | null {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function d(v: number | null): string {
  return v !== null && v !== undefined ? String(v) : "";
}

const statusIcon = (s: ZoningCheck["status"]) => {
  if (s === "pass") return <CheckCircle2 className="h-4 w-4 text-success shrink-0" />;
  if (s === "fail") return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
  return <Info className="h-4 w-4 text-muted-foreground shrink-0" />;
};

const ZONING_FIELDS: (keyof ZoningData)[] = [
  "zoning_district", "lot_area_sqft", "building_footprint_sqft", "total_building_area_sqft",
  "stories", "max_far", "max_lot_coverage_pct", "max_height_ft", "max_stories",
  "setback_front_ft", "setback_side_ft", "setback_rear_ft", "parking_ratio_per_sqft",
  "landscape_buffer_ft", "frontage_lf", "signage_ratio_sqft_per_lf", "occupancy_groups", "notes",
];

export function ZoningAnalysisPanel({ projectId, initialData, onSaved }: ZoningAnalysisPanelProps) {
  const [z, setZ] = useState<ZoningData>(() => {
    const base = initialData ?? EMPTY_ZONING;
    return { ...base, occupancy_groups: base.occupancy_groups ?? [] };
  });
  const [checks, setChecks] = useState<ZoningCheck[]>([]);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [aiFilledFields, setAiFilledFields] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setChecks(runZoningChecks(z));
  }, [z]);

  const set = useCallback((field: keyof ZoningData, value: string | number | null | string[]) => {
    setZ((prev) => ({ ...prev, [field]: value }));
  }, []);

  const toggleOccupancy = useCallback((code: string) => {
    setZ((prev) => {
      const groups = (prev.occupancy_groups ?? []).includes(code)
        ? (prev.occupancy_groups ?? []).filter((g) => g !== code)
        : [...(prev.occupancy_groups ?? []), code];
      return { ...prev, occupancy_groups: groups };
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("projects")
      .update({ zoning_data: z as any })
      .eq("id", projectId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Zoning data saved");
      onSaved?.();
    }
  };

  const handleAIExtract = async (file: File) => {
    setExtracting(true);
    try {
      let base64Image: string;

      if (file.type === "application/pdf") {
        const images = await renderPDFPagesToImages(file, 1, 200);
        if (!images.length) {
          toast.error("Could not render PDF page");
          return;
        }
        base64Image = images[0].base64;
      } else {
        base64Image = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }

      const { data, error } = await supabase.functions.invoke("ai", {
        body: {
          action: "extract_zoning_data",
          payload: { images: [base64Image] },
        },
      });

      if (error) throw error;

      const parsed = typeof data.content === "string" ? JSON.parse(data.content) : data.content;

      // Merge: only overwrite non-null extracted values
      const filled = new Set<string>();
      setZ((prev) => {
        const merged = { ...prev };
        for (const key of ZONING_FIELDS) {
          const val = parsed[key];
          if (val === null || val === undefined) continue;
          if (key === "occupancy_groups" && Array.isArray(val) && val.length > 0) {
            merged.occupancy_groups = val;
            filled.add(key);
          } else if (key === "notes" && typeof val === "string" && val.trim()) {
            merged.notes = val;
            filled.add(key);
          } else if (key === "zoning_district" && typeof val === "string" && val.trim()) {
            merged.zoning_district = val;
            filled.add(key);
          } else if (typeof val === "number") {
            (merged as any)[key] = val;
            filled.add(key);
          }
        }
        return merged;
      });

      setAiFilledFields(filled);
      toast.success(`AI extracted ${filled.size} field${filled.size !== 1 ? "s" : ""} from the site plan`);
    } catch (err: any) {
      console.error("Zoning extraction error:", err);
      toast.error(err?.message || "Failed to extract zoning data");
    } finally {
      setExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleAIExtract(file);
  };

  const failCount = checks.filter((c) => c.status === "fail").length;

  const fieldLabel = (field: string) =>
    aiFilledFields.has(field) ? (
      <span className="inline-flex items-center gap-1">
        <Sparkles className="h-3 w-3 text-accent" />
        <span className="text-[9px] text-accent font-medium">AI</span>
      </span>
    ) : null;

  return (
    <div className="space-y-6">
      {/* AI Auto-Fill */}
      <Card className="shadow-subtle border border-accent/20 bg-accent/5">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-accent" />
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">AI Auto-Fill from Site Plan</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Upload a site plan sheet, survey, or zoning data table. AI will extract lot area, setbacks, zoning district, and more.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            className="hidden"
            onChange={onFileChange}
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={extracting}
            className="border-accent/30 hover:bg-accent/10"
          >
            {extracting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                Analyzing site plan…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-1" />
                Upload Site Plan
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Compliance results */}
      {checks.length > 0 && (
        <Card className="shadow-subtle border">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Compliance Checks</h3>
              {failCount > 0 ? (
                <Badge variant="destructive" className="text-[10px]">{failCount} issue{failCount > 1 ? "s" : ""}</Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px] text-success border-success/30">All clear</Badge>
              )}
            </div>
            <div className="space-y-2">
              {checks.map((c, i) => (
                <div key={i} className="flex items-start gap-2 py-2 border-b border-border/50 last:border-0">
                  {statusIcon(c.status)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{c.label}</span>
                      <span className="text-xs text-muted-foreground">{c.actual} / {c.allowed}</span>
                    </div>
                    {c.detail && <p className="text-xs text-destructive mt-0.5">{c.detail}</p>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Input form */}
      <Card className="shadow-subtle border">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="h-4 w-4 text-accent" />
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Zoning & Lot Data</h3>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label className="text-xs flex items-center gap-1">Zoning District {fieldLabel("zoning_district")}</Label>
              <Input placeholder="e.g. C-2 (General Commercial)" value={z.zoning_district} onChange={(e) => set("zoning_district", e.target.value)} />
            </div>

            <div>
              <Label className="text-xs flex items-center gap-1">Lot Area (sqft) {fieldLabel("lot_area_sqft")}</Label>
              <Input type="number" placeholder="108,900" value={d(z.lot_area_sqft)} onChange={(e) => set("lot_area_sqft", numOrNull(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1">Building Footprint (sqft) {fieldLabel("building_footprint_sqft")}</Label>
              <Input type="number" placeholder="70,000" value={d(z.building_footprint_sqft)} onChange={(e) => set("building_footprint_sqft", numOrNull(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1">Total Building Area (sqft) {fieldLabel("total_building_area_sqft")}</Label>
              <Input type="number" placeholder="70,000" value={d(z.total_building_area_sqft)} onChange={(e) => set("total_building_area_sqft", numOrNull(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1">Stories {fieldLabel("stories")}</Label>
              <Input type="number" placeholder="2" value={d(z.stories)} onChange={(e) => set("stories", numOrNull(e.target.value))} />
            </div>

            <div className="sm:col-span-2 border-t border-border/50 pt-4 mt-2">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Allowable Limits</span>
            </div>

            <div>
              <Label className="text-xs flex items-center gap-1">Max FAR {fieldLabel("max_far")}</Label>
              <Input type="number" step="0.01" placeholder="0.5" value={d(z.max_far)} onChange={(e) => set("max_far", numOrNull(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1">Max Lot Coverage (%) {fieldLabel("max_lot_coverage_pct")}</Label>
              <Input type="number" placeholder="60" value={d(z.max_lot_coverage_pct)} onChange={(e) => set("max_lot_coverage_pct", numOrNull(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1">Max Height (ft) {fieldLabel("max_height_ft")}</Label>
              <Input type="number" placeholder="45" value={d(z.max_height_ft)} onChange={(e) => set("max_height_ft", numOrNull(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1">Max Stories {fieldLabel("max_stories")}</Label>
              <Input type="number" placeholder="3" value={d(z.max_stories)} onChange={(e) => set("max_stories", numOrNull(e.target.value))} />
            </div>

            <div className="sm:col-span-2 border-t border-border/50 pt-4 mt-2">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Setbacks & Parking</span>
            </div>

            <div>
              <Label className="text-xs flex items-center gap-1">Front Setback (ft) {fieldLabel("setback_front_ft")}</Label>
              <Input type="number" placeholder="25" value={d(z.setback_front_ft)} onChange={(e) => set("setback_front_ft", numOrNull(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1">Side Setback (ft) {fieldLabel("setback_side_ft")}</Label>
              <Input type="number" placeholder="10" value={d(z.setback_side_ft)} onChange={(e) => set("setback_side_ft", numOrNull(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1">Rear Setback (ft) {fieldLabel("setback_rear_ft")}</Label>
              <Input type="number" placeholder="15" value={d(z.setback_rear_ft)} onChange={(e) => set("setback_rear_ft", numOrNull(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1">Parking Ratio (1 per X sqft) {fieldLabel("parking_ratio_per_sqft")}</Label>
              <Input type="number" placeholder="200" value={d(z.parking_ratio_per_sqft)} onChange={(e) => set("parking_ratio_per_sqft", numOrNull(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1">Landscape Buffer (ft) {fieldLabel("landscape_buffer_ft")}</Label>
              <Input type="number" placeholder="15" value={d(z.landscape_buffer_ft)} onChange={(e) => set("landscape_buffer_ft", numOrNull(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1">Frontage (LF) {fieldLabel("frontage_lf")}</Label>
              <Input type="number" placeholder="200" value={d(z.frontage_lf)} onChange={(e) => set("frontage_lf", numOrNull(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1">Signage Ratio (sqft/LF) {fieldLabel("signage_ratio_sqft_per_lf")}</Label>
              <Input type="number" step="0.1" placeholder="1" value={d(z.signage_ratio_sqft_per_lf)} onChange={(e) => set("signage_ratio_sqft_per_lf", numOrNull(e.target.value))} />
            </div>

            <div className="sm:col-span-2 border-t border-border/50 pt-4 mt-2">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                Occupancy Groups {fieldLabel("occupancy_groups")}
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
                {COMMON_OCCUPANCY_GROUPS.map((g) => (
                  <label key={g.code} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/30 rounded p-1.5 transition-colors">
                    <Checkbox
                      checked={z.occupancy_groups.includes(g.code)}
                      onCheckedChange={() => toggleOccupancy(g.code)}
                    />
                    {g.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="sm:col-span-2">
              <Label className="text-xs flex items-center gap-1">Notes {fieldLabel("notes")}</Label>
              <Textarea placeholder="Additional zoning notes, variance requests, etc." value={z.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
            </div>
          </div>

          <div className="flex justify-end mt-4">
            <Button onClick={handleSave} disabled={saving} className="bg-accent text-accent-foreground hover:bg-accent/90">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Save Zoning Data
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
