// Returns the page-level evidence thumbnail URL for a finding, lazily
// re-signing when the cached signed URL has expired.
//
// The hook is intentionally cheap on first render: if the URL still has >1h
// of life it returns synchronously without a network call. A re-sign hits
// the `resign-page-asset` edge function, which RLS-checks the caller.

import { useEffect, useState } from "react";
import { ensureFreshEvidenceUrl } from "@/lib/evidence-resolver";

interface Opts {
  planReviewId: string;
  evidenceCropUrl: string | null | undefined;
  evidenceCropMeta: Record<string, unknown> | null | undefined;
  /** Skip work entirely until the consumer is ready to render. */
  enabled?: boolean;
}

interface State {
  url: string | null;
  pageIndex: number | null;
  sheetRef: string | null;
  unresolved: boolean;
  loading: boolean;
}

export function useEvidencePageThumb(opts: Opts): State {
  const enabled = opts.enabled !== false;
  const [state, setState] = useState<State>(() => ({
    url: opts.evidenceCropUrl ?? null,
    pageIndex:
      typeof (opts.evidenceCropMeta as { page_index?: unknown })?.page_index === "number"
        ? ((opts.evidenceCropMeta as { page_index: number }).page_index)
        : null,
    sheetRef:
      typeof (opts.evidenceCropMeta as { sheet_ref?: unknown })?.sheet_ref === "string"
        ? ((opts.evidenceCropMeta as { sheet_ref: string }).sheet_ref)
        : null,
    unresolved: (opts.evidenceCropMeta as { unresolved_sheet?: unknown })?.unresolved_sheet === true,
    loading: false,
  }));

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    ensureFreshEvidenceUrl({
      planReviewId: opts.planReviewId,
      evidenceCropUrl: opts.evidenceCropUrl,
      evidenceCropMeta: (opts.evidenceCropMeta ?? null) as Parameters<
        typeof ensureFreshEvidenceUrl
      >[0]["evidenceCropMeta"],
    }).then((res) => {
      if (cancelled) return;
      setState({
        url: res.url,
        pageIndex: res.pageIndex,
        sheetRef: res.sheetRef,
        unresolved: res.unresolved,
        loading: false,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, opts.planReviewId, opts.evidenceCropUrl, opts.evidenceCropMeta]);

  return state;
}
