

# Fix: "cannot add postgres_changes after subscribe" realtime error

## Root cause

`useDeficienciesV2(reviewId)` is called from **six** components on the Review Dashboard at once (`ReviewDashboard`, `LetterQualityGate`, `DedupeAuditTrail`, `ReviewSummaryHeader`, `ReviewHealthStrip`, `useFilteredDeficiencies → DeficiencyList`). Each call runs a `useEffect` that creates a Supabase channel named `deficiencies-${reviewId}`.

Supabase Realtime requires unique channel topic names per client. The second hook to mount tries to attach `.on("postgres_changes", ...)` to a topic that's already in the `joined` state, which throws:

> cannot add `postgres_changes` callbacks for `realtime:deficiencies-…` after `subscribe()`.

The same bug exists for:
- `pipeline-${reviewId}` (`usePipelineStatus`, called from ≥2 places)
- A redundant `plan-review-detail-defs-${reviewId}` channel in `usePlanReviewData.ts` that duplicates `deficiencies-${reviewId}`

## Fix: module-level channel registry, one channel per topic

Add a tiny ref-counted registry in `useReviewDashboard.ts` so all consumers share **one** channel per `(table, planReviewId)` pair.

```ts
// At module scope in useReviewDashboard.ts
type Sub = { channel: RealtimeChannel; refCount: number; listeners: Set<() => void> };
const subs = new Map<string, Sub>();

function subscribeShared(key: string, table: string, filter: string, onChange: () => void) {
  let entry = subs.get(key);
  if (!entry) {
    const channel = supabase
      .channel(key)
      .on("postgres_changes", { event: "*", schema: "public", table, filter },
          () => entry!.listeners.forEach((fn) => fn()))
      .subscribe();
    entry = { channel, refCount: 0, listeners: new Set() };
    subs.set(key, entry);
  }
  entry.listeners.add(onChange);
  entry.refCount += 1;
  return () => {
    entry!.listeners.delete(onChange);
    entry!.refCount -= 1;
    if (entry!.refCount === 0) {
      supabase.removeChannel(entry!.channel);
      subs.delete(key);
    }
  };
}
```

Then rewrite the three `useEffect` blocks to call `subscribeShared(...)` instead of building a channel inline:
- `useDeficienciesV2` → `subscribeShared(\`deficiencies-${planReviewId}\`, "deficiencies_v2", \`plan_review_id=eq.${planReviewId}\`, invalidate)`
- `usePipelineStatus` → `subscribeShared(\`pipeline-${planReviewId}\`, "review_pipeline_status", \`plan_review_id=eq.${planReviewId}\`, invalidate)`
- `useDeferredScope` → `subscribeShared(\`deferred-scope-${planReviewId}\`, "deferred_scope_items", \`plan_review_id=eq.${planReviewId}\`, invalidate)`

## Cleanup: remove the redundant channel in `usePlanReviewData.ts`

`plan-review-detail-defs-${review.id}` watches the same rows as `deficiencies-${review.id}` and only invalidates a different query key. Replace its `useEffect` with the shared subscriber, passing a callback that invalidates `["v2-findings-for-viewer", review.id]`.

(Optional, but it eliminates a second WebSocket topic per detail view.)

## What the user sees

- Console error disappears.
- Realtime invalidations still fire — every consumer of `useDeficienciesV2` re-renders when the pipeline writes a new finding (one channel, fanned out to N React Query invalidations).
- Fewer WebSocket topics open per page (1 instead of 6 for deficiencies).
- React 18 StrictMode double-mount in dev no longer trips the same error.

## Files

**Modified**
- `src/hooks/useReviewDashboard.ts` (add registry + rewrite 3 useEffects)
- `src/hooks/plan-review/usePlanReviewData.ts` (use shared subscriber for findings refetch)

No DB migration needed — `deficiencies_v2`, `review_pipeline_status`, and `deferred_scope_items` are already in the `supabase_realtime` publication (verified).

