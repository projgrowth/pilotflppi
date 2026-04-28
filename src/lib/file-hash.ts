/**
 * Browser-side SHA-256 fingerprinting helpers used for plan-set and
 * inspection chain of custody. Callers:
 *
 *   1. `plan-review-upload.ts` — hashes each uploaded PDF before it leaves
 *      the browser so we can prove later that the bytes the AHJ received are
 *      the bytes the contractor uploaded.
 *   2. `send-inspection-report.ts` — hashes the final inspection report HTML
 *      at the instant of "Send to AHJ" (F.S. 553.791(7)).
 *   3. `certificate-of-compliance.ts` — chains report hashes into the final
 *      tamper-evident CoC hash (F.S. 553.791(10)).
 *   4. Inspection photo upload — hashes EXIF-stripped JPEGs and extracts
 *      GPS/timestamp metadata for chain of custody.
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

/**
 * Best-effort EXIF extraction for inspection-photo chain-of-custody (Sprint 4).
 *
 * Reads only the first ~64 KB of the file to find the EXIF block, so it stays
 * cheap on large phone photos. Failures are non-fatal — the upload still
 * proceeds with sha256 + uploaded_at; gps/captured_at are simply null.
 *
 * Supported: JPEG (FFD8) with TIFF/EXIF APP1 block. HEIC/PNG/etc. fall through
 * to "no EXIF" without error.
 */
export interface PhotoExif {
  capturedAt: Date | null;
  gpsLat: number | null;
  gpsLng: number | null;
}

export async function extractPhotoExif(file: File): Promise<PhotoExif> {
  const empty: PhotoExif = { capturedAt: null, gpsLat: null, gpsLng: null };
  try {
    if (!file.type.startsWith("image/")) return empty;
    const slice = file.slice(0, 65536);
    const buf = new DataView(await slice.arrayBuffer());
    if (buf.byteLength < 12 || buf.getUint16(0) !== 0xffd8) return empty;

    let offset = 2;
    while (offset < buf.byteLength - 4) {
      if (buf.getUint8(offset) !== 0xff) break;
      const marker = buf.getUint8(offset + 1);
      const size = buf.getUint16(offset + 2);
      // APP1 = EXIF
      if (marker === 0xe1 && buf.getUint32(offset + 4) === 0x45786966) {
        return parseExif(new DataView(buf.buffer, offset + 10, size - 8)) ?? empty;
      }
      offset += 2 + size;
    }
    return empty;
  } catch {
    return empty;
  }
}

function parseExif(tiff: DataView): PhotoExif | null {
  try {
    const little = tiff.getUint16(0) === 0x4949;
    const get16 = (o: number) => tiff.getUint16(o, little);
    const get32 = (o: number) => tiff.getUint32(o, little);
    if (get16(2) !== 0x002a) return null;
    const ifd0 = get32(4);
    const result: PhotoExif = { capturedAt: null, gpsLat: null, gpsLng: null };

    const readIfd = (start: number, onTag: (tag: number, type: number, count: number, valOffset: number) => void) => {
      const entries = get16(start);
      for (let i = 0; i < entries; i++) {
        const e = start + 2 + i * 12;
        if (e + 12 > tiff.byteLength) return 0;
        onTag(get16(e), get16(e + 2), get32(e + 4), e + 8);
      }
      return get32(start + 2 + entries * 12);
    };

    let exifIfd = 0;
    let gpsIfd = 0;
    readIfd(ifd0, (tag, _t, _c, valOff) => {
      if (tag === 0x8769) exifIfd = get32(valOff);
      else if (tag === 0x8825) gpsIfd = get32(valOff);
    });

    if (exifIfd) {
      readIfd(exifIfd, (tag, type, count, valOff) => {
        // DateTimeOriginal
        if (tag === 0x9003 && type === 2) {
          const offset = count > 4 ? get32(valOff) : valOff;
          const bytes: number[] = [];
          for (let i = 0; i < Math.min(count, 20); i++) bytes.push(tiff.getUint8(offset + i));
          const s = String.fromCharCode(...bytes).replace(/\0+$/, "");
          // EXIF format: "YYYY:MM:DD HH:MM:SS"
          const m = s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
          if (m) {
            result.capturedAt = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
          }
        }
      });
    }

    if (gpsIfd) {
      let latRef = "N";
      let lngRef = "E";
      let latVals: number[] | null = null;
      let lngVals: number[] | null = null;
      const readRationals = (count: number, valOff: number): number[] => {
        const offset = count * 8 > 4 ? get32(valOff) : valOff;
        const out: number[] = [];
        for (let i = 0; i < count; i++) {
          const num = get32(offset + i * 8);
          const den = get32(offset + i * 8 + 4);
          out.push(den === 0 ? 0 : num / den);
        }
        return out;
      };
      readIfd(gpsIfd, (tag, type, count, valOff) => {
        if (tag === 1 && type === 2) latRef = String.fromCharCode(tiff.getUint8(valOff));
        else if (tag === 3 && type === 2) lngRef = String.fromCharCode(tiff.getUint8(valOff));
        else if (tag === 2 && type === 5 && count === 3) latVals = readRationals(3, valOff);
        else if (tag === 4 && type === 5 && count === 3) lngVals = readRationals(3, valOff);
      });
      if (latVals && lngVals) {
        const toDeg = (v: number[]) => v[0] + v[1] / 60 + v[2] / 3600;
        result.gpsLat = (latRef === "S" ? -1 : 1) * toDeg(latVals);
        result.gpsLng = (lngRef === "W" ? -1 : 1) * toDeg(lngVals);
      }
    }

    return result;
  } catch {
    return null;
  }
}

