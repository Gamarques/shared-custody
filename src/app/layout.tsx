import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SessionBar } from "./SessionBar";
import { ServiceWorkerRegister } from "./ServiceWorkerRegister";
import { THEME_COLOR } from "@/lib/pwa/manifest";
import { isDemoMode } from "@/lib/demo/mode";

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
  themeColor: THEME_COLOR,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt">
      <body>
        {isDemoMode() && (
          <div className="demo-banner" role="status" data-testid="demo-banner">
            <strong>DEMO</strong> · dados fictícios em memória, sem Supabase. Sessão da Ana. Reiniciar o servidor repõe os
            dados.
          </div>
        )}
        <ServiceWorkerRegister />
        <SessionBar />
        {children}
      </body>
    </html>
  );
}
