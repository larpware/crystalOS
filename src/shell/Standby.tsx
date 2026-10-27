import { useEffect, useRef, useState } from "react";
import { useClock } from "@/hooks/useClock";
import { useElementTheme } from "@/themes/scope";
import { useShellStore } from "@/state/shell";
import { useSystemStore } from "@/state/system";
import { formatDateLong, formatTime } from "@/utils/format";
import { CrystalMark } from "./CrystalMark";

/* ==========================================================================
   Standby

   An always-on display, in the spirit of a phone left on its side: after a few
   minutes without input the desk fades to a large clock, and after a few more
   the screen goes dark. Any movement of the pointer, any wheel tick or any key
   brings the desk back. It is a layer inside the desktop, not a modal: nothing
   is unmounted while it rests, so a game or a call is exactly where it was.

   The clock reads the same face and the same twelve/twenty-four-hour choice as
   the lock screen, and every colour comes from the theme tokens, so a standby
   screen is part of the theme rather than a member of a separate family.
   ========================================================================== */

type Stage = "awake" | "aod" | "sleep";

export function Standby() {
  const enabled = useSystemStore((state) => state.standbyEnabled);
  const idleMinutes = useSystemStore((state) => state.standbyIdleMinutes);
  const sleepMinutes = useSystemStore((state) => state.standbySleepMinutes);

  const clock12h = useShellStore((state) => state.panel.clock12h);
  const tick = useClock(15_000);
  const theme = useElementTheme("standby");

  const [stage, setStage] = useState<Stage>("awake");
  const lastActivity = useRef(Date.now());
  const stageAt = useRef(Date.now());

  useEffect(() => {
    if (!enabled) {
      setStage("awake");
      return;
    }

    const wake = () => {
      lastActivity.current = Date.now();
      setStage((current) => (current === "awake" ? current : "awake"));
    };

    /* Capture phase, so a handler that stops propagation inside an application
       cannot keep the desk asleep — or, worse, prevent it from waking. */
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    for (const event of events) {
      window.addEventListener(event, wake, { passive: true, capture: true });
    }

    const interval = window.setInterval(() => {
      const now = Date.now();
      // A background tab is not idle; it is not the desk at all. Reset rather
      // than accumulate, so returning to the tab never finds it already asleep.
      // A playing video is deliberate presence too — a clock over a film would
      // be a bug — while audio alone does not hold the desk awake.
      const videoPlaying = Array.from(document.querySelectorAll("video")).some(
        (video) => !video.paused && !video.ended && video.readyState > 2,
      );
      if (document.visibilityState !== "visible" || videoPlaying) {
        lastActivity.current = now;
        setStage((current) => (current === "awake" ? current : "awake"));
        return;
      }
      setStage((current) => {
        if (current === "awake") {
          if (now - lastActivity.current < idleMinutes * 60_000) return current;
          stageAt.current = now;
          return "aod";
        }
        if (current === "aod" && sleepMinutes > 0 && now - stageAt.current >= sleepMinutes * 60_000) {
          return "sleep";
        }
        return current;
      });
    }, 1000);

    return () => {
      for (const event of events) {
        window.removeEventListener(event, wake, { capture: true });
      }
      window.clearInterval(interval);
    };
  }, [enabled, idleMinutes, sleepMinutes]);

  if (stage === "awake") return null;

  const date = new Date(tick);
  const asleep = stage === "sleep";

  return (
    <div
      className="cr-standby"
      data-stage={stage}
      role="presentation"
      data-element-theme={theme.themeId ?? undefined}
      style={theme.style}
    >
      <div className="cr-standby__wash" aria-hidden="true" />
      <div className="cr-standby__content" aria-hidden={asleep || undefined}>
        <div className="cr-standby__mark">
          <CrystalMark size={30} />
          <span>CrystalOS</span>
        </div>
        <time className="cr-standby__time cr-num" dateTime={date.toISOString()}>
          {formatTime(date, clock12h)}
        </time>
        <div className="cr-standby__date">{formatDateLong(date, true)}</div>
      </div>
      {!asleep && (
        <p className="cr-standby__hint">Move the pointer, scroll or press any key to wake</p>
      )}
    </div>
  );
}

export default Standby;
