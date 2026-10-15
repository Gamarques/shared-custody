import { timingSafeEqual } from "node:crypto";
import type { PublicEnv } from "@/lib/env";

/**
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when the CRON_SECRET env var is set.
 * Without a configured secret nobody is authorized, so the endpoint cannot be used by strangers.
 */
export function isAuthorizedCron(authorization: string | null, secret: string | undefined): boolean {
  const expected = secret?.trim();
  if (!expected || !authorization) return false;
  const a = Buffer.from(authorization);
  const b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type PingResult = { ok: true; dbTime: string; ms: number } | { ok: false; status: number | null; error: string; ms: number };

/**
 * Runs one real query on the Supabase Postgres (the keepalive_ping RPC) so the free project
 * counts as active. Never throws: network and HTTP errors are returned as { ok: false }.
 */
export async function pingSupabase(
  env: PublicEnv,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<PingResult> {
  const started = now();
  try {
    const res = await fetchImpl(`${env.supabaseUrl}/rest/v1/rpc/keepalive_ping`, {
      method: "POST",
      headers: {
        apikey: env.supabaseAnonKey,
        Authorization: `Bearer ${env.supabaseAnonKey}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      cache: "no-store",
    });
    const body = await res.text();
    if (!res.ok) return { ok: false, status: res.status, error: body.slice(0, 500), ms: now() - started };
    return { ok: true, dbTime: JSON.parse(body) as string, ms: now() - started };
  } catch (e) {
    return { ok: false, status: null, error: e instanceof Error ? e.message : String(e), ms: now() - started };
  }
}
