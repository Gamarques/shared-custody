import type { IconName } from "./Icon";

export type NavItem = { href: string; label: string; icon: IconName };

/** Every section of the app, in sidebar order. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Início", icon: "home" },
  { href: "/calendario", label: "Calendário", icon: "calendar" },
  { href: "/guarda", label: "Regra de guarda", icon: "rule" },
  { href: "/excecoes", label: "Exceções", icon: "exception" },
  { href: "/despesas", label: "Despesas", icon: "receipt" },
  { href: "/saldo", label: "Saldo", icon: "scale" },
  { href: "/convidar", label: "Convidar", icon: "invite" },
];

/** The bottom tab bar on phones shows these; the rest go under "Mais". */
export const PRIMARY_HREFS = ["/", "/calendario", "/despesas", "/saldo"] as const;

/** Pages that render without the app chrome (centered auth layout). */
export function isAuthPath(pathname: string): boolean {
  return pathname === "/login" || pathname === "/onboarding" || pathname.startsWith("/convite/");
}

export function isActive(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export type Crumb = { label: string; href?: string };

/** Header trail for a path: the section, then the sub-page when there is one. */
export function breadcrumbFor(pathname: string): Crumb[] {
  const section = NAV_ITEMS.find((item) => item.href !== "/" && isActive(item.href, pathname));
  if (!section) return [{ label: "Início" }];
  if (pathname === section.href) return [{ label: section.label }];
  const sub = pathname.endsWith("/nova")
    ? "Nova despesa"
    : pathname.endsWith("/editar")
      ? "Editar"
      : pathname.endsWith("/historico")
        ? "Histórico"
        : null;
  return sub ? [{ label: section.label, href: section.href }, { label: sub }] : [{ label: section.label }];
}
