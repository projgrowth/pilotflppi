// Centralised re-signing for page-asset URLs that may have expired.
//
// Background: `deficiencies_v2.evidence_crop_url` is populated by the
// `attachEvidenceCrops` step in the pipeline with a 7-day signed URL. When
// the dashboard or comment-letter export renders that URL days later, it
// can 401. This helper transparently swaps in a fresh URL via the
// `resign-page-asset` edge function.
//
// Strategy:
//   - If meta.signed_until exists and is more than `bufferMinutes` away,
//     return the existing URL untouched (no network call).
//   - Otherwise call the edge function, which RLS-checks the caller and
//     returns a fresh signed URL (default 7-day TTL).

import { supabase } from "@/integrations/supabase/client";

interface EvidenceCropMeta {
  page_index?: number;
  sheet_ref?: string;
  signed_until?: string | null;
  unresolved_sheet?: boolean;
  pinned?: boolean;
}

interface EnsureFreshOpts {
  planReviewId: string;
  evidenceCropUrl: string | null | undefined;
  evidenceCropMeta: EvidenceCropMeta | null | undefined;
  /** Re-sign if the URL expires within this many minutes. Default 60. */
  bufferMinutes?: number;
}

interface EnsureFreshResult {
  url: string | null;
  pageIndex: number | null;
  sheetRef: string | null;
  unresolved: boolean;
  refreshed: boolean;
}

const inflight = new Map<string, Promise<{ url: string | null; expiresAt: string | null }>>();

export async function ensureFreshEvidenceUrl(opts: EnsureFreshOpts): Promise<EnsureFreshResult> {
  const meta = (opts.evidenceCropMeta ?? {}) as EvidenceCropMeta;
  const pageIndex = typeof meta.page_index === "number" ? meta.page_index : null;
  const sheetRef = typeof meta.sheet_ref === "string" ? meta.sheet_ref : null;
  const unresolved = meta.unresolved_sheet === true;

  // If we don't even have a page_index we can't re-sign — return whatever
  // URL was stamped (may still be valid for a while).
  if (pageIndex == null) {
    return {
      url: opts.evidenceCropUrl ?? null,
      pageIndex: null,
      sheetRef,
      unresolved,
      refreshed: false,
    };
  }

  const buffer = (opts.bufferMinutes ?? 60) * 60 * 1000;
  const expiresMs = meta.signed_until ? new Date(meta.signed_until).getTime() : 0;
  const isFresh = !!opts.evidenceCropUrl && expiresMs - Date.now() > buffer;

  if (isFresh) {
    return {
      url: opts.evidenceCropUrl ?? null,
      pageIndex,
      sheetRef,
      unresolved,
      refreshed: false,
    };
  }

  // De-dupe concurrent re-sign requests for the same (review, page).
  const key = `${opts.planReviewId}::${pageIndex}`;
  let task = inflight.get(key);
  if (!task) {
    task = (async () => {
      const { data, error } = await supabase.functions.invoke("resign-page-asset", {
        body: { plan_review_id: opts.planReviewId, page_index: pageIndex },
      });
      if (error) throw error;
      const payload = (data ?? {}) as { signed_url?: string; expires_at?: string };
      return {
        url: payload.signed_url ?? null,
        expiresAt: payload.expires_at ?? null,
      };
    })();
    inflight.set(key, task);
    task.finally(() => inflight.delete(key));
  }

  try {
    const { url } = await task;
    return {
      url: url ?? opts.evidenceCropUrl ?? null,
      pageIndex,
      sheetRef,
      unresolved,
      refreshed: !!url,
    };
  } catch {
    // Fall back to the (possibly expired) URL — the consumer can render an
    // "expired" state instead of crashing.
    return {
      url: opts.evidenceCropUrl ?? null,
      pageIndex,
      sheetRef,
      unresolved,
      refreshed: false,
    };
  }
}

/**
 * Fetch an evidence URL and return a base64 data URL. Used by the comment
 * letter export so embedded thumbnails survive being copy/pasted into email
 * or rendered offline in a saved PDF.
 */
export async function evidenceUrlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch evidence failed: ${res.status}`);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(blob);
  });
}
