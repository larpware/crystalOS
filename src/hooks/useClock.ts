import { useSyncExternalStore } from "react";

/* ==========================================================================
   Shared clock

   A single timer drives every time display in the OS. Components declare the
   resolution they need (1s for a seconds clock, 30s for a date-only label)
   and the module runs the cheapest timer that satisfies all subscribers.
   Because notification is subscription-based, ticking never re-renders the
   desktop — only the components that actually read the time.
   ========================================================================== */

type Listener = () => void;

const listeners = new Set<Listener>();
const requestedIntervals = new Map<Listener, number>();

let timer: ReturnType<typeof setInterval> | null = null;
let activeInterval = 0;
let now = Date.now();

function notify(): void {
  now = Date.now();
  for (const listener of Array.from(listeners)) listener();
}

function currentInterval(): number {
  let smallest = Number.POSITIVE_INFINITY;
  for (const value of requestedIntervals.values()) {
    if (value < smallest) smallest = value;
  }
  return Number.isFinite(smallest) ? smallest : 1000;
}

function reschedule(): void {
  const next = currentInterval();
  if (next === activeInterval) return;
  activeInterval = next;
  if (timer) clearInterval(timer);
  timer = setInterval(notify, next);
}

function subscribe(listener: Listener, intervalMs: number): () => void {
  listeners.add(listener);
  requestedIntervals.set(listener, intervalMs);
  reschedule();
  return () => {
    listeners.delete(listener);
    requestedIntervals.delete(listener);
    reschedule();
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
      activeInterval = 0;
    }
  };
}

function getSnapshot(): number {
  return now;
}

/** Re-renders at most every `intervalMs` and returns the current timestamp. */
export function useClock(intervalMs = 1000): number {
  return useSyncExternalStore(
    (listener) => subscribe(listener, intervalMs),
    getSnapshot,
    () => now,
  );
}

export function currentTime(intervalMs = 1000): Date {
  return new Date(Math.floor(now / intervalMs) * intervalMs);
}
