import { useState } from "react";
import { useFilteredDeficiencies } from "@/hooks/useFilteredDeficiencies";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import DeficiencyCard from "./DeficiencyCard";

interface Props {
  planReviewId: string;
}

export default function DeficiencyList({ planReviewId }: Props) {
  const [showSuperseded, setShowSuperseded] = useState(false);
  const { isLoading, grouped, counts } = useFilteredDeficiencies(planReviewId, {
    hideOverturned: true,
    showSuperseded,
    groupBy: "discipline",
  });

  if (isLoading) {
    return <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">Loading deficiencies…</div>;
  }
  if (counts.total === 0) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
        No deficiencies recorded yet for this review.
      </div>
    );
  }

  const supersededCount = counts.total - counts.visible;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
        <div className="text-xs text-muted-foreground">
          {counts.visible} live finding{counts.visible === 1 ? "" : "s"}
          {supersededCount > 0 && !showSuperseded && (
            <span className="ml-2">· {supersededCount} hidden (superseded/overturned)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="show-superseded"
            checked={showSuperseded}
            onCheckedChange={setShowSuperseded}
          />
          <Label htmlFor="show-superseded" className="cursor-pointer text-xs">
            Show superseded
          </Label>
        </div>
      </div>

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
