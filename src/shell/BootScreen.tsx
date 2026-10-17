import { useEffect, useState } from "react";
import { CrystalMark } from "./CrystalMark";
import { SYSTEM_VERSION } from "@/version";

/* ==========================================================================
   Boot screen

   Shown while the shell is doing real startup work: applying the saved theme,
   hydrating the persisted stores and resolving the account session against the
   account server. The steps below advance as those steps actually finish — the
   progress bar is not on a timer, and a slow session check leaves the last
   step on screen rather than racing past it.

   Rendering stops as soon as App says the session is ready, so the desktop is
   never held behind an animation that has no work left to hide.
   ========================================================================== */

export type BootStep = "theme" | "storage" | "session";

const stepOrder: BootStep[] = ["theme", "storage", "session"];

const stepLabel: Record<BootStep, string> = {
  theme: "Applying your saved theme",
  storage: "Reading this profile",
  session: "Checking your account session",
};

export function BootScreen({
  /** Steps that have actually completed. */
  completed,
}: {
  completed: BootStep[];
}) {
  const [elapsed, setElapsed] = useState(0);

  // A short clock, only used to keep the copy honest about a slow session
  // check ("still checking…" after a few seconds) instead of looking frozen.
  useEffect(() => {
    const id = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const activeIndex = stepOrder.findIndex((step) => !completed.includes(step));
  const progress = completed.length / stepOrder.length;

  return (
    <div className="cr-boot" role="status" aria-live="polite" aria-label="Starting CrystalOS">
      <div className="cr-boot__inner">
        <div className="cr-boot__mark">
          <CrystalMark size={38} />
        </div>
        <div className="cr-boot__wordmark">crystal<span>OS</span></div>
        <div className="cr-boot__tagline">A quiet desktop for the open web</div>

        <div className="cr-boot__track" aria-hidden="true">
          <span className="cr-boot__fill" style={{ transform: `scaleX(${progress})` }} />
        </div>

        <div className="cr-boot__step">
          {activeIndex === -1 ? "Starting the desktop" : stepLabel[stepOrder[activeIndex]]}
          {elapsed >= 6 && activeIndex !== -1 ? " — still working…" : ""}
        </div>
      </div>

      <div className="cr-boot__footer">
        <span className="cr-num">CrystalOS {SYSTEM_VERSION.version}</span>
        <span>{SYSTEM_VERSION.build}</span>
      </div>
    </div>
  );
}

export default BootScreen;
