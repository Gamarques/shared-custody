"use client";

import { useEffect, useRef, useState } from "react";
import { textColorOn } from "@/lib/custody/today";
import { Icon } from "./Icon";

type Props = { name: string | null; email: string | null; color: string | null };

/** "Ana Silva" -> "AS", "ana@x.pt" -> "A". */
export function initialsOf(text: string): string {
  const words = text.split("@")[0].split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? "?").slice(0, 1);
  return letters.toUpperCase();
}

/** Avatar button in the header; opens a small menu with who is signed in and "Sair". */
export function UserMenu({ name, email, color }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const label = name ?? email ?? "Conta";
  const avatarStyle = color ? { background: color, color: textColorOn(color) } : undefined;

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        type="button"
        className="user-menu-trigger"
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls="conta"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="avatar" style={avatarStyle}>
          {initialsOf(label)}
        </span>
        <span className="user-menu-name">{label}</span>
        <Icon name="chevronDown" size={16} className="user-menu-chevron" />
      </button>
      <div id="conta" className="user-menu-panel" data-open={open ? "true" : undefined} hidden={!open}>
        <div className="user-menu-who">
          <span className="avatar avatar-lg" style={avatarStyle}>
            {initialsOf(label)}
          </span>
          <span>
            {name && <strong>{name}</strong>}
            {email && <span className="user-menu-email">{email}</span>}
          </span>
        </div>
        <form action="/auth/signout" method="post" className="session-bar" data-testid="session-bar">
          <button type="submit" className="user-menu-item">
            <Icon name="logout" size={18} />
            Sair
          </button>
        </form>
      </div>
    </div>
  );
}
