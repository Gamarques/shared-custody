import Link from "next/link";
import { isDemoMode } from "@/lib/demo/mode";
import { isSupabaseConfigured } from "@/lib/env";
import { safeNextPath } from "@/lib/auth/paths";
import { AuthHeader } from "../_auth/AuthHeader";
import styles from "../_auth/auth.module.css";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main>
      <AuthHeader icon="mail" title="Entrar">
        <p>Enviaremos um link de acesso para o seu e-mail. Sem senha.</p>
      </AuthHeader>
      {isDemoMode() && (
        <div className={styles.note}>
          <p className="status">Modo demo: não há login, a sessão da Ana já está aberta.</p>
          <Link href="/" className="btn btn-secondary">
            Ir para o início
          </Link>
        </div>
      )}
      {error && <p role="alert">O link é inválido ou expirou. Peça um novo.</p>}
      {isSupabaseConfigured() ? (
        <LoginForm next={safeNextPath(next)} />
      ) : (
        <p className={styles.note}>Supabase ainda não configurado (ver .env.example).</p>
      )}
    </main>
  );
}
