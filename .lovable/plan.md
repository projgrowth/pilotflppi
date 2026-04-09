

# Fix: "Cannot read properties of undefined (reading 'includes')"

## Root Cause

The error occurs in `src/pages/PlanReviewDetail.tsx` at line 290:
```typescript
const filePath = storedPath.includes('/storage/v1/')
```

When `r.file_urls` is an array that contains `null` or `undefined` entries (from database JSON), `storedPath` is undefined and `.includes()` fails.

A secondary risk exists in `src/components/ZoningAnalysisPanel.tsx` line 70 where `prev.occupancy_groups.includes(code)` could fail if state is somehow set without the `occupancy_groups` array.

## Fix

### `src/pages/PlanReviewDetail.tsx` (line ~288-292)
Add a guard for `storedPath`:
```typescript
const storedPath = r.file_urls[fi];
if (!storedPath) continue; // skip null/undefined entries
const filePath = storedPath.includes('/storage/v1/')
  ...
```

### `src/components/ZoningAnalysisPanel.tsx` (line ~70)
Add defensive guard:
```typescript
const groups = (prev.occupancy_groups ?? []).includes(code)
  ? (prev.occupancy_groups ?? []).filter((g) => g !== code)
  : [...(prev.occupancy_groups ?? []), code];
```

### `src/pages/Documents.tsx` (line 140)
Remove orphaned `<input>` tag left from the previous edit (line 140 has a duplicate file input outside any label).

| File | Change |
|------|--------|
| `src/pages/PlanReviewDetail.tsx` | Guard `storedPath` against null/undefined |
| `src/components/ZoningAnalysisPanel.tsx` | Guard `occupancy_groups` in `toggleOccupancy` |
| `src/pages/Documents.tsx` | Remove orphaned duplicate `<input>` tag |

