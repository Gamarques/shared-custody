import type { MetadataRoute } from "next";

export const THEME_COLOR = "#1d4e89";

export function buildManifest(): MetadataRoute.Manifest {
  return {
    name: "Guarda Compartilhada",
    short_name: "Guarda",
    description: "Guarda semanal alternada e despesas divididas entre os dois responsáveis.",
    lang: "pt",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: THEME_COLOR,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
