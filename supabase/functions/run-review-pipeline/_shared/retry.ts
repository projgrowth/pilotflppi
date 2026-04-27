// Bounded exponential backoff. Used by the orchestrator around every stage
// and by individual stages around their own AI calls. The `payment_required`
// shortcut prevents us from burning attempts (and dollars) when the Lovable
// AI Gateway has billed the workspace out — that error never resolves on
// its own.

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const errMsg = err instanceof Error ? err.message : String(err);
      // Never retry billing errors — they will not resolve on their own.
      if (errMsg === "payment_required") throw err;
      console.error(`[${label}] attempt ${attempt} failed:`, err);
      if (attempt === maxAttempts) break;
      const backoff = Math.min(8000, 500 * Math.pow(2, attempt - 1));
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}
