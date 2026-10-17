import type { SVGProps } from "react";

/**
 * Inline stroke icons (24×24 grid, 1.75 stroke, round caps), drawn for this app so the shell
 * needs no icon dependency. Decorative by default (aria-hidden); pass `title` when an icon is
 * the only label of a control.
 */
const PATHS = {
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9v10a1 1 0 0 0 1 1h3.5v-5.5h3V20H17a1 1 0 0 0 1-1V9" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  rule: (
    <>
      <path d="M4 8h12.5" />
      <path d="m13.5 4.5 3.5 3.5-3.5 3.5" />
      <path d="M20 16H7.5" />
      <path d="m10.5 12.5-3.5 3.5 3.5 3.5" />
    </>
  ),
  exception: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <path d="m10 13.5 4 4M14 13.5l-4 4" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3.5h12v17l-2.5-1.5-2 1.5-1.5-1.2-1.5 1.2-2-1.5L6 20.5z" />
      <path d="M9 8h6M9 11.5h6M9 15h3.5" />
    </>
  ),
  scale: (
    <>
      <path d="M12 4v16M8 20h8M5 7h14" />
      <path d="m5 7-2.5 6a2.5 2.5 0 0 0 5 0z" />
      <path d="m19 7-2.5 6a2.5 2.5 0 0 0 5 0z" />
    </>
  ),
  invite: (
    <>
      <circle cx="10" cy="8.5" r="3.5" />
      <path d="M3.5 19.5a6.5 6.5 0 0 1 11.2-4.5" />
      <path d="M18.5 14v6M15.5 17h6" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  logout: (
    <>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 16.5 5.5 12 10 7.5M5.5 12H15" />
    </>
  ),
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  swap: (
    <>
      <path d="M7 4.5 3.5 8 7 11.5M3.5 8h13" />
      <path d="m17 12.5 3.5 3.5-3.5 3.5M20.5 16h-13" />
    </>
  ),
  wallet: (
    <>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17v3" />
      <rect x="4" y="8" width="16" height="11" rx="2.5" />
      <circle cx="15.5" cy="13.5" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  child: (
    <>
      <circle cx="12" cy="7" r="3" />
      <path d="M7 20v-4.5a5 5 0 0 1 10 0V20" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

type Props = Omit<SVGProps<SVGSVGElement>, "children"> & { name: IconName; size?: number; title?: string };

export function Icon({ name, size = 20, title, className, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ? `icon ${className}` : "icon"}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
      {...rest}
    >
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  );
}

/** The app's mark: two halves of one home, in the two guardians' colors. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" className="brand-mark">
      <rect width="32" height="32" rx="9" fill="var(--brand-ink)" />
      <path d="M16 7.5 7.5 14.2V24a1 1 0 0 0 1 1H16z" fill="var(--guardian-a)" />
      <path d="M16 7.5 24.5 14.2V24a1 1 0 0 1-1 1H16z" fill="var(--guardian-b)" />
      <circle cx="16" cy="18.5" r="2.6" fill="var(--brand-ink)" />
    </svg>
  );
}
