import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  createProxiedFrame,
  getScramjetState,
  retryScramjet,
  subscribeScramjetStore,
  waitForFrameLoad,
  type ProxiedFrameHandle,
  type ScramjetState,
} from "@/services/scramjet";
import { describeRequestFailure, readFrameFailure, readShellRecapture } from "@/services/scramjet/frameError";

/* ==========================================================================
   useProxiedFrame

   Owns exactly one Scramjet frame: creates it when the iframe element mounts,
   navigates it, tracks the live URL, and disposes it when the window closes.
   Every proxied application uses this hook, so N windows means N frames over a
   single shared controller.
   ========================================================================== */

export type FrameStatus = "connecting" | "loading" | "ready" | "error";

export interface ProxiedFrameResult {
  status: FrameStatus;
  error: string | null;
  /** URL reported by the frame's URL watcher, not a guess. */
  url: string;
  loading: boolean;
  /** Callback ref for the iframe element. */
  attach: (element: HTMLIFrameElement | null) => void;
  go: (url: string) => void;
  back: () => void;
  forward: () => void;
  reload: () => void;
  retry: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
}

const LOAD_TIMEOUT_MS = 25_000;

/**
 * How long a rendered transport error is given to be replaced by the real page.
 *
 * A frame was measured settling on the client's error document and then moving on
 * to the site it was asked for; reporting the error instantly would put an error
 * pane over a page that arrived.
 */
const FAILURE_SETTLE_MS = 500;

/* ---- URL reports ---------------------------------------------------------
   A few sites hand `undefined` straight to `location.replace` or to a history
   call, and a browser resolves that relative string against the current page:
   `new URL("undefined", "https://site.example/page")` is
   `https://site.example/undefined`. The page itself renders correctly, but the
   frame then reports that path as the place the user is, which is how a
   nonsense address ends up in the address bar and in history.

   The shape is unmistakable — `/undefined` with no query or fragment, on an
   origin the frame was already on — so it is dropped and the last real URL
   wins. A site that genuinely serves `/undefined` as a page is rare enough to
   be worth that trade.
   ------------------------------------------------------------------------- */
export function isUndefinedUrlReport(next: string, previous: string): boolean {
  if (!next) return true;
  let candidate: URL;
  try {
    candidate = new URL(next);
  } catch {
    // Not a URL at all: that is the caller's business, not this filter's.
    return false;
  }
  if (candidate.pathname !== "/undefined" || candidate.search || candidate.hash) return false;
  if (!previous || previous.startsWith("about:")) return true;
  try {
    return new URL(previous).origin === candidate.origin;
  } catch {
    return true;
  }
}

/** Shared proxy state, so every app shows the same connection status. */
export function useScramjetState(): ScramjetState {
  return useSyncExternalStore(subscribeScramjetStore, getScramjetState, getScramjetState);
}

export interface UseProxiedFrameOptions {
  /** Called with the URL the frame actually settled on. */
  onUrlChange?: (url: string) => void;
  /** What Shield's counters belong to: usually the browser tab's id. */
  owner?: string | null;
}

export function useProxiedFrame(
  destination: string,
  options: UseProxiedFrameOptions = {},
): ProxiedFrameResult {
  const [element, setElement] = useState<HTMLIFrameElement | null>(null);
  const [status, setStatus] = useState<FrameStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState(destination);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const handleRef = useRef<ProxiedFrameHandle | null>(null);
  /** How many times a frame that received the OS itself was recreated. */
  const shellRecapturesRef = useRef(0);
  /** Last URL that was actually real, used to judge suspicious reports. */
  const lastGoodUrlRef = useRef(destination);
  const generationRef = useRef(0);
  const historyRef = useRef<{ entries: string[]; index: number }>({ entries: [], index: -1 });
  const timerRef = useRef<number | null>(null);
  /**
   * The transport's own reason for the document failure, once the frame has
   * reported one. Kept so the load timeout does not overwrite a precise reason
   * ("no exit in the pool could carry this site") with "nothing loaded in time".
   */
  const failureRef = useRef<string | null>(null);

  const attach = useCallback((next: HTMLIFrameElement | null) => {
    setElement(next);
  }, []);

  /** Records a URL the frame reported. Returns false when it was dropped. */
  const noteUrl = useCallback((next: string): boolean => {
    if (isUndefinedUrlReport(next, lastGoodUrlRef.current)) return false;
    lastGoodUrlRef.current = next;
    setUrl(next);
    const history = historyRef.current;
    if (history.entries[history.index] === next) return true;
    const entries = history.entries.slice(0, history.index + 1);
    entries.push(next);
    historyRef.current = { entries: entries.slice(-60), index: Math.min(entries.length - 1, 59) };
    setCanGoBack(historyRef.current.index > 0);
    setCanGoForward(false);
    return true;
  }, []);

  const armTimeout = useCallback((frame: HTMLIFrameElement) => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    // A new navigation gets a clean slate: a reason reported for the last one
    // must not be attached to this one.
    failureRef.current = null;
    setStatus("loading");
    setError(null);
    waitForFrameLoad(frame, LOAD_TIMEOUT_MS)
      .then(async () => {
        /*
         * The document that settled may be the transport's own error page rather
         * than the site. It renders as a real document, so the readiness check
         * accepts it and the loading overlay comes down over a one-line internal
         * message — or, where that message is white on white, over nothing at all.
         * Recognising it turns that into the shell's own error, which has the ways
         * out on it. The second recogniser covers the frame that received
         * CrystalOS itself when its first navigation outran the service worker.
         */
        const failure = readFrameFailure(frame) ?? readShellRecapture(frame);
        if (!failure) {
          setStatus("ready");
          return;
        }
        // A frame can be between documents: a failure, then the real page. One
        // tick is enough for that to show itself, and believing the worst
        // instantly would put an error over a page that arrived.
        await new Promise((resolve) => window.setTimeout(resolve, FAILURE_SETTLE_MS));
        const settled = readFrameFailure(frame) ?? readShellRecapture(frame);
        if (!settled) {
          setStatus("ready");
          return;
        }
        // A shell recapture is a race the next attempt normally wins: by the
        // time this settled, the worker has activated. Recreate the frame once
        // automatically; a second recapture is reported, not retried.
        if (readShellRecapture(frame) && shellRecapturesRef.current < 1) {
          shellRecapturesRef.current += 1;
          setAttempt((value) => value + 1);
          return;
        }
        setStatus("error");
        setError(settled);
      })
      .catch((failure: Error) => {
        setStatus("error");
        setError(failureRef.current ?? failure.message);
      });
  }, []);

  /* Create the frame for this window and load the destination. */
  useEffect(() => {
    if (!element) return undefined;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let disposed = false;

    setStatus("connecting");
    setError(null);

    createProxiedFrame(element, {
      owner: options.owner ?? null,
      onUrl: (next) => {
        if (disposed) return;
        // A dropped URL is withheld from the caller too: a consumer that stored
        // it would hand it straight back as the next destination, and the frame
        // would be navigated to a path only `undefined` explains.
        if (noteUrl(next)) options.onUrlChange?.(next);
      },
      // Rather than navigating the whole desktop away to a ?goto= URL, links
      // that try to escape the frame are folded back into this window. That
      // keeps the shell (and the user's session) intact.
      onEscapedLink: (target) => {
        if (disposed) return;
        handleRef.current?.frame.go(target.href);
      },
      /*
       * The frame's own document could not be fetched at all. Nothing will be
       * rendered for it, so the pane would sit empty until the load timeout —
       * which is precisely the "blank page" this reports its way out of. The
       * readiness check is left running: if a document does arrive after all
       * (a retried navigation, a later page) it still sets "ready" and takes
       * the error down, and if nothing arrives the timeout reports this same
       * reason rather than a generic one.
       */
      onFailure: (failure) => {
        if (disposed || generationRef.current !== generation) return;
        const reason = describeRequestFailure(failure.message);
        failureRef.current = reason;
        setStatus("error");
        setError(reason);
      },
    })
      .then((handle) => {
        if (disposed || generationRef.current !== generation) {
          handle.dispose();
          return;
        }
        handleRef.current = handle;
        handle.frame.go(destination);
        noteUrl(destination);
        armTimeout(element);
      })
      .catch((failure: Error) => {
        if (disposed) return;
        setStatus("error");
        setError(failure.message);
      });

    return () => {
      disposed = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
    // `destination` is intentionally not a dependency: changing it navigates
    // the existing frame instead of destroying it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element, attempt, noteUrl, armTimeout]);

  /* Follow destination changes (a second window, an app argument, a reload). */
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle || !element) return;
    if (destination === url) return;
    // Never spend a navigation on a URL that only exists because something
    // assigned `undefined` to a location.
    if (isUndefinedUrlReport(destination, lastGoodUrlRef.current)) return;
    handle.frame.go(destination);
    noteUrl(destination);
    armTimeout(element);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination]);

  const go = useCallback(
    (next: string) => {
      const handle = handleRef.current;
      if (!handle || !element) return;
      handle.frame.go(next);
      armTimeout(element);
    },
    [armTimeout, element],
  );

  const retry = useCallback(() => {
    // A failed backend start is retried from scratch; a failed page load just
    // reloads the frame.
    if (status === "connecting" || getScramjetState().status === "error") {
      void retryScramjet().catch(() => undefined);
      setAttempt((value) => value + 1);
      return;
    }
    const handle = handleRef.current;
    if (handle && element) {
      handle.frame.reload();
      armTimeout(element);
    } else {
      setAttempt((value) => value + 1);
    }
  }, [armTimeout, element, status]);

  const goHistory = useCallback(
    (direction: 1 | -1) => {
      const handle = handleRef.current;
      if (!handle) return;
      const history = historyRef.current;
      const index = history.index + direction;
      const target = history.entries[index];
      if (target === undefined) return;
      historyRef.current = { ...history, index };
      setCanGoBack(index > 0);
      setCanGoForward(index < history.entries.length - 1);
      handle.frame.go(target);
      setUrl(target);
      if (element) armTimeout(element);
    },
    [armTimeout, element],
  );

  return {
    status,
    error,
    url,
    loading: status === "connecting" || status === "loading",
    attach,
    go,
    back: () => goHistory(-1),
    forward: () => goHistory(1),
    reload: () => retry(),
    retry,
    canGoBack,
    canGoForward,
  };
}
