import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, EmptyState, IconButton, Spinner, Tooltip } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import {
  resolveCommunityApp,
  type CommunityApp,
} from "@/services/communityApps";
import { notify, openApp } from "@/services/os";
import { useAppsStore } from "@/state/apps";
import { useBrowserStore } from "@/state/browser";
import { useWindowStore } from "@/state/windows";
import type { AppProps } from "@/types";

/* ==========================================================================
   Community App Runtime
   Secure, sandboxed iframe runtime for user-submitted community applications.

   Security invariants:
   1. sandbox="allow-scripts allow-forms allow-popups allow-modals"
      - NO allow-same-origin: isolated completely from CrystalOS parent origin
      - NO allow-top-navigation: cannot hijack or redirect parent window
   2. Strict validation of verification status:
      - Suspended or unverified applications are blocked from execution immediately.
   3. Controlled navigation:
      - Option to safely open in Crystal Browser with Scramjet proxy.
   4. Honest error states:
      - Detected X-Frame-Options / frame-ancestors blockage and timeout handling.
   ========================================================================== */

interface CommunityAppRuntimeProps extends AppProps {
  appId?: string;
  initialApp?: CommunityApp;
}

export function CommunityAppRuntime({ windowId, args, appId: explicitAppId, initialApp }: CommunityAppRuntimeProps) {
  // Extract real community app ID from explicit prop, args, or window metadata
  const targetAppId = useMemo(() => {
    if (explicitAppId) return explicitAppId.replace(/^community:/, "");
    if (typeof args?.communityAppId === "string") return args.communityAppId.replace(/^community:/, "");
    if (typeof args?.appId === "string") return args.appId.replace(/^community:/, "");
    const win = useWindowStore.getState().windows.find((w) => w.id === windowId);
    if (win?.appId) return win.appId.replace(/^community:/, "");
    return "";
  }, [explicitAppId, args, windowId]);

  const [app, setApp] = useState<CommunityApp | null>(initialApp ?? null);
  const [loadingApp, setLoadingApp] = useState(!initialApp);
  const [iframeKey, setIframeKey] = useState(0);
  const [iframeLoading, setIframeLoading] = useState(true);
  const [iframeTimedOut, setIframeTimedOut] = useState(false);
  const [frameBlocked, setFrameBlocked] = useState(false);

  const uninstallCommunity = useAppsStore((state) => state.uninstallCommunity);
  const closeWindow = useWindowStore((state) => state.close);

  // Live check and resolve app metadata from Supabase
  useEffect(() => {
    let cancelled = false;
    if (!targetAppId) {
      setLoadingApp(false);
      return;
    }

    setLoadingApp(true);
    void resolveCommunityApp(targetAppId).then((resolved) => {
      if (cancelled) return;
      setLoadingApp(false);
      if (resolved) {
        setApp(resolved);
        // Also update window title if needed
        useWindowStore.getState().setTitle(windowId, `${resolved.name} (Community)`);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [targetAppId, windowId]);

  // Loading timeout detector for X-Frame-Options or connection blockage
  useEffect(() => {
    if (!app || app.verificationStatus !== "verified") return;
    setIframeLoading(true);
    setIframeTimedOut(false);
    setFrameBlocked(false);

    const timer = setTimeout(() => {
      setIframeTimedOut(true);
    }, 10_000);

    return () => clearTimeout(timer);
  }, [iframeKey, app]);

  const handleIframeLoad = () => {
    setIframeLoading(false);
    setIframeTimedOut(false);
  };

  const handleIframeError = () => {
    setIframeLoading(false);
    setFrameBlocked(true);
  };

  const reloadIframe = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

  const openInBrowser = useCallback(() => {
    if (!app?.websiteUrl) return;
    const tabId = useBrowserStore.getState().newTab(app.websiteUrl, true);
    openApp("browser", { args: { tabId } });
  }, [app]);

  const handleUninstall = useCallback(() => {
    if (!targetAppId) return;
    uninstallCommunity(targetAppId);
    notify({ title: "Community App", body: `Uninstalled ${app?.name ?? "application"}.` });
    closeWindow(windowId);
  }, [targetAppId, uninstallCommunity, app, closeWindow, windowId]);

  // Derive domain from website URL
  const domain = useMemo(() => {
    if (!app?.websiteUrl) return "";
    try {
      return new URL(app.websiteUrl).hostname;
    } catch {
      return app.websiteUrl;
    }
  }, [app?.websiteUrl]);

  if (loadingApp) {
    return (
      <div className="cr-comm-runtime cr-comm-runtime--loading">
        <Spinner label="Verifying application security" />
        <p className="cr-comm-runtime__msg">Checking community application status...</p>
      </div>
    );
  }

  if (!app) {
    return (
      <div className="cr-comm-runtime cr-comm-runtime--error">
        <EmptyState
          icon="warning"
          title="Application Unavailable"
          hint="Could not resolve community application metadata or it may have been deleted."
        />
        <Button variant="secondary" onClick={() => closeWindow(windowId)}>
          Close Window
        </Button>
      </div>
    );
  }

  // Security gate: Suspended applications MUST NOT render iframe!
  if (app.verificationStatus === "suspended") {
    return (
      <div className="cr-comm-runtime cr-comm-runtime--blocked">
        <div className="cr-comm-runtime__alert cr-comm-runtime__alert--danger">
          <Icon name="warning" size={32} />
          <h3>Application Suspended</h3>
          <p>
            This community application has been suspended by CrystalOS staff for safety concerns.
          </p>
          {app.suspensionReason && (
            <div className="cr-comm-runtime__reason">
              <strong>Reason:</strong> {app.suspensionReason}
            </div>
          )}
          <div className="cr-comm-runtime__actions">
            <Button variant="danger" icon="trash" onClick={handleUninstall}>
              Uninstall Application
            </Button>
            <Button variant="secondary" onClick={() => closeWindow(windowId)}>
              Close Window
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Security gate: Unverified or changes_requested or rejected apps
  if (app.verificationStatus !== "verified") {
    return (
      <div className="cr-comm-runtime cr-comm-runtime--blocked">
        <div className="cr-comm-runtime__alert cr-comm-runtime__alert--warning">
          <Icon name="info" size={32} />
          <h3>Application Not Verified</h3>
          <p>
            This application is currently <strong>{app.verificationStatus.replace("_", " ")}</strong>.
            Only manually verified community apps can execute inside CrystalOS.
          </p>
          {app.rejectionReason && (
            <div className="cr-comm-runtime__reason">
              <strong>Note:</strong> {app.rejectionReason}
            </div>
          )}
          <Button variant="secondary" onClick={() => closeWindow(windowId)}>
            Close Window
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="cr-comm-runtime">
      {/* Top security & navigation toolbar */}
      <header className="cr-comm-runtime__bar">
        <div className="cr-comm-runtime__tags">
          <Badge tone="default" icon="grid">
            Community App
          </Badge>
          <Badge tone="success" icon="check">
            Verified
          </Badge>
          <Tooltip label="Sandboxed iframe: cannot access parent OS, tokens or credentials">
            <span className="cr-comm-runtime__shield">
              <Icon name="shield" size={13} />
              <span>Isolated</span>
            </span>
          </Tooltip>
        </div>

        <div className="cr-comm-runtime__domain" title={app.websiteUrl}>
          <Icon name="lock" size={12} />
          <span>{domain}</span>
        </div>

        <div className="cr-comm-runtime__controls">
          <IconButton
            icon="restart"
            label="Reload application"
            size={14}
            onClick={reloadIframe}
          />
          <IconButton
            icon="browser"
            label="Open in Crystal Browser"
            size={14}
            onClick={openInBrowser}
          />
          <Button
            size="sm"
            variant="ghost"
            icon="warning"
            onClick={() => {
              // Open store to details page for reporting
              openApp("store", { args: { communityAppId: app.id, action: "report" } });
            }}
          >
            Report
          </Button>
        </div>
      </header>

      {/* Frame blockage or timeout warning banner */}
      {(frameBlocked || iframeTimedOut) && (
        <div className="cr-comm-runtime__compat-banner">
          <Icon name="warning" size={15} />
          <span>
            {frameBlocked
              ? "This site refuses to embed in an iframe (X-Frame-Options or CSP restriction)."
              : "Taking longer than usual to load. The site may restrict iframe embedding."}
          </span>
          <Button size="sm" variant="primary" icon="browser" onClick={openInBrowser}>
            Open in Crystal Browser
          </Button>
          <IconButton icon="close" label="Dismiss" size={13} onClick={() => { setIframeTimedOut(false); setFrameBlocked(false); }} />
        </div>
      )}

      {/* Main sandboxed iframe view */}
      <div className="cr-comm-runtime__frame-wrap">
        {iframeLoading && (
          <div className="cr-comm-runtime__frame-loading">
            <Spinner label="Loading application" />
          </div>
        )}
        <iframe
          key={iframeKey}
          src={app.websiteUrl}
          title={app.name}
          className="cr-comm-runtime__iframe"
          // Restrictive sandbox without allow-same-origin or allow-top-navigation
          sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads"
          referrerPolicy="no-referrer"
          loading="lazy"
          onLoad={handleIframeLoad}
          onError={handleIframeError}
        />
      </div>
    </div>
  );
}
