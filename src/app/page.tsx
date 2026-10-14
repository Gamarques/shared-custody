import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/env";

export default function Home() {
  const configured = isSupabaseConfigured();

  return (
    <main>
      <h1>Guarda Compartilhada</h1>
      <p>Com quem a criança está hoje, a próxima troca e as despesas divididas entre os dois responsáveis.</p>
      <p className="status" data-testid="supabase-status">
        {configured ? "Supabase configurado." : "Supabase ainda não configurado (ver .env.example)."}
      </p>
      {configured && (
        <>
          <p>
            <Link href="/guarda">Regra de guarda</Link>
          </p>
          <p>
            <Link href="/convidar">Convidar o outro responsável</Link>
          </p>
        </>
      )}
    </main>
  );
}
