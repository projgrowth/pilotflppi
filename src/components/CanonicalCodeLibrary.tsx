// Admin-only canonical FBC code library manager. Lets an admin browse stub
// rows in fbc_code_sections and one-click seed real requirement text via
// the seed-canonical-section edge function (AI mode) or paste verbatim text
// (manual mode). Bulk "seed N stubs" runs sequentially with throttling.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, Save, RefreshCw, Brain } from "lucide-react";
import { toast } from "sonner";

interface CodeRow {
  id: string;
  code: string;
  section: string;
  edition: string;
  title: string;
  requirement_text: string;
  embedded_at: string | null;
}

const STUB_LIMIT = 60;

function isStub(text: string | null | undefined): boolean {
  if (!text) return true;
  const t = text.trim().toLowerCase();
  return t.length < 60 || t.includes("see fbc for full requirement text");
}

export function CanonicalCodeLibrary() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CodeRow | null>(null);
  const [manualText, setManualText] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0, failed: 0 });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["canonical-sections", search],
    queryFn: async (): Promise<CodeRow[]> => {
      let q = supabase
        .from("fbc_code_sections")
        .select("id, code, section, edition, title, requirement_text")
        .order("section", { ascending: true })
        .limit(500);
      if (search.trim()) q = q.ilike("section", `%${search.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CodeRow[];
    },
  });

  const stubs = useMemo(() => (rows ?? []).filter((r) => isStub(r.requirement_text)), [rows]);
  const realRows = useMemo(() => (rows ?? []).filter((r) => !isStub(r.requirement_text)), [rows]);

  useEffect(() => {
    if (!selected) return;
    setManualTitle(selected.title || "");
    setManualText(isStub(selected.requirement_text) ? "" : selected.requirement_text);
  }, [selected]);

  const seedOne = async (row: CodeRow, mode: "ai" | "manual") => {
    setBusyId(row.id);
    try {
      const { data, error } = await supabase.functions.invoke("seed-canonical-section", {
        body: {
          section: row.section,
          code: row.code,
          edition: row.edition,
          mode,
          title: mode === "manual" ? manualTitle.trim() : undefined,
          requirement_text: mode === "manual" ? manualText.trim() : undefined,
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast.success(`Seeded ${row.code} ${row.section}`);
      qc.invalidateQueries({ queryKey: ["canonical-sections"] });
      if (mode === "manual") setSelected(null);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Seed failed");
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const seedManyStubs = async () => {
    const targets = stubs.slice(0, STUB_LIMIT);
    if (targets.length === 0) {
      toast.info("No stubs in current view.");
      return;
    }
    setBulkRunning(true);
    setBulkProgress({ done: 0, total: targets.length, failed: 0 });
    let done = 0;
    let failed = 0;
    for (const t of targets) {
      const ok = await seedOne(t, "ai");
      done += 1;
      if (!ok) failed += 1;
      setBulkProgress({ done, total: targets.length, failed });
      // Throttle to stay polite to the AI gateway.
      await new Promise((r) => setTimeout(r, 800));
    }
    setBulkRunning(false);
    toast.success(`Bulk seed complete: ${done - failed}/${targets.length} OK, ${failed} failed.`);
  };

  return (
    <div className="space-y-4">
      <Card className="shadow-subtle">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Canonical FBC Library</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {isLoading
                ? "Loading…"
                : `${rows?.length ?? 0} sections shown · ${stubs.length} stubs · ${realRows.length} real`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Filter by section (e.g. 1006)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => qc.invalidateQueries({ queryKey: ["canonical-sections"] })}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" onClick={seedManyStubs} disabled={bulkRunning || stubs.length === 0}>
              {bulkRunning ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  {bulkProgress.done}/{bulkProgress.total}
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                  AI-seed {Math.min(STUB_LIMIT, stubs.length)} stubs
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[420px] overflow-y-auto divide-y">
            {(rows ?? []).map((r) => {
              const stub = isStub(r.requirement_text);
              return (
                <button
                  key={r.id}
                  onClick={() => setSelected(r)}
                  className={`w-full text-left px-4 py-2.5 hover:bg-muted/40 transition-colors flex items-center justify-between gap-3 ${
                    selected?.id === r.id ? "bg-muted/60" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">{r.code} {r.section}</span>
                      <span className="text-2xs text-muted-foreground">({r.edition})</span>
                      {stub ? (
                        <Badge variant="outline" className="text-2xs h-4 border-amber-500/40 text-amber-700 dark:text-amber-400">
                          stub
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-2xs h-4 border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
                          seeded
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">{r.title}</div>
                  </div>
                  {busyId === r.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  ) : stub ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        seedOne(r, "ai");
                      }}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </button>
              );
            })}
            {(rows ?? []).length === 0 && !isLoading && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No sections match.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {selected && (
        <Card className="shadow-subtle">
          <CardHeader>
            <CardTitle className="text-base">
              Edit {selected.code} {selected.section}{" "}
              <span className="text-xs font-normal text-muted-foreground">({selected.edition})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Title</Label>
              <Input
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
                placeholder="Section heading text"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Requirement text (verbatim)</Label>
              <Textarea
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                placeholder="Paste the FBC requirement text exactly as published…"
                rows={8}
                className="text-xs font-mono"
              />
              <p className="text-2xs text-muted-foreground">
                Min 60 chars. Used by the citation grounder to validate findings.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelected(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === selected.id}
                onClick={() => seedOne(selected, "ai")}
              >
                {busyId === selected.id ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                )}
                AI seed
              </Button>
              <Button
                size="sm"
                disabled={busyId === selected.id || manualText.trim().length < 60}
                onClick={() => seedOne(selected, "manual")}
              >
                <Save className="h-3.5 w-3.5 mr-1.5" /> Save manual
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
