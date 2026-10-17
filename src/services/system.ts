/* ==========================================================================
   System information service

   Everything here reports only what the browser can actually tell us. When a
   capability is missing the API resolves to `null` and the UI hides the value
   rather than inventing one.
   ========================================================================== */

export interface BatteryStatus {
  /** 0–1 */
  level: number;
  charging: boolean;
  /** Seconds, or null when the browser does not report it. */
  chargingTime: number | null;
  dischargingTime: number | null;
}

export interface NetworkStatus {
  online: boolean;
  /** From navigator.connection where available. */
  effectiveType: string | null;
  downlinkMbps: number | null;
  rttMs: number | null;
  saveData: boolean;
}

interface BatteryManagerLike extends EventTarget {
  level: number;
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
}

type NavigatorWithExtras = Navigator & {
  getBattery?: () => Promise<BatteryManagerLike>;
  deviceMemory?: number;
  connection?: {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
    addEventListener?: (type: string, listener: () => void) => void;
    removeEventListener?: (type: string, listener: () => void) => void;
  };
};

function nav(): NavigatorWithExtras | null {
  return typeof navigator === "undefined" ? null : (navigator as NavigatorWithExtras);
}

export function hasBatteryApi(): boolean {
  return typeof nav()?.getBattery === "function";
}

export function readBattery(): Promise<BatteryStatus | null> {
  const navigatorExtras = nav();
  if (!navigatorExtras?.getBattery) return Promise.resolve(null);
  return navigatorExtras
    .getBattery()
    .then((manager) => ({
      level: manager.level,
      charging: manager.charging,
      chargingTime: Number.isFinite(manager.chargingTime) ? manager.chargingTime : null,
      dischargingTime: Number.isFinite(manager.dischargingTime) ? manager.dischargingTime : null,
    }))
    .catch(() => null);
}

export function subscribeBattery(onChange: (status: BatteryStatus) => void): () => void {
  const navigatorExtras = nav();
  if (!navigatorExtras?.getBattery) return () => undefined;

  let manager: BatteryManagerLike | null = null;
  let disposed = false;

  const emit = () => {
    if (!manager) return;
    onChange({
      level: manager.level,
      charging: manager.charging,
      chargingTime: Number.isFinite(manager.chargingTime) ? manager.chargingTime : null,
      dischargingTime: Number.isFinite(manager.dischargingTime) ? manager.dischargingTime : null,
    });
  };

  const attached: string[] = [];
  navigatorExtras
    .getBattery()
    .then((result) => {
      if (disposed) return;
      manager = result;
      for (const event of ["levelchange", "chargingchange", "chargingtimechange"]) {
        manager.addEventListener(event, emit);
        attached.push(event);
      }
      emit();
    })
    .catch(() => undefined);

  return () => {
    disposed = true;
    if (!manager) return;
    for (const event of attached) manager.removeEventListener(event, emit);
  };
}

export function readNetwork(): NetworkStatus {
  const connection = nav()?.connection;
  return {
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    effectiveType: connection?.effectiveType ?? null,
    downlinkMbps: typeof connection?.downlink === "number" ? connection.downlink : null,
    rttMs: typeof connection?.rtt === "number" ? connection.rtt : null,
    saveData: Boolean(connection?.saveData),
  };
}

export function subscribeNetwork(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  const connection = nav()?.connection;
  connection?.addEventListener?.("change", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
    connection?.removeEventListener?.("change", onChange);
  };
}

/** Device memory in GB, only on browsers that expose it. */
export function deviceMemoryGb(): number | null {
  const value = nav()?.deviceMemory;
  return typeof value === "number" ? value : null;
}

export function logicalProcessors(): number | null {
  const value = nav()?.hardwareConcurrency;
  return typeof value === "number" ? value : null;
}

export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  try {
    const estimate = await navigator.storage.estimate();
    if (typeof estimate.usage !== "number" || typeof estimate.quota !== "number") return null;
    return { usage: estimate.usage, quota: estimate.quota };
  } catch {
    return null;
  }
}

/**
 * Measures the real display refresh interval with requestAnimationFrame and
 * returns an estimate in Hz. Deliberately averaged over a short window and
 * clamped to plausible panel rates so a hitchy moment cannot report 400 Hz.
 */
export function measureRefreshRate(): Promise<{ hz: number; frameMs: number } | null> {
  if (typeof requestAnimationFrame === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const samples: number[] = [];
    let last = performance.now();
    let frames = 0;

    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      // Ignore pauses (tab throttling, long tasks) — they are not display timing.
      if (delta > 0.5 && delta < 60) samples.push(delta);
      frames += 1;
      if (frames < 70) {
        requestAnimationFrame(tick);
        return;
      }
      if (samples.length < 10) {
        resolve(null);
        return;
      }
      samples.sort((a, b) => a - b);
      const median = samples[Math.floor(samples.length / 2)];
      const rawHz = 1000 / median;
      const standard = [24, 25, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 240, 360];
      let hz = Math.round(rawHz);
      for (const candidate of standard) {
        if (Math.abs(candidate - rawHz) < Math.max(3, candidate * 0.06)) {
          hz = candidate;
          break;
        }
      }
      resolve({ hz, frameMs: Number(median.toFixed(2)) });
    };

    requestAnimationFrame(tick);
  });
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function pointerIsCoarse(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(pointer: coarse)").matches;
}
