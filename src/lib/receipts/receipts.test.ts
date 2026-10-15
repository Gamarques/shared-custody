import { describe, expect, it, vi } from "vitest";
import { belongsToFamily, getReceiptUrl, openReceipt, receiptPath, RECEIPT_BUCKET, RECEIPT_URL_TTL_SECONDS } from "./receipts";

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

describe("openReceipt (iOS pop-up blocking, T-24)", () => {
  function fakeWindow(tabAllowed = true) {
    const events: string[] = [];
    const tab = { opener: {} as unknown, location: { href: "" }, close: () => events.push("close") };
    const win = {
      location: { href: "/despesas" },
      open: (url: string, target: string) => {
        events.push(`open:${url}:${target}`);
        return tabAllowed ? tab : null;
      },
    };
    return { win, tab, events };
  }

  it("opens the tab before waiting for the signed URL, then points it there without opener", async () => {
    const { win, tab, events } = fakeWindow();
    const opened = await openReceipt(win, async () => {
      events.push("signed-url");
      return "https://x/s";
    });
    expect(opened).toBe(true);
    expect(events).toEqual(["open::_blank", "signed-url"]);
    expect(tab.location.href).toBe("https://x/s");
    expect(tab.opener).toBeNull();
    expect(win.location.href).toBe("/despesas");
  });

  it("closes the empty tab when the URL is refused", async () => {
    const { win, events } = fakeWindow();
    expect(await openReceipt(win, async () => null)).toBe(false);
    expect(events).toEqual(["open::_blank", "close"]);
  });

  it("navigates the current page when no tab can be opened", async () => {
    const { win } = fakeWindow(false);
    expect(await openReceipt(win, async () => "https://x/s")).toBe(true);
    expect(win.location.href).toBe("https://x/s");
  });
});
