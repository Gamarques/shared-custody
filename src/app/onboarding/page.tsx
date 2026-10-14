import { isSupabaseConfigured } from "@/lib/env";
import { OnboardingForm } from "./OnboardingForm";

export default function OnboardingPage() {
  return (
    <main>
      <h1>Bem-vindo</h1>
      <p>Crie a família, escolha como você aparece e sua cor no calendário. O outro responsável é convidado depois.</p>
      {isSupabaseConfigured() ? <OnboardingForm /> : <p>Supabase ainda não configurado (ver .env.example).</p>}
    </main>
  );
}
