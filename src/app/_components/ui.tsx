import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/**
 * Shared building blocks. Each one is a thin wrapper over the class API documented in
 * globals.css ("Component API"), so pages can use either the component or the classes.
 */

function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

/** Page title row: title, optional subtitle and actions aligned right (stacked on phones). */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/** Surface for one block of content; `title`/`action` render a header row inside it. */
export function Card({
  title,
  eyebrow,
  action,
  className,
  children,
  as: Tag = "section",
  ...rest
}: {
  title?: ReactNode;
  eyebrow?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
  as?: "section" | "div" | "article";
  "data-testid"?: string;
}) {
  return (
    <Tag className={cx("card", className)} {...rest}>
      {(title || eyebrow || action) && (
        <div className="card-header">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && <h2 className="card-title">{title}</h2>}
          </div>
          {action}
        </div>
      )}
      {children}
    </Tag>
  );
}

/** One number with its label, a hint line and an icon. */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone,
  href,
  ...rest
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: IconName;
  /** Colors the hint: "up" (good), "down" (attention). */
  tone?: "up" | "down";
  href?: string;
  "data-testid"?: string;
}) {
  const body = (
    <>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {icon && (
          <span className="stat-icon">
            <Icon name={icon} size={18} />
          </span>
        )}
      </div>
      <div className="stat-value">{value}</div>
      {hint && <div className={cx("stat-hint", tone && `stat-hint-${tone}`)}>{hint}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="card stat stat-link" {...rest}>
      {body}
    </Link>
  ) : (
    <div className="card stat" {...rest}>
      {body}
    </div>
  );
}

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/** Placeholder for a list or section with nothing to show yet, with the next step. */
export function EmptyState({
  icon = "info",
  title,
  children,
  action,
}: {
  icon?: IconName;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">
        <Icon name={icon} size={22} />
      </span>
      <p className="empty-state-title">{title}</p>
      {children && <div className="empty-state-text">{children}</div>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
