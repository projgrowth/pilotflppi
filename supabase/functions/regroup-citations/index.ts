// Re-runs the citation grounding (and optionally verification) stages for an
// existing plan_review. Supports two modes:
//   1. Whole-review reground (admin-only) — resets every live row's
//      verification_status and runs ground + verify across the entire review.
//   2. Single-finding reground (firm-member) — resets a single deficiency_v2
//      row (must belong to the caller's firm) and runs ground-citations only.
// Edge functions are bundled independently so we cannot import stage modules
// from the run-review-pipeline folder; we invoke the pipeline function over
// HTTP to perform the actual ground+verify work.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const planReviewId: string | undefined = body?.plan_review_id;
    const deficiencyId: string | undefined = body?.deficiency_id;
    const skipVerify = body?.skip_verify === true || !!deficiencyId;

    if (!planReviewId || typeof planReviewId !== "string") {
      return json({ error: "plan_review_id required" }, 400);
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } =
      await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return json({ error: "Unauthorized" }, 401);
    }
    const userId = claimsData.claims.sub as string;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (deficiencyId) {
      // Single-finding mode — must be a firm member who owns the row.
      const { data: defRow, error: defErr } = await userClient
        .from("deficiencies_v2")
        .select("id, plan_review_id, status, verification_status")
        .eq("id", deficiencyId)
        .maybeSingle();
      if (defErr || !defRow) {
        return json({ error: "Finding not found or no access" }, 404);
      }
      if (defRow.plan_review_id !== planReviewId) {
        return json({ error: "Finding does not belong to plan review" }, 400);
      }

      await admin
        .from("deficiencies_v2")
        .update({
          citation_status: "unverified",
          citation_match_score: null,
          citation_canonical_text: null,
          citation_grounded_at: null,
        })
        .eq("id", deficiencyId);

      // eslint-disable-next-line no-console
      console.log(
        `[regroup-citations] single-finding review=${planReviewId} def=${deficiencyId} by=${userId}`,
      );
    } else {
      // Whole-review mode is admin-only.
      const { data: isAdmin } = await admin.rpc("has_role", {
        _user_id: userId,
        _role: "admin",
      });
      if (!isAdmin) {
        return json({ error: "Admin role required" }, 403);
      }

      // eslint-disable-next-line no-console
      console.log(
        `[regroup-citations] whole-review review=${planReviewId} by=${userId}`,
      );

      if (!skipVerify) {
        await admin
          .from("deficiencies_v2")
          .update({ verification_status: "unverified" })
          .eq("plan_review_id", planReviewId)
          .neq("status", "resolved")
          .neq("status", "waived")
          .neq("verification_status", "overturned")
          .neq("verification_status", "superseded");
      }
    }

    const stages = skipVerify
      ? ["ground-citations"]
      : ["ground-citations", "verify"];
    const pipelineResp = await fetch(
      `${SUPABASE_URL}/functions/v1/run-review-pipeline`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          plan_review_id: planReviewId,
          stages,
          resume: true,
        }),
      },
    );
    const pipelinePayload = await pipelineResp.json().catch(() => ({}));
    if (!pipelineResp.ok) {
      return json(
        { error: "Pipeline call failed", details: pipelinePayload },
        502,
      );
    }

    await admin.from("activity_log").insert({
      event_type: deficiencyId
        ? "citation_regrounded_single"
        : "citations_regrounded",
      description: deficiencyId
        ? `Re-grounded one finding's citation (def ${deficiencyId.slice(0, 8)}…).`
        : `Re-grounded citations and re-ran verification for review ${planReviewId}.`,
      project_id: null,
      actor_id: userId,
      actor_type: deficiencyId ? "user" : "admin",
      metadata: {
        plan_review_id: planReviewId,
        deficiency_id: deficiencyId ?? null,
        stages,
        pipeline: pipelinePayload,
      },
    });

    return json({ ok: true, stages, pipeline: pipelinePayload });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[regroup-citations] error", err);
    return json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500,
    );
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
