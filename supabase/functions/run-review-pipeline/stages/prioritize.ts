// Stage: prioritize.
// Promotes priority='high' on any active deficiency tagged life_safety_flag
// or permit_blocker that is still 'medium'. Render-time sort handles ordering.

import { createClient } from "../_shared/supabase.ts";

export async function stagePrioritize(
  admin: ReturnType<typeof createClient>,
  planReviewId: string,
) {
  const { data } = await admin
    .from("deficiencies_v2")
    .select("id, priority, life_safety_flag, permit_blocker")
    .eq("plan_review_id", planReviewId);

  if (!data) return { promoted: 0 };
  const promotions = data.filter(
    (d: { priority: string; life_safety_flag: boolean; permit_blocker: boolean }) =>
      (d.life_safety_flag || d.permit_blocker) && d.priority !== "high",
  );
  for (const p of promotions) {
    await admin
      .from("deficiencies_v2")
      .update({ priority: "high" })
      .eq("id", (p as { id: string }).id);
  }
  return { promoted: promotions.length };
}
