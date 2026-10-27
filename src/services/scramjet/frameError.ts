/* ==========================================================================
   Transport failures the frame rendered itself

   When a proxied request cannot be completed, the Scramjet client answers the
   document with a page of its own: a single `<pre>` holding one line, starting
   `Internal Service Worker Error:`. That page is a *rendered document* — it has
   an element and text — so the readiness check in `frameReady.ts` reads it as
   "the page arrived", takes the loading overlay down, and leaves the person
   looking at a one-line internal message. In a light theme the text is white on
   a transparent background, which is where "the page is blank" comes from.

   Nothing here decides that the request failed; the transport already did. This
   module only recognises that page and turns its line into a sentence the person
   can act on, keeping the raw detail so the message stays checkable.

   The frame is same-origin with the shell while it is proxied, so the document
   can be read; a frame that has been navigated somewhere else throws, and that
   is simply "not the error page" — never an error here.
   ========================================================================== */

/** The exact opening the Scramjet client gives its own error page. */
export const TRANSPORT_ERROR_PREFIX = "Internal Service Worker Error:";

/** Longest raw detail kept: the message is a sentence, not a log dump. */
const MAX_DETAIL = 140;

/**
 * Causes worth naming, in the words of the thing that failed.
 *
 * The raw code stays in the sentence either way — these only add what the code
 * means, because "SSL connect error" is not something a person can act on.
 */
const CAUSES: Array<{ match: RegExp; says: string }> = [
  {
    match: /SSL connect error/i,
    says: "The proxy could not complete a secure connection to this site",
  },
  {
    match: /blocked rather than sent unprotected/i,
    says: "The VPN refused this request rather than send it unprotected",
  },
  {
    match: /connection reset|ECONNRESET|socket disconnected|connection closed before/i,
    says: "The connection was dropped part-way through",
  },
  {
    match: /bad record mac|decryption failed|wrong version number|bad decrypt|unexpected eof/i,
    says: "The connection came through corrupted, so the page could not be assembled",
  },
  {
    match: /carried a secure session but no answer|carried no HTTP response|carried something other than an HTTP response/i,
    says: "The proxy accepted the connection but carried nothing back",
  },
  {
    match: /no exit could carry|refused a CONNECT|could not carry/i,
    says: "No exit in the pool could carry this site",
  },
  {
    match: /timed out|ETIMEDOUT|timeout/i,
    says: "The proxy did not answer in time",
  },
];

/** The raw detail, clipped to what a sentence can carry. */
export function clipDetail(detail: string): string {
  const collapsed = String(detail ?? "").trim().replace(/\s+/g, " ");
  return collapsed.length > MAX_DETAIL ? `${collapsed.slice(0, MAX_DETAIL - 1)}…` : collapsed;
}

/** What a transport error means, or `null` when it is not one we can name. */
export function describeCause(detail: string): string | null {
  return CAUSES.find((entry) => entry.match.test(detail))?.says ?? null;
}

/**
 * Turns raw transport detail into the sentence shown for a failed page.
 *
 * Both paths end here: the rendered error page (`describeTransportError`) and
 * the failure the frame reports as it happens (`createProxiedFrame`). The raw
 * detail is always kept in the sentence, because the cause we recognise is an
 * interpretation and the detail is the fact.
 */
export function describeRequestFailure(detail: string): string {
  const clipped = clipDetail(detail);
  if (!clipped) return "This page could not be loaded through the proxy.";
  const cause = describeCause(detail);
  if (!cause) return `This page could not be loaded through the proxy (${clipped}).`;
  return `${cause} (${clipped}).`;
}

/**
 * Turns one line of the transport's own error page into a sentence.
 *
 * Returns `null` for anything that is not that page — including a real site that
 * happens to contain the phrase, because the opening has to be the start of the
 * document's text, which is where the client writes it.
 */
export function describeTransportError(text: string): string | null {
  const trimmed = String(text ?? "").trim();
  if (!trimmed.startsWith(TRANSPORT_ERROR_PREFIX)) return null;
  const detail = trimmed.slice(TRANSPORT_ERROR_PREFIX.length).trim();
  return describeRequestFailure(detail);
}

/**
 * Reads the failure out of a frame, or `null` when the frame is not showing one.
 *
 * Every read is guarded: a frame that has navigated cross-origin, or that is
 * mid-navigation, cannot be inspected, and that is not a transport failure.
 */
export function readFrameFailure(frame: HTMLIFrameElement): string | null {
  try {
    return describeTransportError(frame.contentDocument?.body?.textContent ?? "");
  } catch {
    return null;
  }
}

/* ==========================================================================
   The frame that received the OS itself

   A proxied frame's first navigation is a request under the Scramjet scope
   prefix, answered by the service worker. If that navigation outruns the
   worker's activation, nothing intercepts it and the request falls through to
   the server — whose single-page fallback serves the shell's own index.html.
   The whole desktop then boots *inside the frame*: same origin, so it shares
   storage, restores windows and paints a second panel and dock, while the
   address bar still shows the destination that was asked for.

   The shell is unmistakable from inside: it mounts into #crystal-root, and no
   proxied page ever does. This recognises that state so the caller can retry
   (by now the worker is active) or fail with the truth instead of showing a
   second desktop as if it were the site.
   ========================================================================== */

/** The mount node the CrystalOS shell renders into. */
export const SHELL_ROOT_ID = "crystal-root";

/** Reads "the frame received the OS itself", or `null` when it did not. */
export function readShellRecapture(frame: HTMLIFrameElement): string | null {
  try {
    const doc = frame.contentDocument;
    if (!doc?.documentElement) return null;
    if (!doc.getElementById(SHELL_ROOT_ID)) return null;
    return "The proxy returned CrystalOS itself instead of the page — the service worker was not ready to intercept the request.";
  } catch {
    return null;
  }
}
