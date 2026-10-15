import { isSupabaseConfigured } from "@/lib/env";
import { currentMonth, formatMonth, parseMonth } from "@/lib/custody/calendar";
import { csvFilename, expensesToCsv, type CsvExpense } from "@/lib/expenses/expense-csv";
import { monthDateRange } from "@/lib/expenses/expense-list";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** CSV of the family's non-deleted expenses in `?mes=YYYY-MM` (default: current month), RF-15. */
export async function GET(request: Request) {
  if (!isSupabaseConfigured()) return new Response("Supabase não configurado.", { status: 503 });

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return new Response("Não autenticado.", { status: 401 });

  const { data: me } = await supabase
    .from("members")
    .select("family_id, families(timezone)")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  const mine = me as { family_id: string; families: { timezone: string } | null } | null;
  if (!mine?.families) return new Response("Família não encontrada.", { status: 404 });

  const mes = new URL(request.url).searchParams.get("mes");
  const month = mes && parseMonth(mes) ? mes : formatMonth(currentMonth(Date.now(), mine.families.timezone));
  const { from, to } = monthDateRange(month);

  const [{ data: memberData }, { data, error }] = await Promise.all([
    supabase.from("members").select("id, display_name").eq("family_id", mine.family_id),
    supabase
      .from("expenses")
      .select("paid_by, amount_cents, spent_on, description, category, payer_share_bps, status")
      .eq("family_id", mine.family_id)
      .is("deleted_at", null)
      .gte("spent_on", from)
      .lt("spent_on", to)
      .order("spent_on", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);
  if (error) return new Response("Não foi possível exportar as despesas.", { status: 500 });

  const names = Object.fromEntries(
    ((memberData ?? []) as { id: string; display_name: string }[]).map((m) => [m.id, m.display_name]),
  );
  return new Response(expensesToCsv((data ?? []) as CsvExpense[], names), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFilename(month)}"`,
      "Cache-Control": "no-store",
    },
  });
}
