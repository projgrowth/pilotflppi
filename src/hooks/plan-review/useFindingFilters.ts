/**
 * Four-axis filter + grouping logic for the findings list panel.
 *
 * Inputs: the raw findings array + the per-finding status map.
 * Outputs: filtered subset, grouped-by-discipline maps, counts per axis,
 * a stable global-index map (so JSX can render grouped lists while keeping
 * a single linear index for selection / keyboard nav), plus bulk-resolve
 * helpers scoped to whatever subset is currently visible.
 */
import { useMemo } from "react";
import { DISCIPLINE_ORDER } from "@/lib/county-utils";
import type { Finding } from "@/components/FindingCard";
import type { FindingStatus } from "@/components/FindingStatusFilter";
import type { ConfidenceFilter, QualityFilter } from "@/components/BulkTriageFilters";

export interface FindingFilterState {
  status: FindingStatus | "all";
  confidence: ConfidenceFilter;
  discipline: string | "all";
  sheet: string | "all";
  /** Optional Quality filter — surfaces AI verifier / citation issues. */
  quality?: QualityFilter;
}

function groupFindingsByDiscipline(findings: Finding[]): Record<string, Finding[]> {
  const groups: Record<string, Finding[]> = {};
  for (const f of findings) {
    const d = f.discipline || "structural";
    if (!groups[d]) groups[d] = [];
    groups[d].push(f);
  }
  return groups;
}

export function useFindingFilters(
  findings: Finding[],
  findingStatuses: Record<string, FindingStatus>,
  filters: FindingFilterState,
) {
  return useMemo(() => {
    const grouped = groupFindingsByDiscipline(findings);
    // Status lookup keys off finding_id (UUID). Findings without an id are
    // treated as "open" — they can't have a stored status anyway.
    const statusOf = (f: Finding) => (f.finding_id ? findingStatuses[f.finding_id] || "open" : "open");

    const isUnverified = (f: Finding) =>
      !f.verification_status || f.verification_status === "unverified";
    const isHallucinated = (f: Finding) => f.citation_status === "hallucinated";

    const filtered = findings.filter((f) => {
      if (filters.status !== "all" && statusOf(f) !== filters.status) return false;
      if (filters.confidence !== "all" && (f.confidence || "low") !== filters.confidence) return false;
      if (filters.discipline !== "all" && (f.discipline || "structural") !== filters.discipline) return false;
      if (filters.sheet !== "all" && (f.page || "Unknown").trim() !== filters.sheet) return false;
      if (filters.quality === "unverified" && !isUnverified(f)) return false;
      if (filters.quality === "hallucinated" && !isHallucinated(f)) return false;
      return true;
    });
    const filteredGrouped = groupFindingsByDiscipline(filtered);

    const qualityCounts: Record<QualityFilter, number> = {
      all: findings.length,
      unverified: findings.filter(isUnverified).length,
      hallucinated: findings.filter(isHallucinated).length,
    };

    const confidenceCounts: Record<ConfidenceFilter, number> = {
      all: findings.length,
      high: findings.filter((f) => (f.confidence || "low") === "high").length,
      medium: findings.filter((f) => (f.confidence || "low") === "medium").length,
      low: findings.filter((f) => (f.confidence || "low") === "low").length,
    };

    const disciplinesPresent = Array.from(new Set(findings.map((f) => f.discipline || "structural"))).sort(
      (a, b) =>
        DISCIPLINE_ORDER.indexOf(a as (typeof DISCIPLINE_ORDER)[number]) -
        DISCIPLINE_ORDER.indexOf(b as (typeof DISCIPLINE_ORDER)[number]),
    );
    const sheetsPresent = Array.from(new Set(findings.map((f) => (f.page || "Unknown").trim()))).sort();

    const visibleIndices = findings.reduce<number[]>((acc, f, i) => {
      if (filtered.includes(f)) acc.push(i);
      return acc;
    }, []);
    const allVisibleResolved =
      visibleIndices.length > 0 && visibleIndices.every((i) => statusOf(findings[i]) === "resolved");

    const criticalCount = findings.filter((f) => f.severity === "critical").length;
    const majorCount = findings.filter((f) => f.severity === "major").length;
    const minorCount = findings.filter((f) => f.severity === "minor").length;
    const openCount = findings.filter((f) => statusOf(f) === "open").length;
    const resolvedCount = findings.filter((f) => statusOf(f) === "resolved").length;
    const deferredCount = findings.filter((f) => statusOf(f) === "deferred").length;

    // Stable global index across grouped accordion sections so keyboard nav
    // and selection always reference one canonical index.
    let counter = 0;
    const globalIndexMap = new Map<Finding, number>();
    for (const d of DISCIPLINE_ORDER) {
      if (!grouped[d]) continue;
      for (const f of grouped[d]) {
        globalIndexMap.set(f, counter++);
      }
    }

    return {
      grouped,
      filtered,
      filteredGrouped,
      confidenceCounts,
      disciplinesPresent,
      sheetsPresent,
      visibleIndices,
      allVisibleResolved,
      criticalCount,
      majorCount,
      minorCount,
      openCount,
      resolvedCount,
      deferredCount,
      globalIndexMap,
    };
  }, [findings, findingStatuses, filters.status, filters.confidence, filters.discipline, filters.sheet]);
}

/**
 * Round-over-round diff bookkeeping. Returned shape mirrors what the round
 * banner renders: per-finding "new"/"carried" classification + roll-up
 * counts. Empty when this is round 1 or there's no prior snapshot.
 */
export function useRoundDiff(findings: Finding[], previousFindings: Finding[], round: number) {
  return useMemo(() => {
    const diffMap = new Map<number, "new" | "carried">();
    let newCount = 0;
    let persistedCount = 0;
    let newlyResolvedCount = 0;
    const hasRoundDiff = round > 1 && previousFindings.length > 0;

    if (hasRoundDiff) {
      const findingKey = (f: Finding) => `${(f.code_ref || "").trim().toLowerCase()}|${(f.page || "").trim().toLowerCase()}`;
      const prevKeys = new Set(previousFindings.map(findingKey));
      const currKeys = new Set(findings.map(findingKey));
      for (let i = 0; i < findings.length; i++) {
        const k = findingKey(findings[i]);
        if (prevKeys.has(k)) {
          diffMap.set(i, "carried");
          persistedCount++;
        } else {
          diffMap.set(i, "new");
          newCount++;
        }
      }
      for (const pk of prevKeys) {
        if (!currKeys.has(pk)) newlyResolvedCount++;
      }
    }

    return { diffMap, newCount, persistedCount, newlyResolvedCount, hasRoundDiff };
  }, [findings, previousFindings, round]);
}
