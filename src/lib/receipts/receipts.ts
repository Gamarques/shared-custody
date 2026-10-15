/** Receipt storage helpers (RNF-08, T-14): bucket, object path and signed URL. */

export const RECEIPT_BUCKET = "receipts";
/** Signed URLs are short-lived; a new one is requested every time a receipt is opened. */
export const RECEIPT_URL_TTL_SECONDS = 60;

/** '<family_id>/<id>.jpg': the first folder is what the Storage policies check. */
export function receiptPath(familyId: string, id: string): string {
  return `${familyId}/${id}.jpg`;
}

export function belongsToFamily(path: string, familyId: string): boolean {
  return path.startsWith(`${familyId}/`);
}

type StorageLike = {
  from(bucket: string): {
    createSignedUrl(path: string, expiresIn: number): Promise<{ data: { signedUrl: string } | null; error: unknown }>;
  };
};

/** Signed URL for a receipt, or null when the caller is not allowed or the file is missing. */
export async function getReceiptUrl(storage: StorageLike, path: string): Promise<string | null> {
  const { data, error } = await storage.from(RECEIPT_BUCKET).createSignedUrl(path, RECEIPT_URL_TTL_SECONDS);
  return error || !data ? null : data.signedUrl;
}

type TabLike = { opener: unknown; location: { href: string }; close(): void };
type WindowLike = { open(url: string, target: string): TabLike | null; location: { href: string } };

/**
 * Opens a receipt in a new tab. The tab is opened synchronously, inside the tap, and only then
 * pointed at the signed URL: Safari on iOS blocks `window.open` called after an `await` (the
 * signed URL request) as an unrequested pop-up (T-24). When no tab can be opened, the current
 * one navigates instead. Returns false when the URL could not be obtained.
 */
export async function openReceipt(win: WindowLike, getUrl: () => Promise<string | null>): Promise<boolean> {
  const tab = win.open("", "_blank");
  const url = await getUrl();
  if (!url) {
    tab?.close();
    return false;
  }
  if (tab) {
    tab.opener = null; // same effect as "noopener" for the receipt page
    tab.location.href = url;
  } else {
    win.location.href = url;
  }
  return true;
}
