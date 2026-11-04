import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dismissFeedback,
  FEEDBACK_DISMISS_MS,
  FEEDBACK_MESSAGES,
  FEEDBACK_STASH_KEY,
  feedbackText,
  getFeedback,
  holdFeedback,
  isFeedbackCode,
  releaseFeedback,
  searchWithoutFeedback,
  showFeedback,
  showFeedbackError,
  stashFeedback,
  subscribeFeedback,
  takeStashedFeedback,
  withFeedback,
} from "./feedback-store";

describe("feedback codes", () => {
  it("maps each code to its fixed pt-PT text", () => {
    expect(feedbackText("despesa-enviada")).toBe("Despesa enviada.");
    expect(feedbackText("contestacao-enviada")).toBe("Contestação enviada.");
    expect(feedbackText("despesa-confirmada")).toBe("Despesa confirmada.");
    expect(feedbackText("acerto-registado")).toBe("Acerto registado.");
    expect(feedbackText("excecao-guardada")).toBe("Exceção guardada.");
    expect(feedbackText("regra-guardada")).toBe("Regra guardada.");
    expect(feedbackText("convite-criado")).toBe("Convite criado.");
    expect(feedbackText("ligacao-copiada")).toBe("Ligação copiada.");
    for (const text of Object.values(FEEDBACK_MESSAGES)) expect(text).toMatch(/^\p{Lu}.*\.$/u);
  });

  it("unknown codes (and prototype keys, other types, text) give nothing", () => {
    for (const code of ["", "nope", "Despesa enviada.", "toString", "__proto__", "constructor", "DESPESA-ENVIADA", null, undefined, 1, {}]) {
      expect(feedbackText(code)).toBeNull();
      expect(isFeedbackCode(code)).toBe(false);
    }
  });

  it("withFeedback adds ?ok= and keeps the path, other parameters and the hash", () => {
    expect(withFeedback("/", "familia-criada")).toBe("/?ok=familia-criada");
    expect(withFeedback("/despesas", "despesa-atualizada")).toBe("/despesas?ok=despesa-atualizada");
    expect(withFeedback("/admin?vista=utilizadores#x", "sessao-iniciada")).toBe("/admin?vista=utilizadores&ok=sessao-iniciada#x");
    expect(withFeedback("/?ok=old", "sessao-iniciada")).toBe("/?ok=sessao-iniciada");
  });

  it("searchWithoutFeedback removes only ?ok=", () => {
    expect(searchWithoutFeedback("?ok=despesa-atualizada")).toBe("");
    expect(searchWithoutFeedback("?mes=2026-10&ok=x&pagou=m1")).toBe("?mes=2026-10&pagou=m1");
    expect(searchWithoutFeedback("")).toBe("");
  });
});

describe("feedback store", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    dismissFeedback();
    vi.useRealTimers();
  });

  it("shows a success and hides it by itself after about 4 s", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFeedback(listener);
    showFeedback("acerto-registado");
    expect(getFeedback()).toMatchObject({ tone: "success", text: "Acerto registado." });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(FEEDBACK_DISMISS_MS).toBe(4000);
    vi.advanceTimersByTime(FEEDBACK_DISMISS_MS - 1);
    expect(getFeedback()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(getFeedback()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("an unknown code shows nothing and keeps what was there", () => {
    showFeedback("nope");
    expect(getFeedback()).toBeNull();
    showFeedback("regra-guardada");
    showFeedback("<img src=x onerror=alert(1)>");
    expect(getFeedback()?.text).toBe("Regra guardada.");
  });

  it("a new message replaces the old one and the old timer cannot hide it early", () => {
    showFeedback("despesa-enviada");
    vi.advanceTimersByTime(3000);
    showFeedback("despesa-confirmada");
    vi.advanceTimersByTime(1500);
    expect(getFeedback()?.text).toBe("Despesa confirmada.");
    vi.advanceTimersByTime(2500);
    expect(getFeedback()).toBeNull();
  });

  it("the close button (dismiss) hides it at once; a stale id does nothing", () => {
    showFeedback("convite-criado");
    const id = getFeedback()!.id;
    showFeedback("ligacao-copiada");
    dismissFeedback(id);
    expect(getFeedback()?.text).toBe("Ligação copiada.");
    dismissFeedback();
    expect(getFeedback()).toBeNull();
  });

  it("hovering or focusing the message holds it; leaving restarts the countdown", () => {
    showFeedback("excecao-guardada");
    vi.advanceTimersByTime(3000);
    holdFeedback();
    vi.advanceTimersByTime(10_000);
    expect(getFeedback()?.text).toBe("Exceção guardada.");
    releaseFeedback();
    vi.advanceTimersByTime(FEEDBACK_DISMISS_MS);
    expect(getFeedback()).toBeNull();
  });

  it("errors use the alert tone and never time out", () => {
    showFeedbackError("Não foi possível copiar.");
    vi.advanceTimersByTime(60_000);
    expect(getFeedback()).toMatchObject({ tone: "error", text: "Não foi possível copiar." });
  });
});

describe("feedback stash (full page load without ?ok=)", () => {
  function memoryStorage() {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      map,
    };
  }

  it("keeps a code for the next page, once", () => {
    const storage = memoryStorage();
    stashFeedback("sessao-terminada", storage);
    expect(storage.map.get(FEEDBACK_STASH_KEY)).toBe("sessao-terminada");
    expect(takeStashedFeedback(storage)).toBe("sessao-terminada");
    expect(takeStashedFeedback(storage)).toBeNull();
  });

  it("drops anything that is not a known code, and survives broken storage", () => {
    const storage = memoryStorage();
    storage.setItem(FEEDBACK_STASH_KEY, "Texto qualquer");
    expect(takeStashedFeedback(storage)).toBeNull();
    expect(storage.map.has(FEEDBACK_STASH_KEY)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    };
    expect(() => stashFeedback("sessao-terminada", broken)).not.toThrow();
    expect(takeStashedFeedback(broken)).toBeNull();
    expect(takeStashedFeedback(null)).toBeNull();
  });
});
