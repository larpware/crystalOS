import { useEffect } from "react";
import { useVpnStore } from "@/state/vpn";

/* ==========================================================================
   useVpnSync

   Keeps the client mirror of the VPN controller current.

   Polling is the right shape here, not a websocket. The controller changes
   state on its own — credentials expire, a background exit check concludes, a
   mint fails — and those transitions happen in the backend process with no
   request from this tab to attach a push to. A short poll against a local
   backend costs almost nothing and, unlike an event stream, cannot silently
   stop delivering and leave the UI showing a stale "connected".

   The first read happens immediately so the shell is never one interval behind
   after a reload.
   ========================================================================== */

/** Frequent enough to feel live, cheap enough to leave running. */
const POLL_MS = 4_000;

export function useVpnSync(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    void useVpnStore.getState().sync();
    const timer = window.setInterval(() => {
      void useVpnStore.getState().sync();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [active]);
}
