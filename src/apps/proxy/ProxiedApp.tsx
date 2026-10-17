import { useCallback, useEffect, useRef, useState } from "react";
import { IconButton, Tooltip } from "@/components/ui";
import { Icon, type IconName } from "@/icons/Icon";
import { useProxiedFrame, useScramjetState } from "@/services/scramjet/useProxiedFrame";
import { useSystemStore } from "@/state/system";
import { displayAddress, normaliseDestination } from "./url";
import type { AppProps } from "@/types";

/* ==========================================================================
   Proxied application surface

   Shared chrome for every Scramjet-powered application. Applications supply a
   destination and presentation options; this component owns the proxied frame,
   the navigation controls, the connection state and the honest failure states.

   When the proxy is switched off — either by the OS-wide toggle or because the
   frame could not load and the user chose to continue without it — the
   destination is loaded directly by this window instead. That keeps the site
   inside CrystalOS, in this window, rather than throwing it out to a new
   browser tab.
   ========================================================================== */

export interface ProxiedAppOptions {
  /** Initial destination, loaded through Scramjet. */
  destination: string;
  /** Name shown in the toolbar and used in status copy. */
  label: string;
  icon: IconName;
  /** Editable address field (Browser-like) or read-only label. */
  addressBar?: "editable" | "readonly" | "hidden";
  /** Short description of what the destination is, shown while connecting. */
  destinationNote: string;
  /**
   * How this application loads its destination by default.
   *
   * `"proxy"` (the default) is the shared Scramjet path. `"direct"` frames the
   * site itself, for a site whose own client router cannot survive the proxy's
   * URL rewriting; the site is then loaded by its real origin, in its own
   * document, so its routing, storage and cookies behave exactly as they do in
   * a browser tab. The OS-wide proxy toggle still wins when it is switched off,
   * and the toolbar keeps offering the other mode either way.
   */
  mode?: "proxy" | "direct";
  /** Why this application defaults to direct mode, shown where it matters. */
  directReason?: string;
}

export function ProxiedApp({ options, args }: AppProps & { options: ProxiedAppOptions }) {
  const requested = typeof args?.url === "string" ? args.url : null;
  const initial = requested ? (normaliseDestination(requested) ?? options.destination) : options.destination;

  const proxyEnabled = useSystemStore((state) => state.proxyEnabled);
  const proxyModes = useSystemStore((state) => state.proxyModes);
  const setProxyMode = useSystemStore((state) => state.setProxyMode);
  const frame = useProxiedFrame(initial);
  const proxy = useScramjetState();
  const [address, setAddress] = useState(initial);
  // An application that asked to be loaded directly: its own site needs its
  // real origin when it inherits the switch (see `ProxiedAppOptions.mode`).
  const directByDefault = options.mode === "direct";
  /** This application's saved stance; a missing entry means "follow the OS switch". */
  const override = proxyModes[options.destination] ?? "inherit";
  /**
   * Whether this window is actually using Scramjet right now.
   *
   * An explicit choice for this application wins over the OS-wide switch — the
   * same layering the Browser's per-tab override uses — and an application that
   * inherits gets the proxy when the switch is on, unless it asked for direct
   * mode as its default.
   */
  const useProxy =
    override === "on" ? true : override === "off" ? false : proxyEnabled && !directByDefault;
  /** The proxied frame element, kept locally so its document can be inspected. */
  const frameEl = useRef<HTMLIFrameElement | null>(null);
  /**
   * The frame reported a load but the document is empty.
   *
   * A proxied page can finish loading onto a path that does not exist — the
   * known `/undefined` artifact of a client router calling into history across
   * the proxy's URL rewriting — and the window then shows nothing at all while
   * the toolbar says "Proxied". That is the worst possible state: the user
   * cannot tell a slow page from a broken one. This flag turns it into a stated
   * failure with a retry and a way to load the site without the proxy.
   */
  const [emptyFrame, setEmptyFrame] = useState(false);
  /**
   * Remount counter for the direct frame.
   *
   * A directly loaded site has no Scramjet controller behind it, so there is
   * nothing to ask for a reload; re-keying the element is how this window does
   * it. Without this the Refresh button did nothing at all in direct mode.
   */
  const [directKey, setDirectKey] = useState(0);
  const reloadDirect = useCallback(() => setDirectKey((key) => key + 1), []);

  const attachFrame = useCallback(
    (element: HTMLIFrameElement | null) => {
      frameEl.current = element;
      frame.attach(element);
    },
    [frame],
  );

  useEffect(() => {
    setAddress(frame.url || initial);
  }, [frame.url, initial]);

  /*
   * Once the frame reports a load, give the page a moment to build itself and
   * then check whether anything arrived. Reading the document is only possible
   * because a proxied document is same-origin with the shell; a frame that has
   * navigated somewhere else throws, and an unreadable document is not evidence
   * of an empty one, so it is left alone.
   */
  useEffect(() => {
    setEmptyFrame(false);
    if (frame.status !== "ready") return undefined;
    const timer = window.setTimeout(() => {
      const element = frameEl.current;
      if (!element) return;
      let document_: Document | null = null;
      try {
        document_ = element.contentDocument;
      } catch {
        return;
      }
      const body = document_?.body;
      if (!body) return;
      const hasContent = body.childElementCount > 0 && body.textContent!.trim().length > 0;
      if (!hasContent) setEmptyFrame(true);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [frame.status, frame.url]);

  const status = describeStatus(frame.status, proxy.status, proxy.transport);
  /** What this window is showing: the site directly, or through Scramjet. */
  const showDirect = !useProxy;

  const submit = () => {
    const next = normaliseDestination(address);
    if (!next) {
      setAddress(frame.url);
      return;
    }
    if (showDirect) {
      setAddress(next);
      return;
    }
    frame.go(next);
    setAddress(next);
  };
  // A load that produced an empty document is reported as a failed load, with
  // its own explanation, rather than as a working proxy with nothing to show.
  const failedLoad = frame.status === "error" || emptyFrame;
  const overlayTitle = emptyFrame
    ? `${options.label} loaded an empty page`
    : `${options.label} could not load`;
  const overlayBody = emptyFrame
    ? "The proxy delivered the site, but the page it rendered is blank. This usually means the site's own router navigated to a path that does not exist through the proxy."
    : (frame.error ?? "The proxied page did not load.");

  /* ---- per-application proxy switch -------------------------------------
     Every proxied window carries the same control the Browser toolbar has:
     one square button whose icon and tooltip carry the state, and whose click
     changes this application's stance only. It sits in both branches, so the
     way out of either mode is never behind a failure. */
  const proxyToggleHint = useProxy
    ? override === "inherit"
      ? `${options.label} follows the OS proxy switch, which is on. Click to load this site directly instead.`
      : `The proxy is forced on for ${options.label}, whatever the OS switch says. Click to load this site directly instead.`
    : override === "inherit"
      ? directByDefault
        ? `${options.label} loads its site directly by default. Click to load it through Scramjet.`
        : `${options.label} follows the OS proxy switch, which is off. Click to load it through Scramjet.`
      : `The proxy is off for ${options.label}, whatever the OS switch says. Click to load it through Scramjet.`;

  const proxyToggle = (
    <Tooltip label={proxyToggleHint}>
      <button
        type="button"
        className="cr-proxy__toggle"
        data-on={useProxy ? "true" : "false"}
        data-tone={useProxy && proxy.status === "error" ? "bad" : "ok"}
        aria-pressed={useProxy}
        aria-label={useProxy ? "Proxy on for this application" : "Proxy off for this application"}
        onClick={() => setProxyMode(options.destination, useProxy ? "off" : "on")}
      >
        <Icon
          name={!useProxy ? "globe" : proxy.status === "error" ? "warning" : proxy.status === "ready" ? "shield" : "activity"}
          size={14}
        />
      </button>
    </Tooltip>
  );

  const nav = (
    <div className="cr-proxy__nav">
      <IconButton icon="chevron-left" label="Back" disabled={showDirect || !frame.canGoBack} onClick={frame.back} />
      <IconButton icon="chevron-right" label="Forward" disabled={showDirect || !frame.canGoForward} onClick={frame.forward} />
      <IconButton
        icon={!showDirect && frame.status === "loading" ? "close" : "refresh"}
        label={!showDirect && frame.status === "loading" ? "Stop" : "Reload"}
        onClick={showDirect ? reloadDirect : frame.reload}
      />
    </div>
  );

  const addressBar = options.addressBar !== "hidden" && (
    <form
      className="cr-proxy__address"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Icon name={options.icon} size={14} className="cr-proxy__address-icon" />
      {options.addressBar === "editable" ? (
        <input
          value={address}
          aria-label={`${options.label} address`}
          spellCheck={false}
          onChange={(event) => setAddress(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
        />
      ) : (
        <span className="cr-proxy__address-text" title={frame.url}>
          {displayAddress(showDirect ? address : frame.url) || options.label}
        </span>
      )}
    </form>
  );

  if (showDirect) {
    return (
      <div className="cr-proxy" data-status="ready" data-direct="true">
        <header className="cr-proxy__bar">
          {nav}
          {addressBar}
          <div className="cr-proxy__status" data-tone="busy">
            <span className="cr-proxy__status-dot" aria-hidden="true" />
            <Tooltip
              label={
                options.directReason ??
                "Loaded by this window itself, without Scramjet."
              }
            >
              <span className="cr-proxy__status-text">Direct</span>
            </Tooltip>
          </div>
          {proxyToggle}
        </header>

        <div className="cr-proxy__direct-bar" role="status">
          <Icon name="warning" size={13} />
          <span>
            {proxyEnabled
              ? (options.directReason ??
                `${options.label} is loading ${displayAddress(initial)} directly in this window, without the proxy.`)
              : `${options.label} is loading directly because the proxy is switched off.`}{" "}
            A site that refuses to be framed will stay blank.
          </span>
          {proxyEnabled &&
            (options.directReason ? (
              <Tooltip label={options.directReason}>
                <button
                  type="button"
                  className="cr-btn cr-btn--default cr-btn--sm"
                  onClick={() => setProxyMode(options.destination, "on")}
                >
                  <Icon name="globe" size={14} />
                  Use the proxy
                </button>
              </Tooltip>
            ) : (
              <button type="button" className="cr-btn cr-btn--default cr-btn--sm" onClick={() => setProxyMode(options.destination, "on")}>
                <Icon name="globe" size={14} />
                Use the proxy
              </button>
            ))}
        </div>

        <div className="cr-proxy__viewport">
          <iframe
            key={directKey}
            className="cr-proxy__frame"
            title={`${options.label} (direct)`}
            src={address}
            sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts allow-downloads"
            allow="clipboard-write; clipboard-read; fullscreen; gamepad; autoplay; encrypted-media; microphone; camera"
            referrerPolicy="no-referrer"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="cr-proxy" data-status={frame.status}>
      <header className="cr-proxy__bar">
        {nav}
        {addressBar}

        <div className="cr-proxy__status" data-tone={emptyFrame ? "bad" : status.tone}>
          <span className="cr-proxy__status-dot" aria-hidden="true" />
          <Tooltip label={status.detail}>
            <span className="cr-proxy__status-text">
              {emptyFrame ? "Empty page" : status.label}
            </span>
          </Tooltip>
          {failedLoad && (
            <button type="button" className="cr-proxy__retry" onClick={frame.retry}>
              Retry
            </button>
          )}
        </div>
        {proxyToggle}
      </header>

      <div className="cr-proxy__viewport">
        <iframe
          ref={attachFrame}
          className="cr-proxy__frame"
          title={`${options.label} (proxied by Scramjet)`}
          // Scramjet rewrites and runs the document itself, so the frame needs
          // scripts and same-origin access to its own prefix.
          sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts allow-downloads allow-storage-access-by-user-activation"
          allow="clipboard-write; clipboard-read; fullscreen; gamepad; autoplay; encrypted-media; microphone; camera"
        />

        {failedLoad || frame.status !== "ready" ? (
          <div className="cr-proxy__overlay" data-kind={failedLoad ? "error" : "loading"}>
            {failedLoad ? (
              <>
                <span className="cr-proxy__overlay-icon">
                  <Icon name="warning" size={24} />
                </span>
                <h3>{overlayTitle}</h3>
                <p>{overlayBody}</p>
                <p className="cr-proxy__overlay-note">
                  Destination: <code className="cr-code">{initial}</code>
                </p>
                <div className="cr-proxy__overlay-actions">
                  <button type="button" className="cr-btn cr-btn--primary" onClick={frame.retry}>
                    <Icon name="refresh" size={15} />
                    Try again
                  </button>
                  {/* Opens the site in this very window, not in a new tab. */}
                  <button type="button" className="cr-btn cr-btn--default" onClick={() => setProxyMode(options.destination, "off")}>
                    <Icon name="globe" size={15} />
                    Open without the proxy
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="cr-proxy__spinner" aria-hidden="true" />
                <h3>Connecting through Scramjet</h3>
                <p>{options.destinationNote}</p>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function describeStatus(
  frameStatus: "connecting" | "loading" | "ready" | "error",
  proxyStatus: "idle" | "loading" | "ready" | "error",
  transport: string | null,
): { label: string; detail: string; tone: "ok" | "busy" | "bad" } {
  if (proxyStatus === "error") {
    return {
      label: "Proxy offline",
      detail: "The Scramjet backend is not reachable from this origin. Start it with `npm run scramjet`, then retry.",
      tone: "bad",
    };
  }
  if (frameStatus === "error") {
    return {
      label: "Not loaded",
      detail: "The proxied page did not load. Retry, or check the backend log for what the origin returned.",
      tone: "bad",
    };
  }
  if (frameStatus === "ready") {
    return {
      label: transport ? `Proxied · ${transport}` : "Proxied",
      detail: "This page is being loaded through Scramjet and the Wisp transport.",
      tone: "ok",
    };
  }
  return {
    label: "Connecting",
    detail: "Starting the Scramjet controller and dialling the transport.",
    tone: "busy",
  };
}

export default ProxiedApp;
