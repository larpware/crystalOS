import { useEffect, useMemo, useState } from "react";
import { subscribeNetwork } from "@/services/system";
import { browserReportsOnline, deriveOffline, type OfflineReport } from "@/services/offline";
import { useSystemStore } from "@/state/system";

/* ==========================================================================
   Live offline state

   Two sources feed one answer, so both are watched: the user's offline-mode
   setting, and the browser's own connection events. Either can change while a
   window is open, and a notice that only listened to one of them would be
   wrong half the time.
   ========================================================================== */

export function useOffline(): OfflineReport {
  const mode = useSystemStore((state) => state.offlineMode);
  const [browserOnline, setBrowserOnline] = useState(browserReportsOnline);

  useEffect(() => {
    const update = () => setBrowserOnline(browserReportsOnline());
    update();
    return subscribeNetwork(update);
  }, []);

  return useMemo(() => deriveOffline(mode, browserOnline), [mode, browserOnline]);
}
