// Re-runs the citation grounding + verification stages for an existing
// plan_review. Edge functions are bundled independently so we cannot import
// stage modules from the run-review-pipeline folder; instead we reset stale
// verification rows here and invoke the pipeline function over HTTP to
// perform the actual ground+verify work.

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
    const planReviewId = body?.plan_review_id;
    const skipVerify = body?.skip_verify === true;

    if (!planReviewId || typeof planReviewId !== "string") {
      return json({ error: "plan_review_id required" }, 400);
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return json({ error: "Unauthorized" }, 401);
    }
    const userId = claimsData.claims.sub as string;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Admin-only — has_role(uid, 'admin').
    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) {
      return json({ error: "Admin role required" }, 403);
    }

    // eslint-disable-next-line no-console
    console.log(`[regroup-citations] start review=${planReviewId} by=${userId}`);

    // Reset all non-resolved/non-waived rows back to unverified so the
    // verify stage will re-examine them.
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

    // Trigger the pipeline function over HTTP to re-run ground + verify.
    // Edge functions are bundled independently, so we cannot import stage
    // modules directly across function folders.
    const stages = skipVerify ? ["ground-citations"] : ["ground-citations", "verify"];
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
      event_type: "citations_regrounded",
      description: `Re-grounded citations and re-ran verification for review ${planReviewId}.`,
      project_id: null,
      actor_id: userId,
      actor_type: "admin",
      metadata: {
        plan_review_id: planReviewId,
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
