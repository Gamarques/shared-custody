/**
 * Visual confirmation of write actions (one mechanism for the whole app).
 *
 * - A form calls `showFeedback(code)` after a successful write; the toast mounted in the app
 *   shell (Feedback.tsx) shows the fixed text of that code and hides it after FEEDBACK_DISMISS_MS.
 * - When the action navigates away, the code travels in the URL instead (`withFeedback(path, code)`
 *   adds `?ok=<code>`); the destination shows it and removes the parameter from the address bar.
 * - A native form post whose redirect the server fixes (sign-out) stashes the code in
 *   sessionStorage instead (`stashFeedback`); the next page shows it.
 * - Only codes listed in FEEDBACK_MESSAGES produce text: whatever else arrives in `?ok=` (or the
 *   stash) is ignored, so the URL can never put arbitrary text on screen.
 * - Errors stay inline in each form. `showFeedbackError` exists for the rare action without a form
 *   to hold the message (copying the invite link).
 *
 * This file has no React so the store can be tested in node.
 */

export const FEEDBACK_MESSAGES = {
  "despesa-enviada": "Despesa enviada.",
  "despesa-atualizada": "Despesa atualizada.",
  "despesa-confirmada": "Despesa confirmada.",
  "contestacao-enviada": "Contestação enviada.",
  "despesa-eliminada": "Despesa eliminada.",
  "predefinicao-guardada": "Predefinição guardada.",
  "acerto-registado": "Acerto registado.",
  "excecao-guardada": "Exceção guardada.",
  "excecao-removida": "Exceção removida.",
  "regra-guardada": "Regra guardada.",
  "familia-criada": "Família criada.",
  "convite-criado": "Convite criado.",
  "convite-cancelado": "Convite cancelado.",
  "convite-aceite": "Entraste na família.",
  "ligacao-copiada": "Ligação copiada.",
  "ligacao-enviada": "Ligação enviada.",
  "sessao-iniciada": "Sessão iniciada.",
  "sessao-terminada": "Sessão terminada.",
  "membro-removido": "Membro removido.",
  "familia-eliminada": "Família eliminada.",
} as const;

export type FeedbackCode = keyof typeof FEEDBACK_MESSAGES;

/** Query parameter that carries a code across a navigation. */
export const FEEDBACK_PARAM = "ok";

/** How long a success message stays on screen (the close button hides it sooner). */
export const FEEDBACK_DISMISS_MS = 4000;

export function isFeedbackCode(code: unknown): code is FeedbackCode {
  // Own keys only: "toString" or "__proto__" in the URL must not match.
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(FEEDBACK_MESSAGES, code);
}

/** Fixed text of a code, or null for anything that is not a known code. */
export function feedbackText(code: unknown): string | null {
  return isFeedbackCode(code) ? FEEDBACK_MESSAGES[code] : null;
}

/** `path` with `?ok=<code>` added (other parameters and the hash are kept). For same-origin paths. */
export function withFeedback(path: string, code: FeedbackCode): string {
  const url = new URL(path, "http://x");
  url.searchParams.set(FEEDBACK_PARAM, code);
  return url.pathname + url.search + url.hash;
}

/** The query string (with "?", or "") once the feedback parameter is removed. */
export function searchWithoutFeedback(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(FEEDBACK_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

// --- Across a full page load without a URL we control ------------------------------------------

/** sessionStorage key for `stashFeedback`. */
export const FEEDBACK_STASH_KEY = "gp-feedback";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null; // Storage disabled (private mode, policies): no message, nothing breaks.
  }
}

/**
 * Keeps a code for the next page this tab loads. For a native form post whose redirect target is
 * fixed by the server (sign-out goes to /login), where `?ok=` cannot be added.
 */
export function stashFeedback(code: FeedbackCode, storage: KeyValueStorage | null = browserStorage()): void {
  try {
    storage?.setItem(FEEDBACK_STASH_KEY, code);
  } catch {
    // Quota or disabled storage: the message is a nicety, the action already happened.
  }
}

/** Reads and clears the stashed code; only known codes come back. */
export function takeStashedFeedback(storage: KeyValueStorage | null = browserStorage()): FeedbackCode | null {
  try {
    const code = storage?.getItem(FEEDBACK_STASH_KEY) ?? null;
    if (code !== null) storage?.removeItem(FEEDBACK_STASH_KEY);
    return isFeedbackCode(code) ? code : null;
  } catch {
    return null;
  }
}

// --- Store -------------------------------------------------------------------------------------

export type Feedback = { id: number; tone: "success" | "error"; text: string };

let current: Feedback | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function stopTimer() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function startTimer() {
  stopTimer();
  if (current?.tone !== "success") return;
  const id = current.id;
  timer = setTimeout(() => dismissFeedback(id), FEEDBACK_DISMISS_MS);
}

/** Shows the success text of `code`; an unknown code shows nothing. */
export function showFeedback(code: unknown): void {
  const text = feedbackText(code);
  if (text === null) return;
  current = { id: ++seq, tone: "success", text };
  startTimer();
  emit();
}

/** Shows an error (role="alert"). It stays until closed or replaced: errors do not time out. */
export function showFeedbackError(text: string): void {
  current = { id: ++seq, tone: "error", text };
  stopTimer();
  emit();
}

/** Hides the message (only message `id` when given, so a stale timer cannot hide a newer one). */
export function dismissFeedback(id?: number): void {
  if (current === null || (id !== undefined && current.id !== id)) return;
  current = null;
  stopTimer();
  emit();
}

/** Pointer or keyboard focus on the message: keep it on screen. */
export function holdFeedback(): void {
  stopTimer();
}

/** Pointer or focus left the message: restart the countdown. */
export function releaseFeedback(): void {
  startTimer();
}

export function subscribeFeedback(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getFeedback(): Feedback | null {
  return current;
}

/** Nothing is shown in the server render: the store only fills in the browser. */
export function getServerFeedback(): Feedback | null {
  return null;
}
