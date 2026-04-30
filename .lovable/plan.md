# Fix: "Site Data panel" toggle doesn't reveal the tab

## What's happening

When you flip the **Site Data panel** switch in **Settings → Firm Info → Beta features**, the row saves successfully (you saw the "external_data_v1 enabled" toast), but the **Site Data** entry never appears in the **More** dropdown of an open plan review. A full page reload would make it appear.

## Root cause

`BetaFeaturesCard` writes the new flag value directly with `supabase.from("firm_settings").update(...)` instead of going through the `useFirmSettings` mutation. After saving, it dispatches a `window` event (`firm-settings:refetch`) — but **no code is listening for that event**, so the React Query cache (`["firm-settings", user.id]`) is never invalidated.

Result: `useFeatureFlag("external_data_v1")` keeps reading the stale cached row where `feature_flags` is still `{}` (or missing), so `RightPanelTabs` never adds the Site Data item.

A second, smaller issue: the `FirmSettings` TypeScript interface in `useFirmSettings.ts` does not declare `feature_flags`, so any consumer that relies on the typed shape sees it as undefined even after the cache updates.

## The fix

Three small, surgical changes — no schema or pipeline impact.

1. **`src/components/settings/BetaFeaturesCard.tsx`**
   - Use `useQueryClient().invalidateQueries({ queryKey: ["firm-settings"] })` directly after a successful update, instead of dispatching the unused `firm-settings:refetch` window event.
   - This forces the cached firm settings (and therefore `useFeatureFlag`) to refresh immediately, so the Site Data tab appears the moment the switch flips on.

2. **`src/hooks/useFirmSettings.ts`**
   - Add `feature_flags?: Record<string, boolean> | null` to the `FirmSettings` interface so flag readers are properly typed (no more `as { feature_flags?: ... }` casts).
   - No runtime change — `select("*")` already returns the column.

3. **`src/hooks/useFeatureFlag.ts` & `src/components/settings/BetaFeaturesCard.tsx`**
   - Drop the now-unnecessary `as { feature_flags?: ... }` casts and read `firmSettings.feature_flags` directly via the typed field.

## Verification steps after the fix

1. Open **Settings → Firm Info**, flip **Site Data panel** off, save. Confirm the toggle persists (refresh — should remain off).
2. Open any plan review → **More** dropdown → confirm Site Data is **not** listed.
3. Go back to Settings, flip the toggle **on**. No reload.
4. Return to the plan review → click **More** → **Site Data** should now appear and open the panel.
5. Flip the toggle **off** again → Site Data disappears from More within a second (cache invalidation refetch).

## Out of scope

- No database changes (flag column already exists).
- No edge function changes.
- No changes to the FEMA/ASCE fetchers or `ExternalDataPanel` itself.

Approve and I'll apply the three edits.