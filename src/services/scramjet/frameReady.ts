/* ==========================================================================
   Scramjet frame readiness

   "The proxied page is here" is not the same question as "the iframe fired a
   load event". A frame navigates through a blank document first — about:blank,
   then the Scramjet controller's own bootstrap page — and each of those raises
   its own `load`. Reading one of those as the page having arrived is what took
   the loading overlay off an empty frame: a blank pane with no error and
   nothing in it to say why.

   So readiness is judged from the document itself, and a `load` event only
   counts once the document is real. A poll covers the case the comment on
   `waitForFrameLoad` describes: on heavy sites the controller navigates the
   frame *after* the initial load, so the event alone can be missed.

   Kept apart from the rest of the service so the decision can be tested without
   a browser, a service worker or a backend.
   ========================================================================== */

/**
 * True when the frame's own document is showing a real page.
 *
 * A proxied document is served from this origin, so the shell can read it.
 * Every check is defensive: a frame that has navigated somewhere cross-origin,
 * or that is mid-navigation, throws or is unreadable — which is simply "not
 * loaded yet", never an error here.
 *
 * The title is deliberately not required. A page without one is still a page,
 * and demanding it made such pages wait out the whole timeout and then report
 * "Nothing loaded" while the user was looking straight at them. What separates
 * a real page from the controller's bootstrap page is content: the bootstrap
 * page has neither elements nor text.
 */
export function frameHasRenderedDocument(frame: HTMLIFrameElement): boolean {
  try {
    const doc = frame.contentDocument;
    if (!doc || !doc.body) return false;
    const href = doc.location?.href ?? "";
    if (!href || href === "about:blank") return false;
    return doc.body.childElementCount > 0 || (doc.body.textContent ?? "").trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Resolves once the proxied frame is showing a page, rejects after `timeoutMs`.
 *
 * There are two signals on purpose. The frame's `load` event is the first, but
 * a proxied page can finish loading without raising it on this element: the
 * Scramjet controller navigates the frame itself once its client bootstrap has
 * run, and on heavy sites that navigation happens after the initial load
 * event — so the load listener alone reported "Nothing loaded" for a page the
 * user was already looking at. The second signal polls the document, which
 * works because the proxied document is same-origin with the shell.
 */
export function waitForFrameLoad(frame: HTMLIFrameElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    /**
     * Both timeout ids are declared before `done`, and assigned after: the first
     * poll runs before the overall timeout is scheduled, so a frame that arrives
     * already rendered would otherwise settle against a `timer` still in its
     * temporal dead zone and throw instead of resolving.
     */
    let timer = 0;
    /** Timeout id for the document poll, kept so `done` can stop the chain. */
    let poll = 0;
    const done = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.clearTimeout(poll);
      frame.removeEventListener("load", onLoad);
      if (error) reject(error);
      else resolve();
    };
    /*
     * A `load` event is a hint, not proof. The frame raises one for each blank
     * document it passes through on the way to the real page, and taking the
     * first of those as "ready" is what left the pane blank. So the event only
     * settles once the document is actually there; until then the poll below
     * keeps watching, and a later load — or the poll — finishes the wait.
     */
    const onLoad = () => {
      if (frameHasRenderedDocument(frame)) done();
    };
    /* Chained rather than an interval: a tick that lands while the page is busy
       cannot stack up behind another one, and the chain always ends with the
       timeout. The read itself is a child count and a text length — no layout. */
    const pollDocument = () => {
      if (settled) return;
      if (frameHasRenderedDocument(frame)) {
        done();
        return;
      }
      poll = window.setTimeout(pollDocument, 350);
    };
    frame.addEventListener("load", onLoad);
    timer = window.setTimeout(
      () =>
        done(
          new Error(
            `Nothing loaded within ${Math.round(timeoutMs / 1000)}s. The transport may be blocked, or the site may be refusing the proxy.`,
          ),
        ),
      timeoutMs,
    );
    /*
     * The document may already be in place — the load event fires after this
     * call on a fresh frame, but a reused frame can arrive ready. The poll runs
     * last so that a synchronous settle also tears down the listener and the
     * timeout installed just above, instead of leaving them attached.
     */
    pollDocument();
  });
}
