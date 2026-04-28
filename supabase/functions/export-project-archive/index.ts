// export-project-archive — Florida private-provider records retention bundle.
// POST { project_id: string }
// Returns: a ZIP containing
//   - manifest.json (project, all plan_reviews, all snapshots/COCs/inspection
//     reports, full activity_log, statutory clock history) with SHA-256 of
//     each artifact for tamper evidence.
//   - letters/round-{n}-{snapshotId}.html (immutable letter HTML)
//   - inspections/{reportId}.html (immutable inspection report HTML)
//   - certificates/{cocId}.html (certificate of compliance HTML)
//
// This is what a private provider hands the AHJ when audited under
// 553.791 F.S. — proof of every comment, every delivery, every clock event.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
// deno-types via esm.sh for fflate
import { zipSync, strToU8 } from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Verify caller is authenticated; service-role client used for the actual
    // queries so RLS doesn't block the bundle assembly, but we still gate on
    // the user's JWT before exposing data.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userRes.user.id;

    const body = await req.json().catch(() => ({}));
    const projectId = String(body.project_id ?? "").trim();
    if (!projectId || projectId.length > 64) {
      return new Response(JSON.stringify({ error: "project_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve user's firm_id and confirm they own the project.
    const { data: membership } = await admin
      .from("firm_members")
      .select("firm_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const firmId = membership?.firm_id ?? null;

    const { data: project, error: projErr } = await admin
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .maybeSingle();
    if (projErr) throw projErr;
    if (!project) {
      return new Response(JSON.stringify({ error: "project not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (project.firm_id && firmId && project.firm_id !== firmId) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch records-retention artifacts in parallel.
    const [
      planReviewsRes,
      snapshotsRes,
      cocsRes,
      reportsRes,
      activityRes,
      defsRes,
    ] = await Promise.all([
      admin.from("plan_reviews").select("*").eq("project_id", projectId).order("round"),
      admin.from("comment_letter_snapshots").select("*")
        .in("plan_review_id",
          (await admin.from("plan_reviews").select("id").eq("project_id", projectId)).data?.map((r) => r.id) ?? [])
        .order("sent_at"),
      admin.from("certificates_of_compliance").select("*").eq("project_id", projectId).order("issued_at"),
      admin.from("inspection_reports").select("*").eq("project_id", projectId).order("performed_at"),
      admin.from("activity_log").select("*").eq("project_id", projectId).order("created_at"),
      admin.from("deficiencies_v2").select("*")
        .in("plan_review_id",
          (await admin.from("plan_reviews").select("id").eq("project_id", projectId)).data?.map((r) => r.id) ?? []),
    ]);

    const errs = [planReviewsRes.error, snapshotsRes.error, cocsRes.error, reportsRes.error, activityRes.error, defsRes.error].filter(Boolean);
    if (errs.length) throw errs[0];

    const planReviews = planReviewsRes.data ?? [];
    const snapshots = snapshotsRes.data ?? [];
    const cocs = cocsRes.data ?? [];
    const reports = reportsRes.data ?? [];
    const activity = activityRes.data ?? [];
    const deficiencies = defsRes.data ?? [];

    // Build files object for zip.
    const files: Record<string, Uint8Array> = {};
    const artifactIndex: Array<{ path: string; sha256: string; bytes: number; type: string; id: string }> = [];

    for (const s of snapshots) {
      const path = `letters/round-${s.round}-${s.id}.html`;
      const bytes = strToU8(s.letter_html ?? "");
      files[path] = bytes;
      artifactIndex.push({
        path, sha256: await sha256Hex(bytes), bytes: bytes.length,
        type: "comment_letter_snapshot", id: s.id,
      });
    }
    for (const r of reports) {
      const path = `inspections/${r.id}.html`;
      const bytes = strToU8(r.report_html ?? "");
      files[path] = bytes;
      artifactIndex.push({
        path, sha256: await sha256Hex(bytes), bytes: bytes.length,
        type: "inspection_report", id: r.id,
      });
    }
    for (const c of cocs) {
      const path = `certificates/${c.id}.html`;
      const bytes = strToU8(c.certificate_html ?? "");
      files[path] = bytes;
      artifactIndex.push({
        path, sha256: await sha256Hex(bytes), bytes: bytes.length,
        type: "certificate_of_compliance", id: c.id,
      });
    }

    const manifest = {
      bundle_version: 1,
      generated_at: new Date().toISOString(),
      generated_by: { user_id: userId, firm_id: firmId },
      project,
      plan_reviews: planReviews,
      comment_letter_snapshots: snapshots,
      inspection_reports: reports,
      certificates_of_compliance: cocs,
      deficiencies: deficiencies,
      activity_log: activity,
      statutory_clock: {
        review_clock_started_at: project.review_clock_started_at,
        review_clock_paused_at: project.review_clock_paused_at,
        clock_resumed_at: project.clock_resumed_at,
        clock_pause_reason: project.clock_pause_reason,
        clock_resume_reason: project.clock_resume_reason,
        clock_pause_history: project.clock_pause_history ?? [],
        statutory_deadline_at: project.statutory_deadline_at,
      },
      artifact_index: artifactIndex,
    };

    const manifestBytes = strToU8(JSON.stringify(manifest, null, 2));
    files["manifest.json"] = manifestBytes;

    const zipped = zipSync(files, { level: 6 });

    return new Response(zipped, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="project-archive-${projectId}.zip"`,
        "X-Manifest-SHA256": await sha256Hex(manifestBytes),
        "X-Artifact-Count": String(artifactIndex.length),
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
