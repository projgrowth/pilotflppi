import { useMemo } from "react";
import { useProjects } from "@/hooks/useProjects";
import { useReviewFlagCounts } from "@/hooks/useReviewData";
import { useAILearningStats } from "@/hooks/useAILearningStats";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, Legend, CartesianGrid } from "recharts";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const COLORS = ["#0E7C7B", "#C8972A", "#1A3250", "#2E7D52", "#5B8DB8", "#D4A017"];

const severityBarColor: Record<string, string> = {
  critical: "#D63230", major: "#E8831A", minor: "#D4A017",
};

export default function Analytics() {
  const { data: projects, isLoading: projectsLoading, error: projectsError } = useProjects();
  const { data: flagCounts } = useReviewFlagCounts();
  const { data: aiStats } = useAILearningStats();
  const [range, setRange] = useState("30");

  // Compute date filter
  const rangeDate = useMemo(() => {
    if (range === "all") return null;
    const d = new Date();
    d.setDate(d.getDate() - parseInt(range));
    return d.toISOString();
  }, [range]);

  // Real volume data — group projects by month
  const volumeData = useMemo(() => {
    const filtered = (projects || []).filter(
      (p) => !rangeDate || p.created_at >= rangeDate
    );
    const monthMap: Record<string, { started: number; completed: number }> = {};
    filtered.forEach((p) => {
      const month = new Date(p.created_at).toLocaleDateString("en-US", { month: "short" });
      if (!monthMap[month]) monthMap[month] = { started: 0, completed: 0 };
      monthMap[month].started++;
      if (["approved", "permit_issued", "certificate_issued", "inspection_complete"].includes(p.status)) {
        monthMap[month].completed++;
      }
    });
    return Object.entries(monthMap).map(([month, v]) => ({ month, ...v }));
  }, [projects, rangeDate]);

  // Real flag frequency from review_flags
  const { data: flagFrequency } = useQuery({
    queryKey: ["flag-frequency"],
    queryFn: async () => {
      const { data } = await supabase
        .from("review_flags")
        .select("description, severity")
        .eq("status", "active");
      if (!data || data.length === 0) return [];
      // Count by description (first 40 chars as key)
      const counts: Record<string, { name: string; count: number; severity: string }> = {};
      data.forEach((f) => {
        const key = (f.description || "Unknown").slice(0, 40);
        if (!counts[key]) counts[key] = { name: key, count: 0, severity: f.severity || "minor" };
        counts[key].count++;
      });
      return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 8);
    },
  });

  // Real AI accuracy from corrections vs ai_outputs
  const { data: accuracyData } = useQuery({
    queryKey: ["ai-accuracy-trend"],
    queryFn: async () => {
      const { data: outputs } = await supabase
        .from("ai_outputs")
        .select("id, created_at")
        .order("created_at");
      const { data: corrections } = await supabase
        .from("corrections")
        .select("id, created_at");
      if (!outputs || outputs.length === 0) return [];
      // Group by week
      const weeks: Record<string, { total: number; corrected: number }> = {};
      outputs.forEach((o) => {
        const week = `W${Math.ceil(new Date(o.created_at!).getDate() / 7)}`;
        if (!weeks[week]) weeks[week] = { total: 0, corrected: 0 };
        weeks[week].total++;
      });
      (corrections || []).forEach((c) => {
        const week = `W${Math.ceil(new Date(c.created_at!).getDate() / 7)}`;
        if (weeks[week]) weeks[week].corrected++;
      });
      return Object.entries(weeks).map(([week, v]) => ({
        week,
        rate: v.total > 0 ? Math.round(((v.total - v.corrected) / v.total) * 100) : 100,
      }));
    },
  });

  // Real HCR table from corrections
  const { data: hcrData } = useQuery({
    queryKey: ["hcr-table"],
    queryFn: async () => {
      const { data: corrections } = await supabase
        .from("corrections")
        .select("correction_type, fbc_section");
      const { data: outputs } = await supabase
        .from("ai_outputs")
        .select("id, prediction");
      if (!outputs || outputs.length === 0) return [];
      const totalOutputs = outputs.length;
      const totalCorrections = corrections?.length || 0;
      const overrides = corrections?.filter((c) => c.correction_type === "override").length || 0;
      const edits = corrections?.filter((c) => c.correction_type === "edit").length || 0;
      const flags = corrections?.filter((c) => c.correction_type === "flag").length || 0;
      return [
        { cat: "Overrides (AI wrong)", total: totalOutputs, confirmed: totalOutputs - overrides, overrides },
        { cat: "Edits (partially correct)", total: totalOutputs, confirmed: totalOutputs - edits, overrides: edits },
        { cat: "Missed Issues (flagged)", total: totalOutputs, confirmed: totalOutputs - flags, overrides: flags },
        { cat: "All Corrections", total: totalOutputs, confirmed: totalOutputs - totalCorrections, overrides: totalCorrections },
      ];
    },
  });

  const jurisdictionData = useMemo(() => {
    const filtered = (projects || []).filter(
      (p) => !rangeDate || p.created_at >= rangeDate
    );
    const map: Record<string, number> = {};
    filtered.forEach((p) => { map[p.county] = (map[p.county] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [projects, rangeDate]);

  const projectCount = useMemo(() => {
    return (projects || []).filter(
      (p) => !rangeDate || p.created_at >= rangeDate
    ).length;
  }, [projects, rangeDate]);

  const avgDays = useMemo(() => {
    const approved = (projects || [])
      .filter((p) => !rangeDate || p.created_at >= rangeDate)
      .filter((p) => p.status === "approved" || p.status === "certificate_issued");
    if (approved.length === 0) return 0;
    const total = approved.reduce(
      (s, p) => s + Math.floor((Date.now() - new Date(p.created_at).getTime()) / 86400000),
      0
    );
    return Math.round(total / approved.length);
  }, [projects, rangeDate]);

  const commonFlags = flagFrequency || [];

  if (projectsError) {
    return (
      <div className="page-enter flex flex-col items-center justify-center py-24">
        <p className="text-sm text-destructive mb-3">Failed to load analytics data</p>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="page-enter space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold text-foreground">Analytics</h1>
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="30">Last 30 Days</SelectItem>
            <SelectItem value="90">Last 90 Days</SelectItem>
            <SelectItem value="365">Last 12 Months</SelectItem>
            <SelectItem value="all">All Time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPI row */}
      {projectsLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="shadow-subtle">
              <CardContent className="p-5 space-y-2">
                <div className="h-3 w-24 rounded bg-muted animate-pulse" />
                <div className="h-8 w-16 rounded bg-muted animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Reviews This Period", value: projectCount },
          { label: "Avg. Turnaround", value: `${avgDays}d` },
          { label: "Flags Per Review", value: flagCounts ? Math.round(flagCounts.total / Math.max(projectCount, 1)) : 0 },
          { label: "AI Accuracy Rate", value: aiStats ? `${Math.round((1 - aiStats.hcr) * 100)}%` : "—" },
        ].map((kpi) => (
          <Card key={kpi.label} className="shadow-subtle">
            <CardContent className="p-5">
              <p className="text-[10px] uppercase tracking-wider text-fpp-gray-400 font-mono">{kpi.label}</p>
              <p className="text-3xl font-semibold text-foreground mt-1">{kpi.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      )}

      <Card className="shadow-subtle">
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold mb-4">Review Volume</h3>
          {volumeData.length === 0 ? (
            <p className="text-sm text-fpp-gray-400 text-center py-12">No project data yet for this period</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={volumeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--fpp-gray-100))" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="completed" stroke="#0E7C7B" strokeWidth={2} dot />
                <Line type="monotone" dataKey="started" stroke="#C8972A" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="shadow-subtle">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-4">Most Common Flags</h3>
            {commonFlags.length === 0 ? (
              <p className="text-sm text-fpp-gray-400 text-center py-12">No flag data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={commonFlags} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                  <Tooltip />
                  <Bar dataKey="count">
                    {commonFlags.map((entry, i) => (
                      <Cell key={i} fill={severityBarColor[entry.severity] || "#5B8DB8"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-subtle">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-1">AI Accuracy Trend</h3>
            <p className="text-[10px] text-fpp-gray-400 mb-4">% of AI flags confirmed by human reviewers — rising = AI improving</p>
            {!accuracyData || accuracyData.length === 0 ? (
              <p className="text-sm text-fpp-gray-400 text-center py-12">No AI output data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={accuracyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--fpp-gray-100))" />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                  <YAxis domain={[60, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="rate" stroke="#0E7C7B" strokeWidth={2} dot />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-subtle">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-4">Reviews by Jurisdiction</h3>
            {jurisdictionData.length === 0 ? (
              <p className="text-sm text-fpp-gray-400 text-center py-12">No project data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={jurisdictionData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                    {jurisdictionData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-subtle">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-1">Review Pipeline Funnel</h3>
            <p className="text-[10px] text-fpp-gray-400 mb-4">Current project counts by pipeline stage</p>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={(() => {
                const stageCounts: Record<string, number> = { Intake: 0, "Plan Review": 0, "Comments Sent": 0, Resubmitted: 0, Approved: 0, "Permit+": 0 };
                const filtered = (projects || []).filter(
                  (p) => !rangeDate || p.created_at >= rangeDate
                );
                filtered.forEach((p) => {
                  if (p.status === "intake") stageCounts["Intake"]++;
                  else if (p.status === "plan_review") stageCounts["Plan Review"]++;
                  else if (p.status === "comments_sent") stageCounts["Comments Sent"]++;
                  else if (p.status === "resubmitted") stageCounts["Resubmitted"]++;
                  else if (p.status === "approved") stageCounts["Approved"]++;
                  else stageCounts["Permit+"]++;
                });
                return Object.entries(stageCounts).map(([stage, count]) => ({ stage, count }));
              })()}>
                <XAxis dataKey="stage" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#0E7C7B" opacity={0.8} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* HCR Table — now from real data */}
      <Card className="shadow-subtle">
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold">AI Learning Metrics</h3>
          <p className="text-[10px] text-fpp-gray-400 mb-4">Human correction rate by category. Lower HCR = AI is improving.</p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Category</TableHead>
                  <TableHead className="text-xs">Total Outputs</TableHead>
                  <TableHead className="text-xs">AI Confirmed</TableHead>
                  <TableHead className="text-xs">Human Corrections</TableHead>
                  <TableHead className="text-xs">HCR %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(!hcrData || hcrData.length === 0) ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-xs text-fpp-gray-400 text-center py-6">No AI output or correction data yet</TableCell>
                  </TableRow>
                ) : (
                  hcrData.map((row) => {
                    const hcr = row.total > 0 ? Math.round((row.overrides / row.total) * 100) : 0;
                    const hcrColor = hcr < 10 ? "text-status-pass" : hcr < 20 ? "text-status-minor" : "text-status-critical";
                    return (
                      <TableRow key={row.cat}>
                        <TableCell className="text-xs font-medium">{row.cat}</TableCell>
                        <TableCell className="text-xs font-mono">{row.total}</TableCell>
                        <TableCell className="text-xs font-mono">{row.confirmed}</TableCell>
                        <TableCell className="text-xs font-mono">{row.overrides}</TableCell>
                        <TableCell className={`text-xs font-mono font-semibold ${hcrColor}`}>{hcr}%</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}