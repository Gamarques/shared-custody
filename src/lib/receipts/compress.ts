/**
 * Receipt photo compression (RNF-06, T-14). The phone camera gives several MB; the free
 * Supabase Storage has 1 GB, so the browser shrinks the photo to JPEG of at most
 * RECEIPT_MAX_BYTES before upload. The search for a size that fits is pure (the encoder is
 * injected) so it is testable without a canvas.
 */

export const RECEIPT_MAX_BYTES = 300 * 1024;
export const RECEIPT_MAX_DIMENSION = 1600;
const MIN_DIMENSION = 320;
const QUALITIES = [0.8, 0.7, 0.6, 0.5, 0.4] as const;
const SHRINK_FACTOR = 0.75;
/** Photos above this are refused before decoding: nobody needs a 30 MB receipt. */
export const RECEIPT_MAX_INPUT_BYTES = 25 * 1024 * 1024;

export type Encoded = { size: number };
export type Encoder<T extends Encoded> = (width: number, height: number, quality: number) => Promise<T>;

export class ReceiptTooLargeError extends Error {
  constructor() {
    super("Receipt cannot be compressed under the size limit");
    this.name = "ReceiptTooLargeError";
  }
}

/** Scales (width, height) down, keeping the ratio, so the longer side is at most `max`. */
export function fitDimensions(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * First encoding at or under maxBytes: best quality first, then a smaller picture, until the
 * longer side would fall under 320 px (then ReceiptTooLargeError).
 */
export async function compressToTarget<T extends Encoded>(
  width: number,
  height: number,
  encode: Encoder<T>,
  maxBytes = RECEIPT_MAX_BYTES,
  maxDimension = RECEIPT_MAX_DIMENSION,
): Promise<T & { width: number; height: number; quality: number }> {
  let size = fitDimensions(width, height, maxDimension);
  for (;;) {
    for (const quality of QUALITIES) {
      const out = await encode(size.width, size.height, quality);
      if (out.size <= maxBytes) return { ...out, width: size.width, height: size.height, quality };
    }
    const longest = Math.max(size.width, size.height);
    if (longest * SHRINK_FACTOR < MIN_DIMENSION) throw new ReceiptTooLargeError();
    size = fitDimensions(size.width, size.height, Math.floor(longest * SHRINK_FACTOR));
  }
}

export type ReceiptFileCheck = "ok" | "not-image" | "too-big";

export function checkReceiptFile(file: { type: string; size: number }): ReceiptFileCheck {
  if (!file.type.startsWith("image/")) return "not-image";
  if (file.size > RECEIPT_MAX_INPUT_BYTES) return "too-big";
  return "ok";
}

export function receiptErrorMessage(e: unknown, check?: ReceiptFileCheck): string {
  if (check === "not-image") return "O comprovativo deve ser uma foto (imagem).";
  if (check === "too-big") return "A foto é demasiado grande. Escolhe outra.";
  if (e instanceof ReceiptTooLargeError) return "Não foi possível reduzir a foto o suficiente. Tenta outra foto.";
  return "Não foi possível ler a foto. Tenta outra.";
}

/** Browser only: decodes the photo (EXIF rotation applied) and re-encodes it as a small JPEG. */
export async function compressReceiptPhoto(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not available");
    const encode: Encoder<{ size: number; blob: Blob }> = (w, h, quality) =>
      new Promise((resolve, reject) => {
        canvas.width = w;
        canvas.height = h;
        ctx.fillStyle = "#fff"; // JPEG has no alpha: PNG screenshots would turn black
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(bitmap, 0, 0, w, h);
        canvas.toBlob(
          (blob) => (blob ? resolve({ size: blob.size, blob }) : reject(new Error("Encoding failed"))),
          "image/jpeg",
          quality,
        );
      });
    return (await compressToTarget(bitmap.width, bitmap.height, encode)).blob;
  } finally {
    bitmap.close();
  }
}
