# Fix "Failed to create review" — grant EXECUTE on `user_firm_id`

## Root cause (confirmed in DB logs)

Every attempt to create a new plan review is failing with:

```
ERROR: permission denied for function user_firm_id
```

The helper function `public.user_firm_id(uuid)` is called by the RLS policies on `projects`, `plan_reviews`, and ~30 other firm-scoped tables. It exists and is `SECURITY DEFINER`, but EXECUTE was only granted to `postgres`, `service_role`, and `sandbox_exec` — **not to `authenticated`**. The sibling helper `has_role` was granted correctly; `user_firm_id` was missed.

Result: as soon as Postgres evaluates the RLS `WITH CHECK` on `INSERT INTO projects`, it can't call the function, the insert aborts, and the dialog shows "Failed to create review".

## Fix

One migration, no schema change:

```sql
GRANT EXECUTE ON FUNCTION public.user_firm_id(uuid) TO authenticated, anon;
```

That's it. No policy edits, no table changes, no app code changes.

## Why this is safe

- `user_firm_id` is `SECURITY DEFINER` and only returns the caller's own `firm_id` from `firm_members` — it does not expose anyone else's data.
- `has_role` is already granted to `authenticated` with the same pattern; this brings `user_firm_id` in line.
- All existing RLS rules continue to enforce firm scoping; we're only allowing the policy machinery to *call* its helper.

## Verification after apply

1. Open New Plan Review, drop a PDF, click **Start review** → review should be created and the workspace should open.
2. Re-run the DB error log query; the `permission denied for function user_firm_id` errors should stop.

## Files

- One new migration in `supabase/migrations/` containing the GRANT above. No client code changes.
