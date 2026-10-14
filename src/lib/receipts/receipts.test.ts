import { describe, expect, it, vi } from "vitest";
import { belongsToFamily, getReceiptUrl, receiptPath, RECEIPT_BUCKET, RECEIPT_URL_TTL_SECONDS } from "./receipts";

describe("receipt path and signed URL (RNF-08)", () => {
  it("puts the family in the first folder", () => {
    const p = receiptPath("fam-1", "abc");
    expect(p).toBe("fam-1/abc.jpg");
    expect(belongsToFamily(p, "fam-1")).toBe(true);
    expect(belongsToFamily(p, "fam-2")).toBe(false);
    expect(belongsToFamily("fam-10/x.jpg", "fam-1")).toBe(false);
  });

  it("asks for a short-lived signed URL on the private bucket", async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: "https://x/s" }, error: null });
    const from = vi.fn().mockReturnValue({ createSignedUrl });
    expect(await getReceiptUrl({ from }, "f/a.jpg")).toBe("https://x/s");
    expect(from).toHaveBeenCalledWith(RECEIPT_BUCKET);
    expect(createSignedUrl).toHaveBeenCalledWith("f/a.jpg", RECEIPT_URL_TTL_SECONDS);
    expect(RECEIPT_URL_TTL_SECONDS).toBeLessThanOrEqual(300);
  });

  it("returns null when Storage refuses", async () => {
    const from = () => ({ createSignedUrl: async () => ({ data: null, error: { message: "denied" } }) });
    expect(await getReceiptUrl({ from }, "f/a.jpg")).toBeNull();
  });
});
