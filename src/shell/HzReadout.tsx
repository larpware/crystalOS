import { Icon } from "@/icons/Icon";
import { useRefreshRate } from "@/hooks/useBattery";
import { useSystemStore } from "@/state/system";
import { useViewport } from "@/hooks/useUi";

/* ==========================================================================
   Refresh rate readout

   A measured display timing readout, not a frame-rate counter. The value comes
   from requestAnimationFrame deltas averaged over a short window, and is
   re-measured when the viewport changes (which is also when a display is most
   likely to have been moved or reconfigured).
   ========================================================================== */

export function HzReadout({ variant = "panel" }: { variant?: "panel" | "corner" }) {
  const viewport = useViewport();
  const performanceMode = useSystemStore((state) => state.performanceMode);
  const measured = useRefreshRate(true, `${viewport.width}x${viewport.height}`);

  if (!measured) {
    return (
      <span className={`cr-hz${variant === "corner" ? " cr-hz--corner" : ""}`} title="Measuring display timing">
        <Icon name="activity" size={12} />
        <span className="cr-num">— Hz</span>
      </span>
    );
  }

  return (
    <span
      className={`cr-hz${variant === "corner" ? " cr-hz--corner" : ""}`}
      title={`Measured display refresh: ${measured.hz} Hz (median frame ${measured.frameMs} ms)${
        performanceMode ? " · performance mode" : ""
      }`}
    >
      <Icon name="activity" size={12} />
      <span className="cr-num">{measured.hz} Hz</span>
    </span>
  );
}
