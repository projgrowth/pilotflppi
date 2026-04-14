import { useMemo } from "react";
import { useProjects } from "@/hooks/useProjects";
import { useReviewFlagCounts } from "@/hooks/useReviewData";
import { useAILearningStats } from "@/hooks/useAILearningStats";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, Legend, CartesianGrid } from "recharts";
import { useState } from "react";

const COLORS = ["#0E7C7B", "#C8972A", "#1A3250", "#2E7D52", "#5B8DB8", "#D4A017"];

// Mock chart data
const volumeData = [
  { month: "Jan", completed: 12, started: 15 },
  { month: "Feb", completed: 14, started: 18 },
  { month: "Mar", completed: 10, started: 12 },
  { month: "Apr", completed: 16, started: 20 },
  { month: "May", completed: 18, started: 22 },
  { month: "Jun", completed: 15, started: 17 },
];

const commonFlags = [
  { name: "Hurricane Straps", count: 24, severity: "critical" },
  { name: "Wind-Borne Debris", count: 19, severity: "critical" },
  { name: "FL Product Approval", count: 17, severity: "major" },
  { name: "Egress Windows", count: 14, severity: "critical" },
  { name: "Energy Form 405", count: 12, severity: "major" },
  { name: "HVAC Manual J", count: 10, severity: "major" },
  { name: "Sealed Drawings", count: 9, severity: "major" },
  { name: "Smoke Detectors", count: 8, severity: "critical" },
];

const accuracyData = [
  { week: "W1", rate: 78 }, { week: "W2", rate: 80 }, { week: "W3", rate: 82 },
  { week: "W4", rate: 81 }, { week: "W5", rate: 85 }, { week: "W6", rate: 87 },
  { week: "W7", rate: 86 }, { week: "W8", rate: 89 },
];

const severityBarColor: Record<string, string> = {
  critical: "#D63230", major: "#E8831A", minor: "#D4A017",
};

export default function Analytics() {
  const { data: projects } = useProjects();
  const { data: flagCounts } = useReviewFlagCounts();
  const { data: aiStats } = useAILearningStats();
  const [range, setRange] = useState("30");

  const jurisdictionData = useMemo(() => {
    const map: Record<string, number> = {};
    (projects || []).forEach((p) => { map[p.county] = (map[p.county] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [projects]);

  const projectCount = projects?.length || 0;
  const avgDays = useMemo(() => {
    const approved = (projects || []).filter(p => p.status === "approved" || p.status === "certificate_issued");
    if (approved.length === 0) return 0;
    const total = approved.reduce((s, p) => s + Math.floor((Date.now() - new Date(p.created_at).getTime()) / 86400000), 0);
    return Math.round(total / approved.length);
  }, [projects]);

  return (
    <div className="page-enter space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl text-foreground">Analytics</h1>
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Reviews This Month", value: projectCount },
          { label: "Avg. Turnaround", value: `${avgDays}d` },
          { label: "Flags Per Review", value: flagCounts ? Math.round(flagCounts.total / Math.max(projectCount, 1)) : 0 },
          { label: "AI Accuracy Rate", value: aiStats ? `${Math.round((1 - aiStats.hcr) * 100)}%` : "—" },
        ].map((kpi) => (
          <Card key={kpi.label} className="shadow-subtle">
            <CardContent className="p-5">
              <p className="text-[10px] uppercase tracking-wider text-fpp-gray-400 font-mono">{kpi.label}</p>
              <p className="font-display text-3xl text-foreground mt-1">{kpi.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <Card className="shadow-subtle">
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold mb-4">Review Volume</h3>
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
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="shadow-subtle">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-4">Most Common Flags</h3>
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
          </CardContent>
        </Card>

        <Card className="shadow-subtle">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-1">AI Accuracy Trend</h3>
            <p className="text-[10px] text-fpp-gray-400 mb-4">% of AI flags confirmed by human reviewers — rising = AI improving</p>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={accuracyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--fpp-gray-100))" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis domain={[60, 100]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="rate" stroke="#0E7C7B" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="shadow-subtle">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-4">Reviews by Jurisdiction</h3>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={jurisdictionData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                  {jurisdictionData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="shadow-subtle">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-1">Review Pipeline Funnel</h3>
            <p className="text-[10px] text-fpp-gray-400 mb-4">Narrow bars show where projects are getting stuck</p>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={[
                { stage: "Intake", count: 25 },
                { stage: "AI Scan", count: 22 },
                { stage: "Review", count: 18 },
                { stage: "Comments", count: 14 },
                { stage: "Resubmit", count: 8 },
                { stage: "Approved", count: 5 },
              ]}>
                <XAxis dataKey="stage" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#0E7C7B" opacity={0.8} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* HCR Table */}
      <Card className="shadow-subtle">
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold">AI Learning Metrics</h3>
          <p className="text-[10px] text-fpp-gray-400 mb-4">Human correction rate by flag category. Lower HCR = AI is improving in that category.</p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Flag Category</TableHead>
                  <TableHead className="text-xs">Total Flags</TableHead>
                  <TableHead className="text-xs">AI Confirmed</TableHead>
                  <TableHead className="text-xs">Human Overrides</TableHead>
                  <TableHead className="text-xs">HCR %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  { cat: "Hurricane Straps", total: 24, confirmed: 22, overrides: 2 },
                  { cat: "Wind-Borne Debris", total: 19, confirmed: 17, overrides: 2 },
                  { cat: "Egress Windows", total: 14, confirmed: 11, overrides: 3 },
                  { cat: "Energy Compliance", total: 12, confirmed: 11, overrides: 1 },
                  { cat: "HVAC Sizing", total: 10, confirmed: 7, overrides: 3 },
                ].map((row) => {
                  const hcr = Math.round((row.overrides / row.total) * 100);
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
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
