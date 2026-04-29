// Daily cron: deletes orphaned PDF uploads in the `documents` bucket for
// plan reviews that failed >30 days ago. Without this, every failed upload
// leaves files in storage forever.
//
// Also runs lightweight retention on noisy `pipeline_error_log` rows
// (chunk_summary, stuck_no_progress) older than 90 days. Real errors are
// kept forever.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FAILED_REVIEW_AGE_DAYS = 30;
const ERROR_LOG_RETENTION_DAYS = 90;
const COST_METRIC_RETENTION_DAYS = 30;
const MAX_REVIEWS_PER_TICK = 100;

// deno-lint-ignore no-explicit-any
async function loadAdmin(): Promise<any> {
  const mod = await import("https://esm.sh/@supabase/supabase-js@2.74.0");
  return mod.createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

// deno-lint-ignore no-explicit-any
async function deleteReviewObjects(
  admin: any,
  planReviewId: string,
  firmId: string | null,
): Promise<{ deleted: number; error?: string }> {
  if (!firmId) {
    // Pre-firm-scoping rows had no firm_id and live under the legacy
    // `plan-reviews/<id>/...` prefix, which the recent migration moved
    // out of existence. Nothing to clean here.
    return { deleted: 0 };
  }
  try {
    const prefix = `firms/${firmId}/plan-reviews/${planReviewId}`;
    const { data: files, error: listErr } = await admin.storage
      .from("documents")
      .list(prefix, { limit: 1000 });
    if (listErr) return { deleted: 0, error: listErr.message };
    if (!files || files.length === 0) return { deleted: 0 };

    const paths = files.map((f: { name: string }) => `${prefix}/${f.name}`);
    const { error: rmErr } = await admin.storage.from("documents").remove(paths);
    if (rmErr) return { deleted: 0, error: rmErr.message };
    return { deleted: paths.length };
  } catch (err) {
    return { deleted: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const admin = await loadAdmin();
    const cutoff = new Date(Date.now() - FAILED_REVIEW_AGE_DAYS * 86400 * 1000).toISOString();

    const { data: failed, error } = await admin
      .from("plan_reviews")
      .select("id, firm_id, created_at")
      .eq("ai_check_status", "failed")
      .lt("created_at", cutoff)
      .limit(MAX_REVIEWS_PER_TICK);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let totalFiles = 0;
    let reviewsCleaned = 0;
    const errors: string[] = [];

    for (const row of (failed ?? []) as Array<{ id: string; firm_id: string | null }>) {
      const result = await deleteReviewObjects(admin, row.id);
      if (result.error) {
        errors.push(`${row.id}: ${result.error}`);
      } else if (result.deleted > 0) {
        totalFiles += result.deleted;
        reviewsCleaned++;
        try {
          await admin.from("pipeline_error_log").insert({
            plan_review_id: row.id,
            firm_id: row.firm_id,
            stage: "cleanup",
            error_class: "storage_cleanup",
            error_message: `Deleted ${result.deleted} orphan file(s) from failed review (>${FAILED_REVIEW_AGE_DAYS}d old).`,
            metadata: { files_deleted: result.deleted },
          });
        } catch (logErr) {
          console.error("[cleanup] log failed:", logErr);
        }
      }
    }

    // Retention: prune noisy informational logs older than 90d.
    const logCutoff = new Date(Date.now() - ERROR_LOG_RETENTION_DAYS * 86400 * 1000).toISOString();
    let logsDeleted = 0;
    try {
      const { count } = await admin
        .from("pipeline_error_log")
        .delete({ count: "estimated" })
        .in("error_class", ["chunk_summary", "stuck_no_progress", "storage_cleanup"])
        .lt("created_at", logCutoff);
      logsDeleted = count ?? 0;
    } catch (err) {
      console.error("[cleanup] log retention failed:", err);
    }

    // Retention: cost_metric rows have shorter retention (30d) — they accumulate
    // ~100/review and are only useful for short-term cost dashboards.
    const costCutoff = new Date(Date.now() - COST_METRIC_RETENTION_DAYS * 86400 * 1000).toISOString();
    let costsDeleted = 0;
    try {
      const { count } = await admin
        .from("pipeline_error_log")
        .delete({ count: "estimated" })
        .eq("error_class", "cost_metric")
        .lt("created_at", costCutoff);
      costsDeleted = count ?? 0;
    } catch (err) {
      console.error("[cleanup] cost retention failed:", err);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        reviews_scanned: failed?.length ?? 0,
        reviews_cleaned: reviewsCleaned,
        files_deleted: totalFiles,
        logs_deleted: logsDeleted,
        cost_rows_deleted: costsDeleted,
        errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[cleanup-orphan-uploads] fatal:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
