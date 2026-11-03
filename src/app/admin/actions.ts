"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { adminErrorMessage, type AdminActionResult } from "@/lib/admin/admin";
import { isAppAdmin } from "@/lib/auth/admin";
import { RECEIPT_BUCKET } from "@/lib/receipts/receipts";
import { createClient } from "@/lib/supabase/server";

// Server Actions are reachable by a direct POST, so each one checks the caller again. The real
// gate is the database: every admin RPC raises 42501 unless is_app_admin() is true for the
// caller's own token. No service role key is used anywhere.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 100;

export async function removeMemberAction(familyId: string, userId: string): Promise<AdminActionResult> {
  if (!UUID.test(familyId) || !UUID.test(userId)) return { ok: false, error: adminErrorMessage("P0002") };
  if (!(await isAppAdmin())) return { ok: false, error: adminErrorMessage("42501") };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_remove_member", { p_family_id: familyId, p_user_id: userId });
  if (error) return { ok: false, error: adminErrorMessage(error.code) };
  refresh();
  return { ok: true };
}

export async function deleteFamilyAction(familyId: string): Promise<AdminActionResult> {
  if (!UUID.test(familyId)) return { ok: false, error: adminErrorMessage("P0002") };
  if (!(await isAppAdmin())) return { ok: false, error: adminErrorMessage("42501") };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_delete_family", { p_family_id: familyId });
  if (error) return { ok: false, error: adminErrorMessage(error.code) };
  const left = await removeReceipts(supabase.storage, familyId);
  // The family card is gone after the refresh, so a partial result is shown by the page itself.
  if (left > 0) redirect(`/admin?aviso=recibos&familia=${familyId}`);
  refresh();
  return { ok: true };
}

type ReceiptBucket = {
  list(path: string, options: { limit: number }): PromiseLike<{ data: { name: string; id: string | null }[] | null; error: unknown }>;
  remove(paths: string[]): PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * Removes the receipt photos under '<family_id>/' through the Storage API (the admin storage
 * policies allow it), so the files are deleted, not only their rows. Returns 0 when the folder
 * is empty afterwards, otherwise a positive number (files left or the listing failed).
 */
async function removeReceipts(storage: { from(bucket: string): unknown }, familyId: string): Promise<number> {
  const bucket = storage.from(RECEIPT_BUCKET) as ReceiptBucket;
  // Bounded: 50 pages of 100 is far more than a family has.
  for (let page = 0; page < 50; page++) {
    const { data, error } = await bucket.list(familyId, { limit: PAGE });
    if (error || !data) return 1;
    const files = data.filter((o) => o.id !== null).map((o) => `${familyId}/${o.name}`);
    if (files.length === 0) return 0;
    const removed = await bucket.remove(files);
    if (removed.error) return files.length;
  }
  return 1;
}
