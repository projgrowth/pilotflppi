import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
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
import { Search, FolderOpen } from "lucide-react";

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
    <div className="page-enter space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-foreground">Plan Review</h1>
        <p className="text-sm text-fpp-gray-600 mt-1">Select a project to begin or continue a review</p>
      </div>

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
        <FppEmptyState icon={FolderOpen} headline="No projects found" body="Upload a plan set to begin your first AI-assisted review." />
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
