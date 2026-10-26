import { isSupabaseConfigured } from "@/lib/env";
import { AuthHeader } from "../_auth/AuthHeader";
import styles from "../_auth/auth.module.css";
import { OnboardingForm } from "./OnboardingForm";

export default function OnboardingPage() {
  return (
    <main>
      <AuthHeader icon="home" title="Bem-vindo">
        <p>Cria a família, escolhe como apareces e a tua cor no calendário. O outro responsável é convidado depois.</p>
      </AuthHeader>
      {isSupabaseConfigured() ? (
        <OnboardingForm />
      ) : (
        <p className={styles.note}>Supabase ainda não configurado (ver .env.example).</p>
      )}
      <p className={styles.footnote}>Recebeste um convite? Abre a ligação do convite em vez de criar uma nova família.</p>
    </main>
  );
}
