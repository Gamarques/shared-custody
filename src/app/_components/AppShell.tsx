"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrandMark, Icon } from "./Icon";
import { breadcrumbFor, isActive, isAuthPath, NAV_ITEMS, PRIMARY_HREFS } from "./nav";

type Props = {
  /** Without a session the shell falls back to the centered auth layout. */
  signedIn: boolean;
  /** Demo-mode notice, shown above the content column (so the sidebar keeps the full height). */
  banner?: ReactNode;
  /** Avatar menu with "Sair" (server-rendered). */
  account: ReactNode;
  /** "Who has the child now" chip for the sidebar footer (server-rendered). */
  holder: ReactNode;
  children: ReactNode;
};

const PRIMARY = NAV_ITEMS.filter((item) => (PRIMARY_HREFS as readonly string[]).includes(item.href));
const SECONDARY = NAV_ITEMS.filter((item) => !(PRIMARY_HREFS as readonly string[]).includes(item.href));

/**
 * App chrome: sidebar on desktop (≥1024px), sticky header everywhere, bottom tab bar with a
 * "Mais" sheet on phones. Login, onboarding and invite pages get a centered layout instead.
 */
export function AppShell({ signedIn, banner, account, holder, children }: Props) {
  const pathname = usePathname() ?? "/";

  if (!signedIn || isAuthPath(pathname)) {
    return (
      <div className="auth-layout">
        {banner}
        <div className="auth-brand">
          <BrandMark size={36} />
          <span>Guarda Compartilhada</span>
        </div>
        <div className="auth-card">{children}</div>
      </div>
    );
  }

  const crumbs = breadcrumbFor(pathname);

  return (
    <div className="app">
      {banner}
      <a className="skip-link" href="#conteudo">
        Ir para o conteúdo
      </a>

      <aside className="sidebar" aria-label="Navegação principal">
        <Link href="/" className="sidebar-brand">
          <BrandMark />
          <span>Guarda Compartilhada</span>
        </Link>
        <nav className="sidebar-nav" aria-label="Seções">
          <ul>
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.href, pathname);
              return (
                <li key={item.href}>
                  <Link href={item.href} className="sidebar-link" aria-current={active ? "page" : undefined}>
                    <Icon name={item.icon} />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="sidebar-footer">{holder}</div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <Link href="/" className="topbar-brand" aria-label="Início">
            <BrandMark size={28} />
          </Link>
          <nav className="breadcrumb" aria-label="Você está em">
            <ol>
              {crumbs.map((crumb, i) => (
                <li key={crumb.label} aria-current={i === crumbs.length - 1 ? "page" : undefined}>
                  {crumb.href ? <Link href={crumb.href}>{crumb.label}</Link> : <span>{crumb.label}</span>}
                </li>
              ))}
            </ol>
          </nav>
          <div className="topbar-actions">{account}</div>
        </header>
        <div className="app-content" id="conteudo">
          {children}
        </div>
      </div>

      <TabBar pathname={pathname} />
    </div>
  );
}

function TabBar({ pathname }: { pathname: string }) {
  // Open for the path it was opened on: navigating anywhere closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const moreActive = SECONDARY.some((item) => isActive(item.href, pathname));
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Move focus into the sheet (not onto a control, so no ring flashes on touch).
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenOn(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <nav className="tabbar" aria-label="Seções">
        {PRIMARY.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="tabbar-item"
            aria-current={!open && isActive(item.href, pathname) ? "page" : undefined}
          >
            <Icon name={item.icon} size={22} />
            <span>{item.label}</span>
          </Link>
        ))}
        <button
          type="button"
          className="tabbar-item"
          aria-expanded={open}
          aria-controls="mais"
          data-active={open || moreActive ? "true" : undefined}
          onClick={() => setOpenOn(open ? null : pathname)}
        >
          <Icon name="more" size={22} />
          <span>Mais</span>
        </button>
      </nav>

      <div className="sheet-backdrop" data-open={open ? "true" : undefined} onClick={() => setOpenOn(null)} />
      <div
        id="mais"
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Mais seções"
        data-open={open ? "true" : undefined}
        tabIndex={-1}
        inert={!open}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-header">
          <span>Mais</span>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setOpenOn(null)}>
            <Icon name="close" title="Fechar" />
          </button>
        </div>
        <ul className="sheet-list">
          {SECONDARY.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="sheet-link"
                aria-current={isActive(item.href, pathname) ? "page" : undefined}
                onClick={() => setOpenOn(null)}
              >
                <span className="sheet-link-icon">
                  <Icon name={item.icon} />
                </span>
                <span>{item.label}</span>
                <Icon name="chevronRight" size={18} className="sheet-link-chevron" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
