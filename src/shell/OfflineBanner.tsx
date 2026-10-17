import { Button } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import { useOffline } from "@/hooks/useOffline";
import { offlineExplanation, offlineHeadline } from "@/services/offline";
import { openApp } from "@/services/os";
import { useSystemStore } from "@/state/system";

/* ==========================================================================
   Offline notice

   A strip under the top bar, shown only while CrystalOS believes it has no
   network. It says which of the two reasons applies, because "you turned this
   on" and "this machine has no connection" call for different actions, and the
   button offered depends on the answer: a machine with no connection has
   nothing for the user to switch back on.

   The desktop reserves exactly this strip's height while it is up (see
   OFFLINE_BANNER_HEIGHT) rather than letting it float over a window, so the
   banner is part of the chrome and cannot hide content.
   ========================================================================== */

/** The strip's height in viewport pixels; the desktop reserves the same amount. */
export const OFFLINE_BANNER_HEIGHT = 38;

export function OfflineBanner({ offset }: { offset: number }) {
  const report = useOffline();
  if (!report.offline) return null;

  return (
    <div
      className="cr-offline"
      style={{ top: offset, height: OFFLINE_BANNER_HEIGHT }}
      role="status"
    >
      <Icon name="wifi-off" size={15} />
      <strong className="cr-offline__title">{offlineHeadline(report)}</strong>
      <span className="cr-offline__why">{offlineExplanation(report)}</span>
      <div className="cr-offline__actions">
        {report.reason === "forced" ? (
          <Button
            size="sm"
            icon="wifi"
            onClick={() => useSystemStore.getState().setOfflineMode("auto")}
          >
            Go back online
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          icon="sliders"
          onClick={() => openApp("settings", { args: { section: "network" } })}
        >
          Network settings
        </Button>
      </div>
    </div>
  );
}
