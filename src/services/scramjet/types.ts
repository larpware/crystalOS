/* ==========================================================================
   Scramjet upstream typings

   These describe exactly the globals the official Mercury Workshop bundles
   install (`$scramjetController`, `$scramjetUtils`, `initBootstrap`) as of
   @mercuryworkshop/scramjet-controller 0.0.14 and
   @mercuryworkshop/proxy-bootstrap 0.0.5. They are structural on purpose: no
   upstream code is copied, only the published entry points are described — and
   the backend serves those bundles from disk (see server/scramjet/assets.mjs).
   ========================================================================== */

export interface ScramjetPlugin {
  readonly name: string;
  readonly dependencies: string[];
  install(frame: ScramjetFrame): void;
}

/* ---- hooks and plugins ---------------------------------------------------
   The controller exposes `ManagedPlugin` on `window.$scramjetUtils`; it is the
   supported way to hook a frame without patching Scramjet. A plugin taps a
   hook by handing it a callback that is run with a context and a props object
   that the callback may write to. These describe exactly the two hooks
   CrystalOS uses (see src/services/shield/plugin.ts) and nothing else.
   ------------------------------------------------------------------------ */

export interface TapOrder {
  /** Run before these plugins. */
  before?: readonly string[];
  /** Run after these plugins. */
  after?: readonly string[];
}

export type HookCallback<Context, Props> = (context: Context, props: Props) => void | Promise<void>;

export interface ScramjetManagedPlugin extends ScramjetPlugin {
  /** The frame this plugin was installed on, or null before installation. */
  frame: ScramjetFrame | null;
  tap<Context, Props>(hook: unknown, callback: HookCallback<Context, Props>, order?: TapOrder): void;
}

/** The headers object a hook may put on a synthesized response. */
export interface ScramjetHeadersLike {
  set(key: string, value: string): void;
  get(key: string): string | null;
  has(key: string): boolean;
  delete(key: string): void;
  /** The controller calls this to carry synthesized headers out of the page. */
  toRawHeaders(): [string, string][];
}

export interface ScramjetHeadersConstructor {
  new (): ScramjetHeadersLike;
  fromRawHeaders(raw: [string, string][]): ScramjetHeadersLike;
}

/** The context Scramjet hands to `fetch.intercept` callbacks. */
export interface ScramjetInterceptContext {
  parsed: {
    /** The real destination URL, already un-rewritten. */
    url: URL;
    /** The URL of the page that asked for it, when it is known. */
    clientUrl?: URL | null;
    /** The request destination (`document`, `script`, `image`, …). */
    destination: string;
    isIframe?: boolean;
  };
}

/**
 * What an intercept callback may write to. Setting `response` returns it to the
 * page without the request ever leaving: this is how a request is blocked.
 */
export interface ScramjetInterceptProps {
  response?: {
    body: string;
    status: number;
    statusText: string;
    headers: ScramjetHeadersLike;
  };
}

/** The context Scramjet hands to `init.post` callbacks, once per document. */
export interface ScramjetInitContext {
  /** The proxied page's own window: same origin as the shell, main world. */
  window: Window | null;
  isTopLevel: boolean;
}

export interface ScramjetFrameInitHooks {
  pre: unknown;
  post: unknown;
}

/**
 * The request an `error.request` callback is told about.
 *
 * Scramjet's own `TransferRequest` is wider than this; these are the fields the
 * reporter reads, and only these, so a change to the rest cannot break it.
 */
export interface ScramjetFailedRequest {
  /** The real destination URL, already un-rewritten. */
  rawUrl?: string;
  /** The request destination (`document`, `script`, `image`, …). */
  destination?: string;
  method?: string;
  mode?: string;
}

/** The context Scramjet hands to `error.request` callbacks. */
export interface ScramjetErrorContext {
  rawrequest: ScramjetFailedRequest;
  error: unknown;
}

/** What an `error.request` callback may write to. */
export interface ScramjetErrorProps {
  /** An answer to give the page instead of the failure. */
  setResponse?: ScramjetInterceptProps["response"];
  /** True to keep the failure out of the console. */
  suppressError?: boolean;
}

export interface ScramjetFrameErrorHooks {
  request: unknown;
}

/** A frame as the plugin sees it: the public shape plus the hooks it taps. */
export interface ScramjetFrameWithHooks extends ScramjetFrame {
  hooks: {
    fetch: { intercept: unknown };
    init: ScramjetFrameInitHooks;
    error: ScramjetFrameErrorHooks;
  };
}

export interface ScramjetFrame {
  readonly id: string;
  readonly prefix: string;
  readonly element: HTMLIFrameElement;
  plugins: ScramjetPlugin[];
  /** Navigates the frame to an absolute URL. */
  go(url: string): void;
  back(): void;
  forward(): void;
  reload(): void;
  getPlugin<T extends ScramjetPlugin>(name: string): T;
}

export interface ScramjetControllerConfig {
  prefix: string;
  scramjetPath: string;
  injectPath: string;
  wasmPath: string;
  virtualWasmPath: string;
  codec: Record<"encode" | "decode", (input: string) => string>;
}

export interface ScramjetController {
  config: ScramjetControllerConfig;
  prefix: string;
  frames: ScramjetFrame[];
  /** Resolves once the rewriter wasm, cookies and the service worker are ready. */
  wait(): Promise<void>;
  createFrame(
    element?: HTMLIFrameElement,
    options?: { plugins?: ScramjetPlugin[] },
  ): ScramjetFrame;
}

interface ScramjetUtilsGlobal {
  HttpCachePlugin: new () => ScramjetPlugin;
  UrlWatcherPlugin: new (onUrl: (url: string) => void) => ScramjetPlugin;
  CatchEscapedLinksPlugin: new (onLink: (url: URL) => unknown) => ScramjetPlugin;
  ManagedPlugin: new (name: string, dependencies: string[]) => ScramjetManagedPlugin;
}

declare global {
  interface Window {
    /** Installed by /bootstrap-init.js (proxy-bootstrap). */
    initBootstrap?: (config?: Record<string, unknown>) => Promise<ScramjetController>;
    /** Installed by /controller/controller.api.js. */
    $scramjetController?: {
      Controller: new (init: {
        serviceworker: ServiceWorker;
        transport: unknown;
        config?: Partial<ScramjetControllerConfig>;
      }) => ScramjetController;
      config: ScramjetControllerConfig;
    };
    /** Installed by /scram/scramjet-utils.js. */
    $scramjetUtils?: ScramjetUtilsGlobal;
    /**
     * The core bundle. It installs itself as `$scramjet`; the utils bundle
     * reaches `ManagedPlugin` and `ScramjetHeaders` through it, which is why
     * `ScramjetHeaders` is reachable from the shell as well.
     */
    $scramjet?: {
      ScramjetHeaders: ScramjetHeadersConstructor;
      Plugin: unknown;
    };
    /** libcurl transport client entry point. */
    LibcurlTransport?: { LibcurlClient: new (options: { wisp: string }) => unknown };
    /** epoxy transport client entry point. */
    EpoxyTransport?: { EpoxyClient: new (options: { wisp: string }) => unknown };
  }
}

export {};
