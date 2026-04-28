/**
 * OnboardingChecklist — first-run "Get Started" panel for the Dashboard.
 *
 * Derives completion state from existing data — no new schema. Hidden once
 * all four steps pass OR the user dismisses (per-user localStorage).
 */
import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, Circle, X, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useFirmSettings } from "@/hooks/useFirmSettings";
import { useProjects } from "@/hooks/useProjects";
import { cn } from "@/lib/utils";

interface Step {
  id: string;
  title: string;
  done: boolean;
  cta: string;
  onAction: () => void;
}

export function OnboardingChecklist() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { firmSettings, isLoading: firmLoading } = useFirmSettings();
  const { data: projects, isLoading: projectsLoading } = useProjects();

  // Reviewer license rows are stored in the dedicated table created in Phase A.
  const { data: licenseCount } = useQuery({
    queryKey: ["onboarding-license-count", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { count } = await supabase
        .from("reviewer_licenses")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id);
      return count ?? 0;
    },
  });

  // "Pipeline ever completed" = at least one comment letter snapshot exists.
  const { data: hasCompletedReview } = useQuery({
    queryKey: ["onboarding-completed-review"],
    queryFn: async () => {
      const { data } = await supabase
        .from("comment_letter_snapshots")
        .select("id")
        .limit(1);
      return (data?.length ?? 0) > 0;
    },
  });

  const dismissKey = user ? `onboarding-dismissed:${user.id}` : null;
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!dismissKey) return;
    setDismissed(localStorage.getItem(dismissKey) === "1");
  }, [dismissKey]);

  const steps: Step[] = useMemo(() => {
    const firmDone =
      !!firmSettings &&
      !!firmSettings.firm_name?.trim() &&
      !!firmSettings.license_number?.trim() &&
      !!firmSettings.eo_carrier?.trim();

    const licDone = (licenseCount ?? 0) > 0;
    const projectDone = (projects ?? []).length > 0;
    const reviewDone = !!hasCompletedReview;

    return [
      {
        id: "firm",
        title: "Complete firm settings (name, license, E&O insurance)",
        done: firmDone,
        cta: firmDone ? "Edit" : "Set up",
        onAction: () => navigate("/settings"),
      },
      {
        id: "licenses",
        title: "Add at least one professional license to your profile",
        done: licDone,
        cta: licDone ? "Manage" : "Add license",
        onAction: () => navigate("/settings"),
      },
      {
        id: "project",
        title: "Create your first project",
        done: projectDone,
        cta: projectDone ? "Open projects" : "New project",
        onAction: () => navigate("/projects?action=new"),
      },
      {
        id: "review",
        title: "Run an AI plan review and send the comment letter",
        done: reviewDone,
        cta: reviewDone ? "View letters" : "Open projects",
        onAction: () => navigate("/projects"),
      },
    ];
  }, [firmSettings, licenseCount, projects, hasCompletedReview, navigate]);

  const completed = steps.filter((s) => s.done).length;
  const total = steps.length;
  const allDone = completed === total;

  if (firmLoading || projectsLoading) return null;
  if (allDone) return null;
  if (dismissed) return null;

  return (
    <Card className="shadow-subtle border-accent/30 bg-accent/5">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <CardTitle className="text-base">Get started</CardTitle>
            <p className="text-xs text-muted-foreground">
              Finish these {total} steps to unlock comment-letter delivery.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {completed} / {total}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="Dismiss onboarding"
              onClick={() => {
                if (dismissKey) localStorage.setItem(dismissKey, "1");
                setDismissed(true);
              }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5 pt-0">
        {steps.map((s) => (
          <div
            key={s.id}
            className={cn(
              "flex items-center gap-3 rounded-md border px-3 py-2 transition-colors",
              s.done
                ? "border-accent/30 bg-card/40"
                : "border-border bg-card hover:bg-muted/40",
            )}
          >
            {s.done ? (
              <Check className="h-4 w-4 shrink-0 text-accent" />
            ) : (
              <Circle className="h-4 w-4 shrink-0 text-muted-foreground/50" />
            )}
            <span
              className={cn(
                "flex-1 text-sm",
                s.done ? "text-muted-foreground line-through" : "text-foreground",
              )}
            >
              {s.title}
            </span>
            {!s.done && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs shrink-0"
                onClick={s.onAction}
              >
                {s.cta}
                <ChevronRight className="ml-0.5 h-3 w-3" />
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
