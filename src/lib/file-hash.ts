/**
 * Browser-side SHA-256 fingerprinting helpers used for plan-set chain of
 * custody (Sprint 3, P2). Two callers:
 *
 *   1. `plan-review-upload.ts` — hashes each uploaded PDF before it leaves
 *      the browser so we can prove later that the bytes the AHJ received are
 *      the bytes the contractor uploaded.
 *   2. `send-letter-snapshot.ts` — hashes the final letter HTML (and its
 *      generated PDF, if one is attached) at the instant of "Mark sent" so
 *      the snapshot row is cryptographically tied to its rendered output.
 *
 * Uses the Web Crypto API; no extra dependency. Returns lowercase hex so the
 * column comparison is straightforward.
 */

export async function sha256Hex(data: ArrayBuffer | Blob | string): Promise<string> {
  let buf: ArrayBuffer;
  if (typeof data === "string") {
    buf = new TextEncoder().encode(data).buffer as ArrayBuffer;
  } else if (data instanceof Blob) {
    buf = await data.arrayBuffer();
  } else {
    buf = data;
  }
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Hash a File while reading it once — caller can reuse the buffer for upload if needed. */
export async function sha256OfFile(file: File): Promise<string> {
  return sha256Hex(await file.arrayBuffer());
}

