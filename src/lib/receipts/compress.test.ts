import { describe, expect, it } from "vitest";
import {
  checkReceiptFile,
  compressToTarget,
  fitDimensions,
  receiptErrorMessage,
  ReceiptTooLargeError,
  RECEIPT_MAX_BYTES,
} from "./compress";

// Fake encoder: size grows with pixels and quality, like JPEG roughly does.
const fake = (bytesPerPixelAtQ1: number) => async (w: number, h: number, q: number) => ({
  size: Math.round(w * h * q * bytesPerPixelAtQ1),
});

describe("fitDimensions", () => {
  it("keeps small pictures", () => expect(fitDimensions(800, 600, 1600)).toEqual({ width: 800, height: 600 }));
  it("scales the longer side down to the max, keeping the ratio", () => {
    expect(fitDimensions(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitDimensions(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });
});

describe("compressToTarget (RNF-06: up to ~300 KB)", () => {
  it("returns the best quality that fits", async () => {
    // 1600x1200 at q=0.8 = 1.92M px * 0.8 * 0.15 = 230 KB
    const out = await compressToTarget(4000, 3000, fake(0.15));
    expect(out).toMatchObject({ width: 1600, height: 1200, quality: 0.8 });
    expect(out.size).toBeLessThanOrEqual(RECEIPT_MAX_BYTES);
  });

  it("lowers the quality, then the dimensions, until it fits", async () => {
    const out = await compressToTarget(4000, 3000, fake(0.9));
    expect(out.size).toBeLessThanOrEqual(RECEIPT_MAX_BYTES);
    expect(out.width).toBeLessThan(1600);
    expect(out.width / out.height).toBeCloseTo(4 / 3, 1);
  });

  it("never returns more than the limit, for many inputs", async () => {
    for (const [w, h, k] of [[1000, 1000, 0.3], [6000, 4000, 1.5], [200, 300, 5]] as const) {
      const out = await compressToTarget(w, h, fake(k));
      expect(out.size).toBeLessThanOrEqual(RECEIPT_MAX_BYTES);
    }
  });

  it("gives up with ReceiptTooLargeError when nothing fits", async () => {
    await expect(compressToTarget(4000, 3000, async () => ({ size: RECEIPT_MAX_BYTES + 1 }))).rejects.toBeInstanceOf(
      ReceiptTooLargeError,
    );
  });
});

describe("checkReceiptFile / messages", () => {
  it("accepts photos only, and refuses huge files", () => {
    expect(checkReceiptFile({ type: "image/heic", size: 4_000_000 })).toBe("ok");
    expect(checkReceiptFile({ type: "application/pdf", size: 1000 })).toBe("not-image");
    expect(checkReceiptFile({ type: "image/jpeg", size: 40 * 1024 * 1024 })).toBe("too-big");
  });
  it("explains each failure", () => {
    expect(receiptErrorMessage(null, "not-image")).toMatch(/foto/);
    expect(receiptErrorMessage(new ReceiptTooLargeError())).toMatch(/reduzir/);
    expect(receiptErrorMessage(new Error("x"))).toMatch(/ler a foto/);
  });
});
