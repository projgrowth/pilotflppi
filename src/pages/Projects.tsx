import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { DeadlineRing } from "@/components/DeadlineRing";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { NewReviewDialog } from "@/components/NewReviewDialog";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { useProjects, getDaysElapsed, getDaysRemaining, type Project } from "@/hooks/useProjects";
import { useAuth } from "@/contexts/AuthContext";
import { deleteProject } from "@/lib/delete-project";
import {
 Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Search, ChevronRight, FolderKanban, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

const filters = ["All", "Plan Review", "Inspection", "Pending", "Complete"] as const;

const FLORIDA_COUNTIES = [
 "miami-dade", "broward", "palm-beach", "hillsborough", "orange", "duval",
 "pinellas", "lee", "brevard", "volusia", "sarasota", "manatee", "collier",
 "polk", "seminole", "pasco", "osceola", "st-lucie", "escambia", "marion",
];

function relativeOrDash(iso: string | null | undefined): string {
 if (!iso) return "—";
 try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); } catch { return "—"; }
}

function fullDate(iso: string | null | undefined): string {
 if (!iso) return "";
 try { return new Date(iso).toLocaleString(); } catch { return ""; }
}


export default function Projects() {
 const [activeFilter, setActiveFilter] = useState<typeof filters[number]>("All");
 const [search, setSearch] = useState("");
 const [countyFilter, setCountyFilter] = useState("all");
 const [sortBy, setSortBy] = useState<"newest" | "deadline" | "activity">("activity");
 const { data: projects, isLoading } = useProjects();
 const navigate = useNavigate();
 const [searchParams, setSearchParams] = useSearchParams();
 const queryClient = useQueryClient();
 const { user } = useAuth();

 const [wizardOpen, setWizardOpen] = useState(false);
 const [pendingDelete, setPendingDelete] = useState<Project | null>(null);
 const [deleting, setDeleting] = useState(false);

 useEffect(() => {
 if (searchParams.get("action") === "new") {
 setWizardOpen(true);
 setSearchParams({}, { replace: true });
 }
 }, [searchParams, setSearchParams]);

 const filtered = (projects || []).filter((p) => {
 if (search) {
 const q = search.toLowerCase();
 if (!p.name.toLowerCase().includes(q) && !p.address.toLowerCase().includes(q)) return false;
 }
 if (countyFilter !== "all" && p.county !== countyFilter) return false;
 if (activeFilter === "All") return true;
 if (activeFilter === "Plan Review") return p.status === "plan_review" || p.status === "comments_sent" || p.status === "resubmitted";
 if (activeFilter === "Inspection") return p.status === "inspection_scheduled" || p.status === "inspection_complete";
 if (activeFilter === "Pending") return p.status === "intake" || p.status === "on_hold";
 if (activeFilter === "Complete") return p.status === "approved" || p.status === "certificate_issued" || p.status === "permit_issued";
 return true;
 }).sort((a, b) => {
 if (sortBy === "deadline") {
 const da = a.deadline_at ? new Date(a.deadline_at).getTime() : Infinity;
 const db = b.deadline_at ? new Date(b.deadline_at).getTime() : Infinity;
 return da - db;
 }
 if (sortBy === "activity") {
 const aa = a.last_activity_at ? new Date(a.last_activity_at).getTime() : 0;
 const bb = b.last_activity_at ? new Date(b.last_activity_at).getTime() : 0;
 return bb - aa;
 }
 return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
 });

 const handleConfirmDelete = async () => {
 if (!pendingDelete || !user) return;
 setDeleting(true);
 try {
 const res = await deleteProject(pendingDelete.id, user.id);
 toast.success(
 `Deleted "${pendingDelete.name}"` +
 (res.reviewsBlocked > 0 ? ` (${res.reviewsBlocked} review(s) preserved — letters were sent)` : ""),
 );
 await queryClient.invalidateQueries({ queryKey: ["projects"] });
 setPendingDelete(null);
 } catch (e) {
 toast.error(e instanceof Error ? e.message : "Could not delete project");
 } finally {
 setDeleting(false);
 }
 };

 return (
 <TooltipProvider delayDuration={300}>
 <div className="p-8 md:p-10 max-w-7xl">
 <PageHeader
 title="Projects"
 actions={
 <Button onClick={() => setWizardOpen(true)}>
 <Plus className="h-4 w-4 mr-2" /> New Project
 </Button>
 }
 />

 <div className="mb-5 flex flex-wrap items-center gap-4">
 <div className="filter-pills">
 {filters.map((f) => (
 <button
 key={f}
 onClick={() => setActiveFilter(f)}
 className={cn("filter-pill", activeFilter === f && "filter-pill-active")}
 >
 {f}
 </button>
 ))}
 </div>
 <Select value={countyFilter} onValueChange={setCountyFilter}>
 <SelectTrigger className="w-40 h-9 text-xs"><SelectValue placeholder="All Counties" /></SelectTrigger>
 <SelectContent>
 <SelectItem value="all">All Counties</SelectItem>
 {FLORIDA_COUNTIES.map((c) => (
 <SelectItem key={c} value={c}>{c.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
 <SelectTrigger className="w-44 h-9 text-xs"><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="activity">Last activity</SelectItem>
 <SelectItem value="newest">Newest first</SelectItem>
 <SelectItem value="deadline">Deadline soonest</SelectItem>
 </SelectContent>
 </Select>
 <div className="relative ml-auto">
 <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
 <Input placeholder="Search projects..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 w-64" />
 </div>
 </div>

 <Card className="shadow-subtle">
 {isLoading ? (
 <div className="divide-y">
 {Array.from({ length: 5 }).map((_, i) => (
 <div key={i} className="flex items-center gap-4 px-5 py-4">
 <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
 <div className="flex-1 space-y-2">
 <div className="h-4 w-48 rounded bg-muted animate-pulse" />
 <div className="h-3 w-64 rounded bg-muted animate-pulse" />
 </div>
 </div>
 ))}
 </div>
 ) : filtered.length === 0 ? (
 <EmptyState
 icon={FolderKanban}
 title="No projects found"
 description="Try adjusting your filters or search"
 />
 ) : (
 <div className="divide-y">
 {/* Column headers */}
 <div className="hidden md:grid grid-cols-[40px_1fr_100px_70px_90px_110px_70px_90px_28px_20px] gap-3 px-5 py-3 text-[11px] uppercase tracking-widest text-muted-foreground font-semibold border-b bg-muted/20">
 <span />
 <span>Project</span>
 <span>Contractor</span>
 <span>Trade</span>
 <span>Uploaded</span>
 <span>Last activity</span>
 <span>Status</span>
 <span>Deadline</span>
 <span />
 <span />
 </div>
 {filtered.map((project) => {
 const daysElapsed = getDaysElapsed(project.notice_filed_at);
 const remaining = getDaysRemaining(project.deadline_at);
 return (
 <div
 key={project.id}
 onClick={() => navigate(`/projects/${project.id}`)}
 className="group grid grid-cols-[40px_1fr_100px_70px_90px_110px_70px_90px_28px_20px] gap-3 items-center px-5 py-3 hover:bg-muted/40 cursor-pointer transition-colors"
 >
 <DeadlineRing daysElapsed={daysElapsed} size={40} />
 <div className="min-w-0">
 <p className="text-sm font-medium truncate">{project.name}</p>
 <p className="text-xs text-muted-foreground truncate">{project.address}</p>
 </div>
 <span className="hidden md:inline text-xs text-muted-foreground truncate">
 {project.contractor?.name || "—"}
 </span>
 <span className="hidden md:inline-flex rounded bg-muted px-2 py-0.5 text-[10px] font-medium capitalize justify-self-start">
 {project.trade_type}
 </span>
 <Tooltip>
 <TooltipTrigger asChild>
 <span className="hidden md:inline text-xs text-muted-foreground tabular-nums">
 {relativeOrDash(project.first_uploaded_at)}
 </span>
 </TooltipTrigger>
 {project.first_uploaded_at && (
 <TooltipContent side="top" className="text-xs">{fullDate(project.first_uploaded_at)}</TooltipContent>
 )}
 </Tooltip>
 <Tooltip>
 <TooltipTrigger asChild>
 <span className="hidden md:inline text-xs text-muted-foreground tabular-nums">
 {relativeOrDash(project.last_activity_at)}
 </span>
 </TooltipTrigger>
 {project.last_activity_at && (
 <TooltipContent side="top" className="text-xs">{fullDate(project.last_activity_at)}</TooltipContent>
 )}
 </Tooltip>
 <StatusChip status={project.status} />
 <span className={cn(
 "font-mono text-xs whitespace-nowrap text-right",
 remaining <= 0 ? "text-destructive" : remaining <= 3 ? "text-destructive" : remaining <= 6 ? "text-warning" : "text-muted-foreground"
 )}>
 {remaining <= 0 ? "Overdue" : `${remaining}d left`}
 </span>
 <Tooltip>
 <TooltipTrigger asChild>
 <button
 type="button"
 onClick={(e) => { e.stopPropagation(); setPendingDelete(project); }}
 className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
 aria-label={`Delete ${project.name}`}
 >
 <Trash2 className="h-3.5 w-3.5" />
 </button>
 </TooltipTrigger>
 <TooltipContent side="top" className="text-xs">Delete project</TooltipContent>
 </Tooltip>
 <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
 </div>
 );
 })}
 </div>
 )}
 </Card>

 <NewReviewDialog
 open={wizardOpen}
 onOpenChange={setWizardOpen}
 />

 <DeleteConfirmDialog
 open={!!pendingDelete}
 onOpenChange={(o) => !o && setPendingDelete(null)}
 resourceLabel="project"
 expectedConfirmText={pendingDelete?.name ?? ""}
 title="Delete this project?"
 description="This soft-deletes the project and every associated plan review, file, and finding. Storage objects (PDFs, rendered pages) are removed permanently. Issued certificates of compliance block deletion."
 cascadeItems={[
 "All plan reviews for this project will be hidden",
 "Uploaded PDFs and rendered page images will be removed from storage",
 "Findings will be archived as 'waived'",
 "Reviews with a sent letter are preserved as a legal record",
 ]}
 loading={deleting}
 onConfirm={handleConfirmDelete}
 />
 </div>
 </TooltipProvider>
 );
}
