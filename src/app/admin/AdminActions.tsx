"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { confirmsFamilyName } from "@/lib/admin/admin";
import { deleteFamilyAction, removeMemberAction } from "./actions";
import styles from "./admin.module.css";

/** Centered modal confirmation (same pattern as deleting an expense): Esc or the backdrop closes it. */
function ConfirmDialog({
  open,
  onClose,
  titleId,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  titleId: string;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <h2 id={titleId} className={styles.dialogTitle}>
        {title}
      </h2>
      {children}
    </dialog>
  );
}

export function RemoveMemberButton({
  familyId,
  familyName,
  userId,
  memberName,
}: {
  familyId: string;
  familyName: string;
  userId: string;
  memberName: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError("");
    startTransition(async () => {
      const result = await removeMemberAction(familyId, userId);
      if (result.ok) setOpen(false);
      else setError(result.error);
    });
  }

  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" aria-expanded={open} onClick={() => setOpen(true)}>
        Remover da família
      </button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} titleId={`remove-${familyId}-${userId}`} title={`Remover ${memberName}?`}>
        <p className={styles.dialogText}>
          {memberName} deixa de pertencer a «{familyName}». As exceções e versões da regra de guarda que referem este membro são
          apagadas, tal como os convites pendentes que criou. A conta continua a existir: no próximo acesso pode criar ou juntar-se a
          uma família.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className={styles.dialogButtons}>
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => setOpen(false)}>
            Cancelar
          </button>
          <button type="button" className="btn btn-danger" disabled={pending} onClick={confirm}>
            {pending ? "A remover…" : "Remover da família"}
          </button>
        </div>
      </ConfirmDialog>
    </>
  );
}

export function DeleteFamilyButton({ familyId, familyName }: { familyId: string; familyName: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const matches = confirmsFamilyName(typed, familyName);
  const inputId = `confirm-${familyId}`;

  function close() {
    setOpen(false);
    setTyped("");
    setError("");
  }

  function confirm() {
    if (!matches) return;
    setError("");
    startTransition(async () => {
      const result = await deleteFamilyAction(familyId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      close();
    });
  }

  return (
    <>
      <button type="button" className="btn btn-danger btn-sm" aria-expanded={open} onClick={() => setOpen(true)}>
        Eliminar família
      </button>
      <ConfirmDialog open={open} onClose={close} titleId={`delete-${familyId}`} title={`Eliminar «${familyName}»?`}>
        <p className={styles.dialogText}>
          <strong>Esta ação é irreversível.</strong> São apagados os membros, a criança, as regras de guarda, as exceções, as despesas
          com todo o histórico, os acertos, os convites e as fotografias dos recibos. As contas dos membros continuam a existir.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            confirm();
          }}
        >
          <div className="field">
            <label htmlFor={inputId}>Escreve o nome da família para confirmar</label>
            <input
              id={inputId}
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={typed}
              placeholder={familyName}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
          {error && <p role="alert">{error}</p>}
          <div className={styles.dialogButtons}>
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={close}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-danger" disabled={pending || !matches}>
              {pending ? "A eliminar…" : "Eliminar definitivamente"}
            </button>
          </div>
        </form>
      </ConfirmDialog>
    </>
  );
}
