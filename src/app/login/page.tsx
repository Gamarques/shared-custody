import Link from "next/link";
import { isDemoMode } from "@/lib/demo/mode";
import { isSupabaseConfigured } from "@/lib/env";
import { safeNextPath } from "@/lib/auth/paths";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main>
      <h1>Entrar</h1>
      <p>Enviaremos um link de acesso para o seu e-mail. Sem senha.</p>
      {isDemoMode() && (
        <p className="status">
          Modo demo: não há login, a sessão da Ana já está aberta. <Link href="/">Ir para o início</Link>
        </p>
      )}
      {error && <p role="alert">O link é inválido ou expirou. Peça um novo.</p>}
      {isSupabaseConfigured() ? (
        <LoginForm next={safeNextPath(next)} />
      ) : (
        <p>Supabase ainda não configurado (ver .env.example).</p>
      )}
    </main>
  );
}
