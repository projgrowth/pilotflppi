// Page asset manifest + signed-URL helpers. Multiple stages need the same
// per-review page list, so we cache it for the lifetime of one edge worker.
//
// FIX (2026-04-27): the legacy fallback path referenced an undefined
// `PAGE_ASSET_RE` that would have thrown ReferenceError the first time any
// pre-manifest review hit the path. Reuses the `PAGE_ASSET_INDEX_RE` that
// was already defined and was the obvious intent.

import type { Admin } from "./supabase.ts";

// Page assets are produced by the BROWSER (pdf.js in the wizard / inline
// upload). Server-side rasterization was removed — Supabase edge workers'
// ~2s CPU budget can't reliably load MuPDF WASM, decode, JPEG-encode, and
// upload a single page on a cold start, let alone a multi-PDF plan set.
// `prepare_pages` is now a thin verifier; if the manifest is empty the
// stage throws NEEDS_BROWSER_RASTERIZATION and the client takes over.
//
// Match either legacy .png or current .jpg page assets when scanning
// storage or storage_path strings, so older runs are still recognized.
export const PAGE_ASSET_INDEX_RE = /p-(\d{3,})\.(png|jpe?g)$/;

/**
 * In-memory cache keyed by plan_review_id, scoped to a single edge invocation.
 * Multiple stages call signedSheetUrls() — caching avoids repeated storage
 * listing, repeated rasterization checks, and repeated URL signing on the
 * same page set.
 */
const _pageManifestCache = new Map<
  string,
  Array<{ file_path: string; signed_url: string }>
>();

/**
 * Read the persisted page manifest from public.plan_review_page_assets and
 * sign each row's storage_path. Returns null if the manifest is empty so the
 * caller can fall back to building it.
 */
export async function readSignedManifest(
  admin: Admin,
  planReviewId: string,
): Promise<Array<{ file_path: string; signed_url: string }> | null> {
  const { data: rows } = await admin
    .from("plan_review_page_assets")
    .select("page_index, storage_path, status, cached_signed_url, cached_until")
    .eq("plan_review_id", planReviewId)
    .eq("status", "ready")
    .order("page_index", { ascending: true });
  const ready = (rows ?? []) as Array<{
    page_index: number;
    storage_path: string;
    status: string;
    cached_signed_url: string | null;
    cached_until: string | null;
  }>;
  if (ready.length === 0) return null;

  // Reuse cached signed URLs that still have ≥1h of life. Bumped from 6h to
  // 7 days so evidence crops embedded in exported comment letters survive
  // long enough for the building official to open the email/PDF the next
  // day without 401s. Re-signing happens lazily via the resign-page-asset
  // edge function when the cache approaches expiry.
  const SIGN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
  const REUSE_MIN_REMAINING_MS = 60 * 60 * 1000; // 1 hour
  const nowMs = Date.now();
  const out: Array<{ file_path: string; signed_url: string }> = [];
  const refreshed: Array<{
    storage_path: string;
    signed_url: string;
    expires_at: string;
  }> = [];

  for (const r of ready) {
    const expiresMs = r.cached_until ? new Date(r.cached_until).getTime() : 0;
    if (r.cached_signed_url && expiresMs - nowMs > REUSE_MIN_REMAINING_MS) {
      out.push({ file_path: r.storage_path, signed_url: r.cached_signed_url });
      continue;
    }
    const { data: signed } = await admin.storage
      .from("documents")
      .createSignedUrl(r.storage_path, SIGN_TTL_SECONDS);
    if (signed) {
      out.push({ file_path: r.storage_path, signed_url: signed.signedUrl });
      refreshed.push({
        storage_path: r.storage_path,
        signed_url: signed.signedUrl,
        expires_at: new Date(nowMs + SIGN_TTL_SECONDS * 1000).toISOString(),
      });
    }
  }

  // Best-effort batch update of the cache columns. Errors here are not fatal
  // — worst case the next stage signs fresh URLs again.
  if (refreshed.length > 0) {
    for (const f of refreshed) {
      await admin
        .from("plan_review_page_assets")
        .update({ cached_signed_url: f.signed_url, cached_until: f.expires_at })
        .eq("plan_review_id", planReviewId)
        .eq("storage_path", f.storage_path);
    }
  }

  return out;
}

/**
 * Manifest-only page lookup. Reads `plan_review_page_assets` and signs each
 * row's storage_path. The cold-path rasterization lives ONLY in
 * `stagePreparePages` so heavy MuPDF work runs in its own dedicated edge
 * worker invocation and can't co-exist with AI calls or other stage state.
 */
export async function signedSheetUrls(
  admin: Admin,
  planReviewId: string,
  _firmId: string | null = null,
): Promise<Array<{ file_path: string; signed_url: string }>> {
  const cached = _pageManifestCache.get(planReviewId);
  if (cached) return cached;

  const fromDb = await readSignedManifest(admin, planReviewId);
  if (fromDb && fromDb.length > 0) {
    _pageManifestCache.set(planReviewId, fromDb);
    return fromDb;
  }

  // Legacy fallback: pre-manifest reviews stored pages under `<dir>/pages/`.
  // Index them into the manifest without rasterizing so subsequent stages have
  // a stable source of truth. If no pages exist, return empty — the caller's
  // stage will fail and prepare_pages must be re-run.
  const { data: files, error } = await admin
    .from("plan_review_files")
    .select("file_path")
    .eq("plan_review_id", planReviewId)
    .order("uploaded_at", { ascending: true });
  if (error) throw error;

  const out: Array<{ file_path: string; signed_url: string }> = [];
  const manifestRows: Array<{
    plan_review_id: string;
    firm_id: string | null;
    source_file_path: string;
    page_index: number;
    storage_path: string;
    status: string;
  }> = [];
  let globalPageIndex = 0;

  for (const f of (files ?? []) as Array<{ file_path: string }>) {
    const filePath = f.file_path;
    const isPdf = filePath.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      const { data: signed } = await admin.storage
        .from("documents")
        .createSignedUrl(filePath, 60 * 60);
      if (signed) {
        out.push({ file_path: filePath, signed_url: signed.signedUrl });
        manifestRows.push({
          plan_review_id: planReviewId,
          firm_id: _firmId,
          source_file_path: filePath,
          page_index: globalPageIndex,
          storage_path: filePath,
          status: "ready",
        });
        globalPageIndex++;
      }
      continue;
    }
    const lastSlash = filePath.lastIndexOf("/");
    const dir = lastSlash >= 0 ? filePath.slice(0, lastSlash) : "";
    const pagesDir = `${dir}/pages`;
    const { data: existing } = await admin.storage
      .from("documents")
      .list(pagesDir, { limit: 1000, sortBy: { column: "name", order: "asc" } });
    // FIX: the original code referenced an undefined `PAGE_ASSET_RE` here,
    // which would have thrown ReferenceError on the legacy fallback path.
    // The intent was clearly to match page-asset filenames, so we use the
    // already-defined PAGE_ASSET_INDEX_RE.
    const pagePaths = (existing ?? [])
      .filter((o: { name: string }) => PAGE_ASSET_INDEX_RE.test(o.name))
      .map((o: { name: string }) => `${pagesDir}/${o.name}`)
      .sort();
    for (const p of pagePaths) {
      const { data: signed } = await admin.storage
        .from("documents")
        .createSignedUrl(p, 60 * 60);
      if (signed) {
        out.push({ file_path: p, signed_url: signed.signedUrl });
        manifestRows.push({
          plan_review_id: planReviewId,
          firm_id: _firmId,
          source_file_path: filePath,
          page_index: globalPageIndex,
          storage_path: p,
          status: "ready",
        });
        globalPageIndex++;
      }
    }
  }

  if (manifestRows.length > 0) {
    const { error: insErr } = await admin
      .from("plan_review_page_assets")
      .upsert(manifestRows, { onConflict: "plan_review_id,page_index" });
    if (insErr) console.error("[manifest] persist failed:", insErr);
  }

  _pageManifestCache.set(planReviewId, out);
  return out;
}
