import { useEffect, useRef, useState } from "react";
import { useWindowStore } from "@/state/windows";

/* ==========================================================================
   Full-screen hint

   The moment a window enters full screen, the bar carrying the exit control
   is gone and every other way out is invisible. A small pill appears under
   the top edge for a few seconds naming the keyboard way back to a normal
   window, so the mode is never entered without its exit being offered.

   It is deliberately not a notification: it is not queued into the centre,
   it counts nothing, and Do Not Disturb must not silence the answer to the
   one question a fresh full-screen window raises.
   ========================================================================== */

const HINT_MS = 5000;

export function FullScreenHint() {
  const focusedFull = useWindowStore(
    (state) => state.windows.find((window) => window.focused)?.full === true,
  );
  const [visible, setVisible] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  /* Every entry into full screen (any window, any entry path) re-shows the
     pill, and leaving the mode takes it away at once. */
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!focusedFull) {
      setVisible(false);
      return;
    }
    setVisible(true);
    timer.current = window.setTimeout(() => setVisible(false), HINT_MS);
    return () => window.clearTimeout(timer.current);
  }, [focusedFull]);

  if (!visible) return null;

  return (
    <div className="cr-full-hint" role="status" aria-live="polite">
      <span className="cr-full-hint__keys">
        Shift <i>+</i> Alt
      </span>
      <span className="cr-full-hint__text">takes the window back to normal — Esc works too</span>
    </div>
  );
}
