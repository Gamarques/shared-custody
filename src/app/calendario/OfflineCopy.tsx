"use client";

import { useEffect, useState } from "react";
import { cachePagesMessage, pagesToCache, requestOfflineCopy, staticAssets } from "@/lib/pwa/offline";

/**
 * Keeps an offline copy of the month on screen (RF-16) and, without a connection, says that
 * what is shown is the copy saved on this device.
 */
export function OfflineCopy({ canonicalPath }: { canonicalPath: string }) {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (!navigator.onLine) return;
    const { origin, href } = window.location;
    const loaded = [
      ...performance.getEntriesByType("resource").map((e) => e.name),
      ...Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"), (s) => s.src),
      ...Array.from(document.querySelectorAll<HTMLLinkElement>("link[rel=stylesheet]"), (l) => l.href),
    ];
    const message = cachePagesMessage(pagesToCache(href, canonicalPath, origin), staticAssets(loaded, origin));
    requestOfflineCopy(navigator.serviceWorker, message).catch(() => {});
  }, [canonicalPath]);

  if (!offline) return null;
  return (
    <p className="offline-notice" role="status" data-testid="offline-notice">
      Sem ligação: este é o calendário guardado neste dispositivo e pode estar desatualizado.
    </p>
  );
}
