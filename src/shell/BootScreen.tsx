import { useEffect, useMemo, useState } from "react";
import { CrystalMark } from "./CrystalMark";
import { SYSTEM_VERSION } from "@/version";
import { shuffled } from "./boot";
import { BOOT_TIPS } from "./bootTips";

/* ==========================================================================
   Boot screen

   Two things happen here, and only one of them is work.

   The step line reports real startup work: applying the saved theme, hydrating
   the persisted stores and resolving the account session against the account
   server. A step is only announced once its own await has finished, and a slow
   session check leaves the last step on screen rather than racing past it.

   The bar and the hold that keeps the screen up are presentational. App picks
   `targetMs` — a randomised 3–7s window, or the honest short floor when
   Settings → Power has "Remove extra boot animation time" switched on (or when
   motion is reduced). The bar fills over exactly that window, so the sweep and
   the wait always agree, and the desktop is never held behind an animation with
   no time left on it.

   The tip at the bottom is the one line of the screen that is neither: it is a
   real feature of this desktop, drawn from BOOT_TIPS and rotated while the
   screen is up.
   ========================================================================== */

export type BootStep = "theme" | "storage" | "session";

const stepOrder: BootStep[] = ["theme", "storage", "session"];

const stepLabel: Record<BootStep, string> = {
  theme: "Applying your saved theme",
  storage: "Reading this profile",
  session: "Checking your account session",
};

/** How long one tip stays on screen before the next replaces it. */
const TIP_INTERVAL_MS = 2600;

export function BootScreen({
  /** Steps that have actually completed. */
  completed,
  /** How long the bar takes to fill, and how long boot is held. */
  targetMs,
}: {
  completed: BootStep[];
  targetMs: number;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [filled, setFilled] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);

  // A short clock, only used to keep the copy honest about a slow session
  // check ("still working…" after a few seconds) instead of looking frozen.
  useEffect(() => {
    const id = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  // The bar is driven by CSS rather than by React state, so it costs no
  // renders and stays smooth on a slow machine. It starts at zero and, one
  // tick later, is told to fill over `targetMs`. A timeout is used rather than
  // requestAnimationFrame on purpose — a background tab or a non-composited
  // webview may never deliver a frame, and a decorative bar must not depend on
  // one arriving.
  useEffect(() => {
    const id = window.setTimeout(() => setFilled(true), 40);
    return () => window.clearTimeout(id);
  }, []);

  // Tips are shuffled once per boot so two starts in a row do not open with the
  // same line, then advance on a timer for as long as this screen is mounted.
  const tips = useMemo(() => shuffled(BOOT_TIPS), []);
  useEffect(() => {
    if (tips.length < 2) return undefined;
    const id = window.setInterval(
      () => setTipIndex((value) => (value + 1) % tips.length),
      TIP_INTERVAL_MS,
    );
    return () => window.clearInterval(id);
  }, [tips]);

  const activeIndex = stepOrder.findIndex((step) => !completed.includes(step));

  return (
    <div className="cr-boot" role="status" aria-live="polite" aria-label="Starting CrystalOS">
      <div className="cr-boot__inner">
        <div className="cr-boot__mark">
          <CrystalMark size={38} />
        </div>
        <div className="cr-boot__wordmark">crystal<span>OS</span></div>
        <div className="cr-boot__tagline">A quiet desktop for the open web</div>

        <div className="cr-boot__track" aria-hidden="true">
          <span
            className="cr-boot__fill"
            style={{
              transform: filled ? "scaleX(1)" : "scaleX(0)",
              transitionDuration: `${targetMs}ms`,
              transitionTimingFunction: "linear",
            }}
          />
        </div>

        <div className="cr-boot__step">
          {activeIndex === -1 ? "Starting the desktop" : stepLabel[stepOrder[activeIndex]]}
          {elapsed >= 6 && activeIndex !== -1 ? " — still working…" : ""}
        </div>
      </div>

      {/* Keyed on the tip so each new line fades in on its own rather than the
          whole block re-animating in place. */}
      <div className="cr-boot__tip" key={tipIndex}>
        <span className="cr-boot__tip-label">Tip</span>
        <span className="cr-boot__tip-body">{tips[tipIndex]}</span>
      </div>

      <div className="cr-boot__footer">
        <span className="cr-num">CrystalOS {SYSTEM_VERSION.version}</span>
        <span>{SYSTEM_VERSION.build}</span>
      </div>
    </div>
  );
}

export default BootScreen;
