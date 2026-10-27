import type {
  ScramjetFrame,
  ScramjetFrameWithHooks,
  ScramjetHeadersConstructor,
  ScramjetHeadersLike,
  ScramjetInitContext,
  ScramjetInterceptContext,
  ScramjetInterceptProps,
  ScramjetManagedPlugin,
  ScramjetPlugin,
} from "@/services/scramjet/types";
import type { FilterList, ResourceType } from "./filter";
import { hostnameOf, siteOf } from "./filter";
import { decidePopup, decideRequest, typeOfDestination } from "./decision";
import { defaultFilterList } from "./list";
import {
  getShieldState,
  isPopupSiteAllowed,
  isSiteAllowed,
  noteBlocked,
  notePopup,
} from "./state";

/* ==========================================================================
   CrystalOS Shield — the plugin

   Enforcement happens in the same place the requests are already passing
   through: a Scramjet plugin installed on every proxied frame. That is the
   supported extension point (window.$scramjetUtils.ManagedPlugin) — no Scramjet
   source is patched, and nothing is vendored.

   Two hooks are used:

     fetch.intercept   runs before the request leaves the page and before the
                       HTTP cache is consulted, and a callback that sets
                       `props.response` short-circuits the whole fetch. That is
                       where a blocked request becomes a local answer instead of
                       a network round trip.

     init.post         runs once per proxied document, with that document's own
                       window in the context. That is where `window.open` is
                       shadowed, after Scramjet has finished installing its own
                       version of it, so an allowed popup still goes through the
                       proxy and a blocked one never opens.

   Everything the plugin decides comes from `./decision`, and what it remembers
   comes from `./state`; this file is only the wiring.
   ========================================================================== */

export interface ShieldPluginOptions {
  /** What the counters belong to: a browser tab, a window, an app. */
  owner?: string | null;
  /** Defaults to the list that ships with the OS. */
  list?: FilterList;
}

/* ---- synthesized answers ------------------------------------------------- */

/** A 1×1 transparent image, for low-data mode. Text, so no byte juggling. */
const PLACEHOLDER_IMAGE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';

const BLOCK_PAGE = [
  "<!doctype html>",
  '<html lang="en"><head><meta charset="utf-8">',
  "<title>Blocked by CrystalOS Shield</title>",
  "<style>",
  "html,body{margin:0;height:100%}",
  "body{display:flex;align-items:center;justify-content:center;",
  "font:15px/1.6 system-ui,sans-serif;background:#0c0d12;color:#d9dbe4}",
  "main{max-width:34rem;padding:2rem}",
  "h1{font-size:1.1rem;margin:0 0 .6rem}",
  "p{margin:0 0 .5rem;color:#a2a6b8}",
  "code{font-size:.85em;color:#cdd3e6;word-break:break-all}",
  "</style></head><body><main>",
  "<h1>This page is on CrystalOS Shield's block list</h1>",
  "<p>Turn Shield off for this site in the browser toolbar, or in Settings, to load it anyway.</p>",
  "</main></body></html>",
].join("");

function headersFor(
  Constructor: ScramjetHeadersConstructor,
  contentType: string,
): ScramjetHeadersLike {
  return Constructor.fromRawHeaders([
    ["Content-Type", contentType],
    // The answer is this machine's, not the site's, and it must never be
    // remembered as if the site had served it.
    ["Cache-Control", "no-store"],
    ["X-Crystal-Shield", "blocked"],
  ]);
}

/* ---- the plugin ---------------------------------------------------------- */

/**
 * Builds the Shield plugin, or returns null when the frame's plugin support is
 * not present. Returning null rather than a stub is deliberate: a blocker that
 * silently does nothing is worse than none, and the caller reports the absence.
 */
export function createShieldPlugin(options: ShieldPluginOptions = {}): ScramjetPlugin | null {
  if (typeof window === "undefined") return null;
  const Managed = window.$scramjetUtils?.ManagedPlugin;
  const Headers: ScramjetHeadersConstructor | undefined = window.$scramjet?.ScramjetHeaders;
  if (!Managed || !Headers) return null;
  const HeaderConstructor: ScramjetHeadersConstructor = Headers;

  const owner = options.owner ?? null;
  const list = options.list ?? defaultFilterList();

  class CrystalShieldPlugin extends Managed {
    /** Documents whose `window.open` was already shadowed. */
    private readonly attached = new WeakSet<Window>();

    constructor() {
      super("crystal-shield", []);
    }

    override install(frame: ScramjetFrame): void {
      super.install(frame);
      const hooks = (frame as ScramjetFrameWithHooks).hooks;
      if (!hooks) return;

      this.tap<ScramjetInterceptContext, ScramjetInterceptProps>(
        hooks.fetch.intercept,
        (context, props) => {
          /*
           * Nothing here may break a page. A blocker that throws turns into a
           * failed request, which is a worse outcome than an ad that loads, so a
           * mistake anywhere in the decision lets the request through instead.
           */
          try {
            const answer = this.judge(context);
            if (!answer) return;
            props.response = answer;
          } catch {
            /* fail open: the request proceeds exactly as it would without Shield */
          }
        },
      );

      this.tap<ScramjetInitContext, Record<string, never>>(hooks.init.post, (context) => {
        try {
          this.watchPopups(context);
        } catch {
          /* a page that cannot be watched keeps the browser's own popup rules */
        }
      });
    }

    /** The decision for one request, as a response, or null to let it through. */
    private judge(context: ScramjetInterceptContext): ScramjetInterceptProps["response"] | null {
      const settings = getShieldState().settings;
      if (!settings.enabled && !settings.lowData) return null;

      const url = context.parsed?.url?.href;
      if (!url) return null;
      const host = hostnameOf(url);
      if (!host) return null;

      const pageUrl = context.parsed.clientUrl?.href ?? null;
      const type: ResourceType = typeOfDestination(context.parsed.destination ?? "");

      const outcome = decideRequest({
        url,
        pageUrl,
        type,
        settings,
        list,
        siteAllowed:
          isSiteAllowed(host) ||
          // A rule can match a third party the page merely embeds; the site the
          // user is actually looking at is what "allow this site" means.
          isSiteAllowed(pageUrl ? hostnameOf(pageUrl) : null),
      });

      if (outcome.action === "allow") return null;

      noteBlocked(owner, host, outcome.type, outcome.action === "block" ? outcome.rule : null);

      if (outcome.action === "placeholder") {
        return {
          body: PLACEHOLDER_IMAGE,
          status: 200,
          statusText: "OK",
          headers: HeaderConstructor.fromRawHeaders([
            ["Content-Type", "image/svg+xml"],
            ["Cache-Control", "no-store"],
            ["X-Crystal-Shield", "low-data"],
          ]),
        };
      }

      // A document gets a page that explains itself; anything else gets the
      // smallest possible "no content", which is what a blocked subresource
      // should look like to the code that asked for it.
      const isDocument =
        context.parsed.destination === "document" || context.parsed.destination === "iframe";
      if (isDocument) {
        return {
          body: BLOCK_PAGE,
          status: 403,
          statusText: "Forbidden",
          headers: headersFor(HeaderConstructor, "text/html; charset=utf-8"),
        };
      }
      return {
        body: "",
        status: 204,
        statusText: "No Content",
        headers: headersFor(HeaderConstructor, "text/plain; charset=utf-8"),
      };
    }

    /** Shadows `window.open` on one proxied document. */
    private watchPopups(context: ScramjetInitContext): void {
      const win = context.window;
      if (!win || this.attached.has(win)) return;
      this.attached.add(win);
      const doc = win.document;
      if (!doc) return;

      /*
       * The page's own input is the only thing that counts as asking. The
       * listener is passive and on the document in the capture phase, so it
       * costs the page nothing and cannot be stopped by a stray
       * stopPropagation().
       */
      let lastGesture = 0;
      const note = () => {
        lastGesture = Date.now();
      };
      for (const event of ["pointerdown", "mousedown", "keydown", "touchstart", "click"]) {
        doc.addEventListener(event, note, { capture: true, passive: true });
      }

      const original = win.open.bind(win);
      const shadowed: Window["open"] = function open(url?: string | URL, target?: string, features?: string) {
        const asked = url === undefined || url === null ? null : String(url);
        // An empty request opens about:blank, which the page then fills in.
        if (!asked) return original(url, target, features);

        const settings = getShieldState().settings;
        const pageUrl = win.location?.href ?? null;
        const pageHost = pageUrl ? hostnameOf(pageUrl) : null;

        const outcome = decidePopup({
          url: asked,
          pageUrl,
          gestureAgeMs: lastGesture === 0 ? null : Date.now() - lastGesture,
          settings,
          siteAllowed: isPopupSiteAllowed(pageHost),
        });
        if (outcome.action === "allow") return original(url, target, features);

        notePopup({ url: asked, pageUrl, owner });
        // What the browser itself returns from a blocked popup.
        return null;
      };

      try {
        win.open = shadowed;
      } catch {
        /* A window that refuses the assignment keeps the browser's own rules. */
      }
    }
  }

  return new CrystalShieldPlugin() as unknown as ScramjetManagedPlugin & ScramjetPlugin;
}

/** True when the shell can install plugins at all; used by Settings to explain. */
export function shieldAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.$scramjetUtils?.ManagedPlugin && window.$scramjet?.ScramjetHeaders);
}

/** The site a URL belongs to, for the panel's "allow this site" row. */
export function siteOfUrl(url: string | null): string | null {
  if (!url) return null;
  const host = hostnameOf(url);
  return host ? siteOf(host) : null;
}
