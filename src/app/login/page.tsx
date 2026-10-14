import { isSupabaseConfigured } from "@/lib/env";
import { safeNextPath } from "@/lib/auth/paths";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main>
      <h1>Entrar</h1>
      <p>Enviaremos um link de acesso para o seu e-mail. Sem senha.</p>
      {error && <p role="alert">O link é inválido ou expirou. Peça um novo.</p>}
      {isSupabaseConfigured() ? (
        <LoginForm next={safeNextPath(next)} />
      ) : (
        <p>Supabase ainda não configurado (ver .env.example).</p>
      )}
    </main>
  );
}
