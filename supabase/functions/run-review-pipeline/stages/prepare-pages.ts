// stages/prepare-pages.ts — verify-only manifest check.
//
// The browser (pdf.js in `uploadPlanReviewFiles` / `reprepareInBrowser`) is
// the ONLY place that rasterizes plan PDFs into per-page JPEGs. This stage
// just confirms the manifest exists and at least one asset is reachable;
// everything else throws NEEDS_BROWSER_RASTERIZATION so the dashboard can
// surface a "Re-prepare in browser" CTA.
//
// Cost budget: ~50ms — one count(*), one signed URL, no MuPDF, no downloads.

import type { Admin } from "../_shared/supabase.ts";
import { NEEDS_BROWSER_RASTERIZATION } from "../_shared/types.ts";
import { invalidatePageManifestCache } from "../_shared/storage.ts";

export async function stagePreparePages(
  admin: Admin,
  planReviewId: string,
  _firmId: string | null,
) {
  void _firmId;
  const { count: readyCount } = await admin
    .from("plan_review_page_assets")
    .select("id", { count: "exact", head: true })
    .eq("plan_review_id", planReviewId)
    .eq("status", "ready");
  const prepared = readyCount ?? 0;

  if (prepared <= 0) {
    throw new Error(
      `${NEEDS_BROWSER_RASTERIZATION}: no page assets in manifest for plan_review ${planReviewId}`,
    );
  }

  // Spot-check the first manifest row resolves to a signable storage object.
  // If it doesn't, the manifest is stale (storage cleared, asset paths wrong)
  // and the browser needs to re-rasterize.
  const { data: firstRow } = await admin
    .from("plan_review_page_assets")
    .select("storage_path")
    .eq("plan_review_id", planReviewId)
    .eq("status", "ready")
    .order("page_index", { ascending: true })
    .limit(1)
    .maybeSingle();
  const storagePath = (firstRow as { storage_path?: string } | null)?.storage_path;
  if (!storagePath) {
    throw new Error(
      `${NEEDS_BROWSER_RASTERIZATION}: manifest row missing storage_path`,
    );
  }
  const { data: signed, error: signErr } = await admin.storage
    .from("documents")
    .createSignedUrl(storagePath, 60);
  if (signErr || !signed) {
    throw new Error(
      `${NEEDS_BROWSER_RASTERIZATION}: cannot sign first manifest asset (${storagePath}): ${signErr?.message ?? "unknown"}`,
    );
  }

  invalidatePageManifestCache(planReviewId);
  return {
    prepared_pages: prepared,
    pre_rasterized: true,
  };
}
