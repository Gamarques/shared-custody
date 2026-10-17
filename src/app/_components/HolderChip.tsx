import Link from "next/link";
import { buildTodayView, type TodayView } from "@/lib/custody/today";
import { loadFamilySnapshot, type FamilySnapshot } from "./family-snapshot";
import { Icon } from "./Icon";

/** Today view from the snapshot's rows, or null without a family. */
export function todayFromSnapshot(snap: FamilySnapshot): TodayView | null {
  const family = snap.family;
  if (!family) return null;
  const child = [...(family.children ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  return buildTodayView({
    now: new Date(snap.nowMs),
    timezone: family.timezone,
    members: family.members ?? [],
    rules: family.custody_rules ?? [],
    overrides: family.custody_overrides ?? [],
    childName: child?.name ?? null,
  });
}

/** Sidebar footer: who has the child right now and when it changes. */
export async function HolderChip() {
  let view: TodayView | null = null;
  try {
    view = todayFromSnapshot(await loadFamilySnapshot());
  } catch {
    view = null; // the chip is a convenience: never break the page for it
  }
  if (!view) return null;

  if (view.kind === "no-rule" || !view.current) {
    return (
      <Link href="/guarda" className="holder-chip">
        <span className="holder-chip-dot" aria-hidden="true" />
        <span className="holder-chip-text">
          <span className="holder-chip-label">{view.childName}</span>
          <span className="holder-chip-value">
            {view.kind === "no-rule" ? "Definir a regra de guarda" : "A guarda ainda não começou."}
          </span>
        </span>
        <Icon name="chevronRight" size={16} className="holder-chip-chevron" />
      </Link>
    );
  }

  return (
    <Link href="/calendario" className="holder-chip">
      <span className="holder-chip-dot" style={{ background: view.current.color ?? undefined }} aria-hidden="true" />
      <span className="holder-chip-text">
        <span className="holder-chip-label">{view.childName} está com</span>
        <span className="holder-chip-value">{view.current.name}</span>
        {view.next && <span className="holder-chip-meta">Troca {view.next.when}</span>}
      </span>
      <Icon name="chevronRight" size={16} className="holder-chip-chevron" />
    </Link>
  );
}
