import Link from "next/link";
import { isDemoMode } from "@/lib/demo/mode";
import { isSupabaseConfigured } from "@/lib/env";
import { safeNextPath } from "@/lib/auth/paths";
import { AuthHeader } from "../_auth/AuthHeader";
import styles from "../_auth/auth.module.css";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; modo?: string }> }) {
  const { next, error, modo } = await searchParams;
  return (
    <main>
      <AuthHeader icon="mail" title="Entrar">
        <p>Vamos enviar uma ligação de acesso para o teu e-mail.</p>
      </AuthHeader>
      {isDemoMode() && (
        <div className={styles.note}>
          <p className="status">Modo demo: sem autenticação, a sessão da Ana já está aberta.</p>
          <Link href="/" className="btn btn-secondary">
            Ir para o início
          </Link>
        </div>
      )}
      {error && <p role="alert">A ligação é inválida ou expirou. Pede uma nova.</p>}
      {isSupabaseConfigured() ? (
        // The password form is only for accounts created in the dashboard (the admin): it is reached
        // by typing /login?modo=palavra-passe and is not linked from anywhere in the app.
        <LoginForm next={safeNextPath(next)} mode={modo === "palavra-passe" ? "password" : "link"} />
      ) : (
        <p className={styles.note}>Supabase ainda não configurado (ver .env.example).</p>
      )}
    </main>
  );
}
