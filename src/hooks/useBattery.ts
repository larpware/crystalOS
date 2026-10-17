import { useEffect, useState } from "react";
import {
  measureRefreshRate,
  readBattery,
  subscribeBattery,
  type BatteryStatus,
} from "@/services/system";

/**
 * Battery status from the real Battery Status API. Resolves to `null` on
 * browsers that do not implement it (Safari, and Chrome on some platforms),
 * in which case the shell hides the indicator instead of showing a guess.
 */
export function useBattery(): BatteryStatus | null | undefined {
  const [status, setStatus] = useState<BatteryStatus | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void readBattery().then((initial) => {
      if (!cancelled) setStatus(initial);
    });
    const unsubscribe = subscribeBattery((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return status;
}

export interface RefreshResult {
  hz: number;
  frameMs: number;
}

/** Measures display timing once on mount, and again when the viewport changes. */
export function useRefreshRate(enabled: boolean, remeasureKey?: string | number): RefreshResult | null {
  const [result, setResult] = useState<RefreshResult | null>(null);

  useEffect(() => {
    if (!enabled) {
      setResult(null);
      return;
    }
    let cancelled = false;
    void measureRefreshRate().then((measured) => {
      if (!cancelled) setResult(measured);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, remeasureKey]);

  return result;
}
