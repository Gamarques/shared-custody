"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatCountdown } from "@/lib/custody/today";

type Props = {
  /** Handover instant (ms since epoch). */
  atMs: number;
  /** Server clock at render time, so the first client render matches the HTML. */
  nowMs: number;
};

/** Live countdown to the next handover; reloads the home data once the handover happens. */
export function HandoverCountdown({ atMs, nowMs }: Props) {
  const router = useRouter();
  const [now, setNow] = useState(nowMs);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (now >= atMs) router.refresh();
  }, [now, atMs, router]);

  return <span data-testid="countdown">{formatCountdown(now, atMs)}</span>;
}
