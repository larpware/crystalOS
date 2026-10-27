/* ==========================================================================
   Crystal AI — the Puter.js runtime

   Crystal AI runs on Puter's "User-Pays" model: Puter.js is loaded from
   Puter's own CDN, the person signs in with their own Puter account (Puter.js
   handles that prompt itself), and their account carries their AI usage.
   CrystalOS ships no API key and never sees Puter credentials — there is
   nothing of Puter's in this repository, and nothing to leak.

   The script is loaded lazily, the first time Crystal AI is opened, so the
   rest of the OS never pays for it. If the CDN is unreachable the failure is
   reported as itself: a person is told the script could not be loaded, not
   shown a fake conversation.
   ========================================================================== */

/** Minimal typings for the parts of the Puter.js global Crystal AI uses. */
export interface PuterChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface PuterStreamPart {
  type?: string;
  text?: string;
  message?: string;
}

export interface PuterChatResponse {
  message?: { content?: string | unknown };
  finish_reason?: string;
}

export interface PuterModelInfo {
  id: string;
  provider?: string;
  cost?: { input?: number; output?: number };
}

interface PuterGlobal {
  ai?: {
    chat: (
      input: string | PuterChatMessage[],
      options?: Record<string, unknown>,
    ) => Promise<PuterChatResponse | AsyncIterable<PuterStreamPart>>;
    listModels?: () => Promise<Record<string, unknown> | PuterModelInfo[]>;
  };
  auth?: { getUser: () => Promise<{ username?: string } | null> };
}

declare global {
  interface Window {
    puter?: PuterGlobal;
  }
}

const PUTER_SCRIPT_URL = "https://js.puter.com/v2/";

export type PuterLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; reason: "script-blocked" | "script-failed" | "offline" };

let state: PuterLoadState = { status: "idle" };
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function puterState(): PuterLoadState {
  return state;
}

export function subscribePuter(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(next: PuterLoadState): void {
  state = next;
  emit();
}

/**
 * Loads Puter.js if it is not already present. Resolves when the global is
 * usable, rejects with the reason it could not be. Concurrent callers share
 * one script tag; a failed load can be retried.
 */
export function loadPuter(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Puter.js needs a browser."));
  }
  if (window.puter?.ai?.chat) {
    setState({ status: "ready" });
    return Promise.resolve();
  }
  if (pending) return pending;

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    const error = new Error(
      "There is no network connection, so Puter.js cannot be loaded. Crystal AI works through Puter's cloud — it is not available offline.",
    );
    setState({ status: "error", reason: "offline" });
    return Promise.reject(error);
  }

  setState({ status: "loading" });
  pending = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PUTER_SCRIPT_URL;
    script.async = true;
    const timeout = window.setTimeout(() => {
      cleanup();
      const error = new Error(
        "Puter.js did not finish loading. Check the connection and try again.",
      );
      setState({ status: "error", reason: "script-failed" });
      reject(error);
    }, 20_000);

    function cleanup(): void {
      window.clearTimeout(timeout);
      script.removeEventListener("load", onload);
      script.removeEventListener("error", onerror);
      script.remove();
    }
    function onload(): void {
      cleanup();
      if (window.puter?.ai?.chat) {
        pending = null;
        setState({ status: "ready" });
        resolve();
      } else {
        const error = new Error(
          "The Puter.js script loaded but its AI service is missing. It may have changed — try reloading CrystalOS.",
        );
        setState({ status: "error", reason: "script-failed" });
        reject(error);
      }
    }
    function onerror(): void {
      cleanup();
      const error = new Error(
        "Crystal AI could not load Puter.js from js.puter.com. An ad blocker, extension or network policy may be blocking the script.",
      );
      setState({ status: "error", reason: "script-blocked" });
      reject(error);
    }
    script.addEventListener("load", onload);
    script.addEventListener("error", onerror);
    document.head.appendChild(script);
  }).catch((error) => {
    pending = null;
    throw error;
  });
  return pending;
}

/** True when the Puter global is usable right now. */
export function puterReady(): boolean {
  return typeof window !== "undefined" && Boolean(window.puter?.ai?.chat);
}

/**
 * Turns a rejected Puter call into a sentence a person can act on. Puter's
 * documented error codes are named here so "you ran out of credit" never
 * appears as "TypeError: undefined".
 */
export function describePuterError(error: unknown): string {
  const raw =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error ?? "Unknown error");
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";

  if (code === "insufficient_funds" || /insufficient_funds|credit/i.test(raw)) {
    return "Your Puter account has used its free monthly AI allowance. Usage is billed to the Puter account you signed in with — see puter.com to add credit. CrystalOS never charges for anything.";
  }
  if (code === "too_many_requests" || /too_many_requests|rate limit/i.test(raw)) {
    return "Too many AI requests right now (Puter allows 30 per 10 seconds on free accounts). Wait a moment and try again.";
  }
  if (code === "input_too_large" || /413|input_too_large/i.test(raw)) {
    return "That message or attachment is too large for the model. Shorten it or attach a smaller file.";
  }
  if (/network_error|failed to fetch|load failed/i.test(raw)) {
    return "The network dropped while talking to Puter. Check the connection and retry.";
  }
  if (/request_timeout|timed out/i.test(raw)) {
    return "The model did not respond in time (Puter times out after 15 idle minutes). Try again, or pick a different model.";
  }
  if (/not authorized|401|sign in/i.test(raw)) {
    return "Puter needs you to sign in before using AI. A Puter sign-in window should have appeared — allow it, then retry.";
  }
  return raw;
}
