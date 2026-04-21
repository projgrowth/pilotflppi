import { useMemo } from "react";
import { useDeficienciesV2, type DeficiencyV2Row } from "@/hooks/useReviewDashboard";
import DeficiencyCard from "./DeficiencyCard";

interface Props {
  planReviewId: string;
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

function severityRank(d: DeficiencyV2Row) {
  if (d.life_safety_flag) return 0;
  if (d.permit_blocker) return 1;
  if (d.liability_flag) return 2;
  return 3 + (PRIORITY_RANK[d.priority] ?? 9);
}

// Within the same severity bucket, push items needing human eyes to the top,
// then sort by confidence DESC (high-conviction first).
function compareDefs(a: DeficiencyV2Row, b: DeficiencyV2Row) {
  const sev = severityRank(a) - severityRank(b);
  if (sev !== 0) return sev;
  const aHuman = a.requires_human_review ? 0 : 1;
  const bHuman = b.requires_human_review ? 0 : 1;
  if (aHuman !== bHuman) return aHuman - bHuman;
  const ac = a.confidence_score ?? 0;
  const bc = b.confidence_score ?? 0;
  return bc - ac;
}

export default function DeficiencyList({ planReviewId }: Props) {
  const { data: defs = [], isLoading } = useDeficienciesV2(planReviewId);

  const grouped = useMemo(() => {
    const m = new Map<string, DeficiencyV2Row[]>();
    for (const d of defs) {
      // Hide overturned items from the main list — they shouldn't reach contractor.
      if (d.verification_status === "overturned") continue;
      const arr = m.get(d.discipline) ?? [];
      arr.push(d);
      m.set(d.discipline, arr);
    }
    for (const arr of m.values()) arr.sort(compareDefs);
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [defs]);

  if (isLoading) {
    return <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">Loading deficiencies…</div>;
  }
  if (defs.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
        No deficiencies recorded yet for this review.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {grouped.map(([discipline, items]) => (
        <section key={discipline}>
          <h3 className="mb-2 text-sm font-semibold capitalize">
            {discipline.replace(/_/g, " ")}{" "}
            <span className="text-xs font-normal text-muted-foreground">({items.length})</span>
          </h3>
          <div className="space-y-3">
            {items.map((d) => (
              <DeficiencyCard key={d.id} planReviewId={planReviewId} def={d} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
