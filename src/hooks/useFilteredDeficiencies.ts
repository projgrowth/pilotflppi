import { useMemo } from "react";
import {
  useDeficienciesV2,
  type DeficiencyV2Row,
} from "@/hooks/useReviewDashboard";

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function severityRank(d: DeficiencyV2Row): number {
  if (d.life_safety_flag) return 0;
  if (d.permit_blocker) return 1;
  if (d.liability_flag) return 2;
  return 3 + (PRIORITY_RANK[d.priority] ?? 9);
}

// Within the same severity bucket, push items needing human eyes to the top,
// then sort by confidence DESC (high-conviction first).
export function compareDefs(a: DeficiencyV2Row, b: DeficiencyV2Row): number {
  const sev = severityRank(a) - severityRank(b);
  if (sev !== 0) return sev;
  const aHuman = a.requires_human_review ? 0 : 1;
  const bHuman = b.requires_human_review ? 0 : 1;
  if (aHuman !== bHuman) return aHuman - bHuman;
  const ac = a.confidence_score ?? 0;
  const bc = b.confidence_score ?? 0;
  return bc - ac;
}

export interface FilterOptions {
  hideOverturned?: boolean;
  showSuperseded?: boolean;
  onlyHumanReview?: boolean;
  groupBy?: "discipline" | "none";
}

export interface FilteredDeficiencies {
  isLoading: boolean;
  items: DeficiencyV2Row[];
  grouped: Array<[string, DeficiencyV2Row[]]>;
  counts: {
    total: number;
    visible: number;
    hidden: number;
    humanReview: number;
  };
}

/**
 * Shared filter+sort+group pipeline for the deficiency list and human-review queue.
 * Centralised so the two views can never drift apart.
 */
export function useFilteredDeficiencies(
  planReviewId: string | undefined,
  opts: FilterOptions = {},
): FilteredDeficiencies {
  const {
    hideOverturned = true,
    showSuperseded = false,
    onlyHumanReview = false,
    groupBy = "discipline",
  } = opts;
  const { data: defs = [], isLoading } = useDeficienciesV2(planReviewId);

  return useMemo(() => {
    const all = defs;
    let visible = all;
    if (hideOverturned) {
      visible = visible.filter((d) => d.verification_status !== "overturned");
    }
    if (!showSuperseded) {
      visible = visible.filter((d) => d.verification_status !== "superseded");
    }
    if (onlyHumanReview) {
      visible = visible.filter((d) => d.requires_human_review);
    }
    const sorted = [...visible].sort(compareDefs);

    let grouped: Array<[string, DeficiencyV2Row[]]>;
    if (groupBy === "discipline") {
      const m = new Map<string, DeficiencyV2Row[]>();
      for (const d of sorted) {
        const arr = m.get(d.discipline) ?? [];
        arr.push(d);
        m.set(d.discipline, arr);
      }
      grouped = Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
    } else {
      grouped = [["all", sorted]];
    }

    return {
      isLoading,
      items: sorted,
      grouped,
      counts: {
        total: all.length,
        visible: sorted.length,
        hidden: all.length - visible.length,
        humanReview: all.filter((d) => d.requires_human_review).length,
      },
    };
  }, [defs, hideOverturned, showSuperseded, onlyHumanReview, groupBy, isLoading]);
}
