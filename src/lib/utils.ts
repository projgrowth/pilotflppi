import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Run an async worker over a list of items, executing at most `chunkSize`
 * promises in parallel. Preserves output order. Errors from one item don't
 * abort the rest — instead each result is wrapped in `{ ok, value | error }`.
 *
 * Used for the AI refine pass so 12 second-pass zoom calls fan out 3-at-a-time
 * instead of running serially (~3x faster), without overwhelming the gateway.
 */
export async function chunkPromises<T, R>(
  items: T[],
  chunkSize: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(items.length);
  let cursor = 0;

  async function runOne() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        const value = await worker(items[i], i);
        results[i] = { ok: true, value };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(chunkSize, items.length) }, () => runOne())
  );
  return results;
}
