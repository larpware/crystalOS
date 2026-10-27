import { useSyncExternalStore } from "react";
import { getShieldState, subscribeShield, type ShieldState } from "./state";

/* ==========================================================================
   useShield — the store as React sees it.
   ========================================================================== */

export function useShield(): ShieldState {
  return useSyncExternalStore(subscribeShield, getShieldState, getShieldState);
}
