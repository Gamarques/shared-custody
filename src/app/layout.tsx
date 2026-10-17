import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { SessionBar } from "./SessionBar";
import { ServiceWorkerRegister } from "./ServiceWorkerRegister";
import { AppShell } from "./_components/AppShell";
import { loadFamilySnapshot } from "./_components/family-snapshot";
import { HolderChip } from "./_components/HolderChip";
import { THEME_COLOR } from "@/lib/pwa/manifest";
import { isDemoMode } from "@/lib/demo/mode";
import { isSupabaseConfigured } from "@/lib/env";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });

export const metadata: Metadata = {
  title: "Guarda Compartilhada",
  description: "Guarda semanal alternada e despesas divididas entre os dois responsáveis.",
  applicationName: "Guarda Compartilhada",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Guarda", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the tab bar and header pad themselves with env(safe-area-inset-*) on iOS.
  viewportFit: "cover",
  themeColor: THEME_COLOR,
};

async function hasSession(): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    return Boolean((await loadFamilySnapshot()).user);
  } catch {
    return false;
  }
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const signedIn = await hasSession();
  return (
    <html lang="pt" className={sans.variable}>
      <body>
        <ServiceWorkerRegister />
        <AppShell
          signedIn={signedIn}
          banner={
            isDemoMode() && (
              <div className="demo-banner" role="status" data-testid="demo-banner">
                <strong>DEMO</strong> · dados fictícios em memória, sem Supabase. Sessão da Ana. Reiniciar o servidor repõe
                os dados.
              </div>
            )
          }
          account={<SessionBar />}
          holder={<HolderChip />}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
