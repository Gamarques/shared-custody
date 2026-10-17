import type { ReactNode } from "react";
import { Icon, type IconName } from "../_components/Icon";
import styles from "./auth.module.css";

/** Icon tile + title + lead for the centered auth cards (login, onboarding, invite). */
export function AuthHeader({
  icon,
  title,
  children,
}: {
  icon: IconName | "mail";
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className={styles.head}>
      <span className={styles.tile}>
        {icon === "mail" ? (
          <svg
            width={24}
            height={24}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
            <path d="m4.5 8 7.5 5.5L19.5 8" />
          </svg>
        ) : (
          <Icon name={icon} size={24} />
        )}
      </span>
      <h1 className={styles.title}>{title}</h1>
      {children}
    </header>
  );
}
