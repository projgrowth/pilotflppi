/**
 * Storage path normalization.
 *
 * `plan_review_files.file_path` should always hold a Storage object key
 * (e.g. `plan-reviews/<id>/round-1/foo.pdf`). Older upload paths sometimes
 * wrote the full public URL instead, which causes
 *
 *   supabase.storage.from("documents").createSignedUrl(<URL>, ...)
 *
 * to URL-encode the value a second time and look up a literal object named
 * `https%3A%2F%2F.../foo.pdf` — Storage returns "Object not found".
 *
 * This helper strips the public/sign URL prefix for the `documents` bucket
 * and decodes percent-escapes, so callers can treat any historical value
 * uniformly. Anything that doesn't look like a documents-bucket URL is
 * returned unchanged.
 */
const DOCUMENTS_URL_RE =
  /^https?:\/\/[^/]+\/storage\/v1\/object\/(?:public|sign)\/documents\/(.+)$/i;

export function normalizeStorageKey(input: string): string {
  if (!input) return input;
  const m = input.match(DOCUMENTS_URL_RE);
  if (!m) return input;
  // Drop any query string (e.g. `?token=...` on signed URLs).
  const rawKey = m[1].split("?")[0];
  let decoded = rawKey;
  try {
    decoded = decodeURIComponent(rawKey);
  } catch {
    // Malformed escape — fall back to the raw key.
  }
  // eslint-disable-next-line no-console
  console.warn(
    "[storage-paths] normalized URL-style file_path → key:",
    decoded,
  );
  return decoded;
}
