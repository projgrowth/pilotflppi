// Mirror of src/lib/storage-paths.ts for Deno edge functions.
//
// `plan_review_files.file_path` should hold a Storage object key
// (e.g. `plan-reviews/<id>/round-1/foo.pdf`). Older upload paths stored the
// full public URL, which causes
//
//   admin.storage.from("documents").createSignedUrl(<URL>, ...)
//
// to URL-encode the value a second time and return "Object not found". This
// helper strips the public/sign URL prefix for the `documents` bucket and
// decodes percent-escapes. Anything that doesn't look like a documents-bucket
// URL is returned unchanged.

const DOCUMENTS_URL_RE =
  /^https?:\/\/[^/]+\/storage\/v1\/object\/(?:public|sign)\/documents\/(.+)$/i;

export function normalizeStorageKey(input: string): string {
  if (!input) return input;
  const m = input.match(DOCUMENTS_URL_RE);
  if (!m) return input;
  const rawKey = m[1].split("?")[0];
  try {
    return decodeURIComponent(rawKey);
  } catch {
    return rawKey;
  }
}
