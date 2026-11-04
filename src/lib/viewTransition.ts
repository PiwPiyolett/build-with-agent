import { flushSync } from "react-dom";

/**
 * Runs a screen change as a soft cross-fade. Without browser support, or when the person asked for less motion, it
 * simply changes at once. A transition cut short by a quicker click is normal, so its rejections are ignored.
 */
export function withViewTransition(update: () => void) {
  if (typeof document.startViewTransition !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update();
    return;
  }
  const transition = document.startViewTransition(() => flushSync(update));
  transition.ready.catch(() => {});
  transition.finished.catch(() => {});
}
