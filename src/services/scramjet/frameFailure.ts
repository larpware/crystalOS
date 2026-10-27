import type {
  ScramjetErrorContext,
  ScramjetErrorProps,
  ScramjetFrame,
  ScramjetFrameWithHooks,
  ScramjetManagedPlugin,
  ScramjetPlugin,
} from "@/services/scramjet/types";

/* ==========================================================================
   The frame's own report that a request failed

   A proxied request that cannot be completed fails inside the Scramjet client,
   and the client answers the *page* with a page of its own (a single `<pre>`
   starting `Internal Service Worker Error:`). `frameError.ts` recognises that
   page once it has been rendered. Recognising it is not the same as being told:
   the shell has to wait for the document to arrive, read it, and only then find
   out — and when the request that failed was the document itself, what the
   browser shows in the meantime is an empty frame. That is the blank pane.

   The client also announces the failure as it happens, on the `error.request`
   hook, with the request and the error in the context. Tapping that hook turns
   "wait until something is rendered, then read it" into "know immediately, with
   the transport's own words". Only the frame's own document is reported: a
   subresource that fails must not put an error over a working page.

   The plugin is installed per frame by `createProxiedFrame`, and it changes
   nothing about the request — it does not set a response and it does not
   suppress the console line the client would otherwise write.
   ========================================================================== */

/** What the frame reported, in the shell's terms. */
export interface FrameFailure {
  /** The address that failed. */
  url: string;
  /** The transport's own message, untouched. */
  message: string;
}

export interface FrameFailureReporterOptions {
  /** Called once per failed document request. */
  onFailure: (failure: FrameFailure) => void;
}

/**
 * The message of a thrown value, whatever it is.
 *
 * The client throws whatever the transport threw, and the transports do not
 * agree on a shape; an empty string is the honest answer for anything that
 * carries no message at all.
 */
export function failureMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/**
 * True when this hook call is the frame's own document failing.
 *
 * `document` is the top-level navigation of the frame — the thing whose failure
 * leaves the pane empty. `iframe` is a document *inside* the page, which the
 * page itself handles, and everything else is a subresource.
 */
export function isDocumentFailure(request: { destination?: string } | null | undefined): boolean {
  return request?.destination === "document";
}

/**
 * Builds the reporter plugin, or returns null when either the frame's plugin
 * support or the callback is missing. Returning null keeps the caller honest:
 * the shell falls back to reading the rendered error page.
 */
export function createFailureReporterPlugin(
  options: FrameFailureReporterOptions,
): ScramjetPlugin | null {
  if (typeof window === "undefined") return null;
  const Managed = window.$scramjetUtils?.ManagedPlugin;
  if (!Managed || typeof options?.onFailure !== "function") return null;

  const onFailure = options.onFailure;

  class CrystalFailureReporter extends Managed {
    constructor() {
      super("crystal-frame-failure", []);
    }

    override install(frame: ScramjetFrame): void {
      super.install(frame);
      const hooks = (frame as ScramjetFrameWithHooks).hooks;
      if (!hooks?.error?.request) return;

      this.tap<ScramjetErrorContext, ScramjetErrorProps>(hooks.error.request, (context) => {
        if (!isDocumentFailure(context?.rawrequest)) return;
        const message = failureMessage(context.error);
        try {
          onFailure({ url: context.rawrequest?.rawUrl ?? "", message });
        } catch {
          /*
           * The request has already failed; a shell that cannot be told must not
           * turn that into a second, worse failure inside the client.
           */
        }
      });
    }
  }

  return new CrystalFailureReporter() as unknown as ScramjetManagedPlugin & ScramjetPlugin;
}
