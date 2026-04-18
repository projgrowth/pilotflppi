import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Module-scoped cache: code_ref → { count, fetchedAt }. Survives navigation,
 * cleared on full reload. 5-minute TTL keeps the badge fresh without thrashing
 * the edge function on every render.
 */
const cache = new Map<string, { count: number; fetchedAt: number }>();
const inflight = new Map<string, Promise<number>>();
const TTL_MS = 5 * 60 * 1000;

async function fetchCountForCodeRef(codeRef: string, queryText: string): Promise<number> {
  const cached = cache.get(codeRef);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.count;

  // Coalesce duplicate in-flight requests for the same key.
  const existing = inflight.get(codeRef);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke("get-similar-corrections", {
        body: { query_text: queryText, limit: 20 },
      });
      if (error) throw error;
      const corrections = Array.isArray(data?.corrections) ? data.corrections : [];
      // Only count corrections whose fbc_section matches the finding's code_ref.
      // This is what makes the badge defensible: "this exact code section was
      // corrected N times before," not just "something vaguely similar."
      const normalized = codeRef.trim().toLowerCase();
      const count = corrections.filter((c: { fbc_section?: string | null }) => {
        const sec = (c.fbc_section || "").trim().toLowerCase();
        return sec && (sec === normalized || sec.includes(normalized) || normalized.includes(sec));
      }).length;
      cache.set(codeRef, { count, fetchedAt: Date.now() });
      return count;
    } catch {
      // Soft-fail: never block the reviewer UI on a corrections-loop hiccup.
      cache.set(codeRef, { count: 0, fetchedAt: Date.now() });
      return 0;
    } finally {
      inflight.delete(codeRef);
    }
  })();
  inflight.set(codeRef, promise);
  return promise;
}

/**
 * Look up how many prior corrections exist for a given finding's code_ref +
 * description. Returns null while loading, then a number. Cached 5 min per key.
 *
 * The reviewer card uses N≥3 as the threshold for the amber "review carefully"
 * badge — below that the signal is too noisy to act on.
 */
export function useSimilarCorrections(codeRef: string | undefined, description: string | undefined): number | null {
  const [count, setCount] = useState<number | null>(() => {
    if (!codeRef) return 0;
    const cached = cache.get(codeRef);
    return cached && Date.now() - cached.fetchedAt < TTL_MS ? cached.count : null;
  });

  useEffect(() => {
    if (!codeRef) {
      setCount(0);
      return;
    }
    const cached = cache.get(codeRef);
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
      setCount(cached.count);
      return;
    }
    let cancelled = false;
    const queryText = `${codeRef} ${description || ""}`.trim().slice(0, 500);
    fetchCountForCodeRef(codeRef, queryText).then((n) => {
      if (!cancelled) setCount(n);
    });
    return () => { cancelled = true; };
  }, [codeRef, description]);

  return count;
}
