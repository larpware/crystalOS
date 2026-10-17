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
    /** libcurl transport client entry point. */
    LibcurlTransport?: { LibcurlClient: new (options: { wisp: string }) => unknown };
    /** epoxy transport client entry point. */
    EpoxyTransport?: { EpoxyClient: new (options: { wisp: string }) => unknown };
  }
}

export {};
