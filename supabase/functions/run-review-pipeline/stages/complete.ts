// Stage: complete.
// Marks the review complete, snapshots the current sheet_map into
// checklist_state.last_sheet_map so the NEXT round's discipline_review can
// diff against it and skip unchanged sheets.

import { createClient } from "../_shared/supabase.ts";

export async function stageComplete(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
) {
  const { data: sheetRows } = await admin
    .from("sheet_coverage")
    .select("sheet_ref, page_index, discipline")
    .eq("plan_review_id", planReviewId);
  const snapshot = (sheetRows ?? []) as Array<{
    sheet_ref: string;
    page_index: number | null;
    discipline: string | null;
  }>;

  const { data: existing } = await admin
    .from("plan_reviews")
    .select("checklist_state")
    .eq("id", planReviewId)
    .maybeSingle();
  const prevState = ((existing?.checklist_state ?? {}) as Record<string, unknown>) ?? {};

  await admin
    .from("plan_reviews")
    .update({
      ai_check_status: "complete",
      pipeline_version: "v2",
      checklist_state: {
        ...prevState,
        last_sheet_map: snapshot,
        last_sheet_map_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", planReviewId);
  return { ok: true, snapshot_size: snapshot.length };
}
