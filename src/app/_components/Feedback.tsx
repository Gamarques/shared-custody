"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useSyncExternalStore } from "react";
import {
  dismissFeedback,
  FEEDBACK_PARAM,
  getFeedback,
  getServerFeedback,
  holdFeedback,
  releaseFeedback,
  searchWithoutFeedback,
  showFeedback,
  subscribeFeedback,
  takeStashedFeedback,
  type Feedback,
} from "./feedback-store";
import { Icon } from "./Icon";

/** One message: green check (success) or warning icon (error), text and a close button. */
export function FeedbackToast({ feedback, onClose }: { feedback: Feedback; onClose: () => void }) {
  return (
    <div className="toast" data-tone={feedback.tone} data-testid="feedback">
      <span className="toast-icon">
        <Icon name={feedback.tone === "success" ? "check" : "info"} size={16} />
      </span>
      <p className="toast-text">{feedback.text}</p>
      <button type="button" className="toast-close" aria-label="Fechar aviso" onClick={onClose}>
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}

/**
 * Shows the code that arrived in `?ok=` (after a navigation) and removes it from the address bar.
 * Unknown codes are dropped without showing anything.
 */
function FeedbackFromUrl() {
  const params = useSearchParams();
  const pathname = usePathname();
  const code = params.get(FEEDBACK_PARAM);
  useEffect(() => {
    if (code === null) return;
    showFeedback(code);
    // Native history API: Next keeps its router in sync without fetching the page again.
    const { search, hash } = window.location;
    window.history.replaceState(window.history.state, "", pathname + searchWithoutFeedback(search) + hash);
  }, [code, pathname]);
  return null;
}

/**
 * Live regions for the messages, mounted once by the app shell. Both regions are always in the
 * DOM (screen readers only announce changes inside a region that already exists); success goes to
 * role="status" (polite), errors to role="alert".
 */
export function FeedbackRegion({ shell }: { shell: "app" | "auth" }) {
  const feedback = useSyncExternalStore(subscribeFeedback, getFeedback, getServerFeedback);
  const close = () => dismissFeedback();
  // A code stashed before a full page load (sign-out): shown once, on the page that loads next.
  useEffect(() => {
    const stashed = takeStashedFeedback();
    if (stashed) showFeedback(stashed);
  }, []);
  return (
    <div
      className="toast-region"
      data-shell={shell}
      onPointerEnter={holdFeedback}
      onPointerLeave={releaseFeedback}
      onFocus={holdFeedback}
      onBlur={releaseFeedback}
    >
      <div className="toast-live" role="status" aria-live="polite">
        {feedback?.tone === "success" && <FeedbackToast key={feedback.id} feedback={feedback} onClose={close} />}
      </div>
      <div className="toast-live" role="alert">
        {feedback?.tone === "error" && <FeedbackToast key={feedback.id} feedback={feedback} onClose={close} />}
      </div>
      <Suspense fallback={null}>
        <FeedbackFromUrl />
      </Suspense>
    </div>
  );
}
