import { useState, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useProjects } from "@/hooks/useProjects";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import ConfidenceBar from "@/components/shared/ConfidenceBar";
import ReviewStagePipeline from "@/components/shared/ReviewStagePipeline";
import DaysActiveBadge from "@/components/shared/DaysActiveBadge";
import FppEmptyState from "@/components/shared/FppEmptyState";
import { Search, FolderOpen, Activity, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { useActivePipelineCount } from "@/hooks/useAllActivePipelines";

const stageMap: Record<string, "intake" | "ai_scan" | "under_review" | "comments_sent" | "resubmittal" | "approved"> = {
  intake: "intake",
  plan_review: "ai_scan",
  comments_sent: "comments_sent",
  resubmitted: "resubmittal",
  approved: "approved",
  permit_issued: "approved",
  inspection_scheduled: "approved",
  inspection_complete: "approved",
  certificate_issued: "approved",
  on_hold: "under_review",
  cancelled: "intake",
};

export default function Review() {
  const { data: projects, isLoading } = useProjects();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [countyFilter, setCountyFilter] = useState("all");
  const activePipelineCount = useActivePipelineCount();

  // Fetch latest plan_review id per project for direct linking
  const { data: latestReviews } = useQuery({
    queryKey: ["latest-plan-reviews"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_reviews")
        .select("id, project_id, round")
        .order("round", { ascending: false });
      if (error) throw error;
      // Keep only the latest round per project
      const map: Record<string, string> = {};
      for (const r of data || []) {
        if (!map[r.project_id]) map[r.project_id] = r.id;
      }
      return map;
    },
  });

  const counties = useMemo(() => {
    const set = new Set((projects || []).map((p) => p.county).filter(Boolean));
    return Array.from(set).sort();
  }, [projects]);

  const filtered = useMemo(() => {
    return (projects || []).filter((p) => {
      const q = search.toLowerCase();
      const matchSearch = !q || p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q) || p.county.toLowerCase().includes(q);
      const matchCounty = countyFilter === "all" || p.county === countyFilter;
      return matchSearch && matchCounty;
    });
  }, [projects, search, countyFilter]);

  const daysActive = (p: { created_at: string }) => Math.floor((Date.now() - new Date(p.created_at).getTime()) / 86400000);

  const handleProjectClick = (projectId: string) => {
    const reviewId = latestReviews?.[projectId];
    if (reviewId) {
      navigate(`/plan-review/${reviewId}`);
    } else {
      navigate(`/review/${projectId}`);
    }
  };

  return (
    <div className="p-8 md:p-10 max-w-7xl mx-auto">
      <PageHeader
        title="Plan Review"
        subtitle="Select a project to begin or continue a review"
        actions={
          <Button onClick={() => navigate("/projects?action=new")} size="sm">
            <Plus className="h-4 w-4 mr-1.5" />
            New Review
          </Button>
        }
      />

      {activePipelineCount > 0 && (
        <Link
          to="/pipelines"
          className="mb-4 inline-flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs text-primary hover:bg-primary/10 transition-colors"
        >
          <Activity className="h-3.5 w-3.5 animate-pulse" />
          {activePipelineCount} pipeline{activePipelineCount === 1 ? "" : "s"} running — view & cancel
        </Link>
      )}

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fpp-gray-400" />
          <Input placeholder="Search projects..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={countyFilter} onValueChange={setCountyFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All Counties" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Counties</SelectItem>
            {counties.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 rounded-md bg-muted animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="space-y-4">
          <FppEmptyState icon={FolderOpen} headline="No projects found" body="Upload a plan set to begin your first AI-assisted review." />
          <div className="flex justify-center">
            <Button onClick={() => navigate("/projects?action=new")}>
              <Plus className="h-4 w-4 mr-1.5" />
              Start a new review
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <Card
              key={p.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => handleProjectClick(p.id)}
            >
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{p.name}</h3>
                    <p className="text-xs text-fpp-gray-400 font-mono mt-0.5">{p.county} · {p.trade_type}</p>
                  </div>
                  <DaysActiveBadge days={daysActive(p)} />
                </div>
                <ReviewStagePipeline currentStage={stageMap[p.status] || "intake"} compact />
                <ConfidenceBar score={0} animated />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
