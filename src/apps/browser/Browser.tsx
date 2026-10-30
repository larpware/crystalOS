import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Badge, Button, EmptyState, IconButton, Menu, Tooltip, type MenuItem } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import { notify, openApp } from "@/services/os";
import { offlineExplanation } from "@/services/offline";
import { useOffline } from "@/hooks/useOffline";
import { deriveCoverage, isVpnLocked, providerAppId, providerName } from "@/services/vpn/coverage";
import { useVpnSnapshot, useVpnStore } from "@/state/vpn";
import { useScramjetState, useProxiedFrame } from "@/services/scramjet/useProxiedFrame";
import { useShield } from "@/services/shield/useShield";
import { ShieldPanel } from "./ShieldPanel";
import { useAuthStore } from "@/state/auth";
import { useSystemStore } from "@/state/system";
import { prettyTitle, useBrowserStore } from "@/state/browser";
import { useFsStore, homeNodeId, resolvePath } from "@/state/fs";
import { activeTabIdentity, useTabIdentityStore } from "@/state/cloak";
import type { AppProps, BrowserTab } from "@/types";
import { formatRelative } from "@/utils/format";
import { WindowChromeContext, WindowTitlebarChrome } from "@/window-manager/titlebarChrome";

/* ==========================================================================
   CrystalOS Browser

   Every tab owns one Scramjet frame: real proxied navigation, its own history
   and its own failure state. Frames stay alive while a tab is in the
   background, so switching tabs does not reload the page, and several proxied
   windows can be open at once without sharing state.

   Tab identity (cloaking) is an OS-level setting — it belongs to the shell, so
   this application only reports which identity is active and links to it.
   ========================================================================== */

export function Browser({ args }: AppProps) {
  const store = useBrowserStore();
  const proxy = useScramjetState();
  const offline = useOffline();
  const tabIdentity = useTabIdentityStore((state) => state.enabled);
  const account = useAuthStore((state) => state.account);
  const addBinary = useFsStore((state) => state.addBinary);
  const proxyEnabled = useSystemStore((state) => state.proxyEnabled);
  const vpn = useVpnSnapshot();

  /*
   * The tab strip is the window's titlebar. A bar that says "CrystalOS Browser"
   * above a bar of tabs is two rows doing one row's job, and the person looking
   * at it already knows which application they opened — so the tabs take the
   * bar and the title stands down.
   */
  const { setReplacesTitle } = useContext(WindowChromeContext);
  useEffect(() => {
    setReplacesTitle(true);
    return () => setReplacesTitle(false);
  }, [setReplacesTitle]);

  // The browser's own override wins over the OS-wide switch when it is set.
  const proxyOn = store.proxyMode === "inherit" ? proxyEnabled : store.proxyMode === "on";

  /* What the VPN is allowed to claim about this browser, from the one shared
     rule every surface uses. The toolbar button and the panes below both read
     it, so the indicator and the behaviour cannot drift apart. */
  const vpnCoverage = deriveCoverage({
    snapshot: vpn,
    scramjetEnabled: proxyEnabled,
    browserUsingProxy: proxyOn,
  });
  /** With enforcement on and no connection, direct loading is refused. */
  const vpnLocked = isVpnLocked(vpn);

  const [address, setAddress] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [panel, setPanel] = useState<"none" | "bookmarks" | "history" | "downloads">("none");
  const [recent, setRecent] = useState<{ x: number; y: number } | null>(null);
  const [shieldPanel, setShieldPanel] = useState<{ x: number; y: number } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const shield = useShield();

  const tabs = store.tabs;
  const activeId = store.activeTabId;
  const active = useMemo(() => tabs.find((tab) => tab.id === activeId) ?? null, [tabs, activeId]);

  /* Shield counts per tab, so the badge describes the page in front of the
     person rather than the window's total. */
  const shieldOn = shield.settings.enabled || shield.settings.lowData;
  const blockedCount = shield.blocked[active?.id ?? ""] ?? 0;

  /* A window with no tabs should still be usable, and one whose active tab was
     closed should fall back to the last remaining tab.
     The actions are read from getState() rather than taken from the subscribed
     `store` object. That object is replaced on every write, so an effect that
     listed it as a dependency re-ran after each of its own updates and never
     settled — which is what took the whole window down with "Maximum update
     depth exceeded" the first time a link was opened into a fresh window. */
  useEffect(() => {
    if (tabs.length === 0) {
      useBrowserStore.getState().newTab(undefined, true);
      return;
    }
    if (!activeId) useBrowserStore.getState().setActiveTab(tabs[tabs.length - 1].id);
  }, [tabs, activeId]);

  useEffect(() => {
    if (!active) return;
    setAddress(active.url.startsWith("about:") ? "" : active.url);
  }, [active?.id, active?.url, active]);

  /* A tab opened by another application carries its id in the window args, so
     the window comes up on the tab that was asked for. Keyed on the id alone,
     and the tab list is read when the effect runs. */
  useEffect(() => {
    const requested = typeof args?.tabId === "string" ? args.tabId : null;
    if (!requested) return;
    const state = useBrowserStore.getState();
    if (state.tabs.some((tab) => tab.id === requested)) state.setActiveTab(requested);
  }, [args?.tabId]);

  const navigate = () => {
    if (!active) return;
    const result = store.navigate(active.id, address);
    if (!result.ok && result.error) {
      notify({ title: "Cannot open that address", body: result.error, icon: "warning" });
    }
  };

  const openFromPanel = (url: string) => {
    if (!active) return;
    store.navigate(active.id, url);
    setPanel("none");
  };

  const downloadCurrent = async () => {
    if (!active || active.url.startsWith("about:")) return;
    // A download is fetched by *this page*, not by the proxy, so it never goes
    // through the VPN. With enforcement on that is exactly the request the user
    // asked not to happen, so it is refused and the refusal is explained.
    if (vpnLocked) {
      notify({
        title: "Download blocked by the VPN",
        body: "A download is fetched by this page, which the VPN cannot protect. Connect, or turn the VPN off, to download.",
        icon: "warning",
      });
      return;
    }
    // The same rule applies to an OS that is not attempting network requests:
    // refusing at once is clearer than a fetch that fails on its own terms.
    if (offline.offline) {
      notify({
        title: "Download not attempted",
        body: `${offlineExplanation(offline)}`,
        icon: "wifi-off",
      });
      return;
    }
    setDownloading(true);
    try {
      const response = await fetch(active.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read the response."));
        reader.readAsDataURL(blob);
      });
      const name = decodeURIComponent(active.url.split("/").pop()?.split("?")[0] || "download");
      const nodes = useFsStore.getState().nodes;
      const target = resolvePath(nodes, "/Home/Downloads") ?? homeNodeId(nodes);
      addBinary(target, name.slice(0, 60) || "download", blob.type || "application/octet-stream", dataUrl);
      store.addDownload({ name, url: active.url, size: blob.size, savedToFiles: true });
      notify({
        title: "Saved to Downloads",
        body: `${name} is in ~/Downloads.${
          vpn?.status === "connected" ? " (Fetched by this page, not through the VPN.)" : ""
        }`,
        icon: "download",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      store.addDownload({ name: active.url, url: active.url });
      notify({
        title: "Download failed",
        body: `${message} — the page's own origin has to allow reading it from another origin.`,
        icon: "warning",
      });
    } finally {
      setDownloading(false);
    }
  };

  const menuItems: MenuItem[] = [
    { id: "new-tab", label: "New tab", icon: "plus", run: () => store.newTab(store.homepage, true) },
    {
      id: "duplicate",
      label: "Duplicate tab",
      icon: "copy",
      disabled: !active,
      run: () => {
        if (active) store.newTab(active.url, true);
      },
    },
    {
      id: "reload",
      label: "Reload",
      icon: "refresh",
      disabled: !active,
      run: () => active && store.updateTab(active.id, { nonce: active.nonce + 1, loading: true }),
    },
    {
      id: "open-direct",
      label: proxyOn
        ? active?.direct
          ? "Load through the proxy again"
          : "Load without the proxy"
        : "Turn the proxy back on",
      icon: "globe",
      disabled: !active || active.url.startsWith("about:"),
      run: () => {
        if (!active) return;
        if (!proxyOn) {
          // Forced direct by the browser-level switch: flip that, not the tab.
          store.setProxyMode("on");
          notify({ title: "Proxy enabled", body: "New pages load through Scramjet again.", icon: "globe" });
          return;
        }
        store.setDirectMode(active.id, !active.direct);
        notify({
          title: active.direct ? "Loading through Scramjet" : "Loading without the proxy",
          body: active.direct
            ? `${prettyTitle(active.url)} is being proxied again.`
            : `${prettyTitle(active.url)} loads in this window. Sites that refuse to be framed will stay blank.`,
        });
      },
    },
    {
      id: "open-external",
      label: "Open in a browser tab",
      icon: "external",
      disabled: !active || active.url.startsWith("about:"),
      run: () => active && window.open(active.url, "_blank", "noopener,noreferrer"),
    },
    {
      id: "bookmark",
      label:
        active && store.bookmarks.some((entry) => entry.url === active.url)
          ? "Remove bookmark"
          : "Bookmark this page",
      icon: "star",
      disabled: !active || active.url.startsWith("about:"),
      separatorBefore: true,
      run: () => active && store.toggleBookmark(active.url, prettyTitle(active.url)),
    },
    {
      id: "shield",
      label: shieldOn ? "Shield — blocking on this page" : "Shield is off",
      icon: "filter",
      hint:
        blockedCount > 0
          ? `${blockedCount} blocked`
          : shield.settings.lowData
            ? "data saver on"
            : undefined,
      run: () => setShieldPanel(menu ?? { x: 24, y: 80 }),
    },
    {
      id: "copy-url",
      label: "Copy address",
      icon: "link",
      disabled: !active,
      run: async () => {
        if (!active) return;
        try {
          await navigator.clipboard.writeText(active.url);
          notify({ title: "Address copied", body: active.url, icon: "check" });
        } catch {
          notify({
            title: "Could not copy",
            body: "This browser blocked clipboard access for that action.",
            icon: "warning",
          });
        }
      },
    },
    {
      id: "recent",
      label: "Recently visited",
      icon: "clock",
      hint: `${store.history.length}`,
      separatorBefore: true,
      // The panel is for digging; this is the short list you actually want.
      run: () => setRecent(menu ?? { x: 24, y: 80 }),
    },
    { id: "history", label: "All history", icon: "list", run: () => setPanel("history") },
    { id: "bookmarks", label: "Bookmarks", icon: "star", run: () => setPanel("bookmarks") },
    { id: "downloads", label: "Downloads", icon: "download", run: () => setPanel("downloads") },
    {
      id: "download-page",
      label: "Download this page",
      icon: "download",
      disabled: !active || downloading || active.url.startsWith("about:"),
      run: () => void downloadCurrent(),
    },
    {
      id: "tab-identity",
      label: "Tab identity settings…",
      icon: "eye-off",
      separatorBefore: true,
      run: () => openApp("settings", { args: { section: "tabIdentity" } }),
    },
  ];

  return (
    <div className="cr-browser">
      {/* Rendered into the window's titlebar rather than here — a row of tabs
          above a row that names the application is two rows doing one job. */}
      <WindowTitlebarChrome>
        <div
          className="cr-browser__tabs"
          role="tablist"
          aria-label="Browser tabs"
          /* The titlebar is the window's drag handle; this keeps the pointer
             off it so a tab can be clicked, dragged and closed normally. */
          data-no-drag
        >
          {tabs.map((tab, index) => (
            <div
              key={tab.id}
              className="cr-browser__tab"
              data-active={tab.id === activeId}
              role="tab"
              aria-selected={tab.id === activeId}
              draggable
              onDragStart={(event) => event.dataTransfer.setData("text/tab-index", String(index))}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                const from = Number(event.dataTransfer.getData("text/tab-index"));
                if (!Number.isNaN(from)) store.reorderTabs(from, index);
              }}
            >
              <button
                type="button"
                className="cr-browser__tab-button"
                onClick={() => store.setActiveTab(tab.id)}
              >
                <span className="cr-browser__tab-favicon" aria-hidden="true">
                  {tab.loading ? (
                    <Icon name="refresh" size={11} />
                  ) : tab.url.startsWith("about:") ? (
                    <Icon name="browser" size={11} />
                  ) : (
                    <SiteIcon host={hostOf(tab.url)} label={tab.title} size={13} />
                  )}
                </span>
                <span className="cr-browser__tab-title">{tab.title}</span>
              </button>
              <button
                type="button"
                className="cr-browser__tab-close"
                aria-label={`Close ${tab.title}`}
                onClick={() => store.closeTab(tab.id)}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="cr-browser__new-tab"
            aria-label="New tab"
            onClick={() => store.newTab(store.homepage, true)}
          >
            <Icon name="plus" size={14} />
          </button>
        </div>
      </WindowTitlebarChrome>

      <div className="cr-browser__toolbar">
        <BrowserNav tab={active} onRetry={() => active && store.updateTab(active.id, { nonce: active.nonce + 1, loading: true })} />

        <form
          className="cr-browser__omnibox"
          onSubmit={(event) => {
            event.preventDefault();
            navigate();
          }}
        >
          <Icon name="search" size={14} className="cr-browser__omnibox-icon" />
          <span className="cr-browser__omnibox-brand" aria-hidden="true">Crystal</span>
          <input
            value={address}
            aria-label="Address and search"
            placeholder={`Search ${store.searchEngine} or enter an address`}
            spellCheck={false}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            className="cr-browser__star"
            aria-label="Bookmark this page"
            aria-pressed={Boolean(active && store.bookmarks.some((entry) => entry.url === active.url))}
            disabled={!active || active.url.startsWith("about:")}
            onClick={() => active && store.toggleBookmark(active.url, prettyTitle(active.url))}
          >
            <Icon name="star" size={14} />
          </button>
        </form>

        <button
          type="button"
          className="cr-browser__proxy"
          data-compact="true"
          data-tone={proxyOn ? proxyTone(proxy.status) : "bad"}
          aria-pressed={proxyOn}
          aria-label={proxyOn ? `Proxy: ${proxyLabel(proxy.status, proxy.transport)}` : "Proxy off"}
          title={
            proxyOn
              ? proxy.status === "error"
                ? (proxy.error ?? "The Scramjet backend is not reachable from this origin.")
                : "Every tab loads through Scramjet. Click to turn the proxy off."
              : "The proxy is off in this browser — pages load directly. Click to turn it back on."
          }
          onClick={() => {
            const next = proxyOn ? "off" : "on";
            store.setProxyMode(next);
            notify({
              title: next === "off" ? "Proxy off" : "Proxy on",
              body:
                next === "off"
                  ? "Pages load directly in this window until you switch it back on."
                  : "Pages are proxied through Scramjet and the Wisp transport.",
              icon: "globe",
            });
          }}
        >
          <Icon
            name={!proxyOn ? "globe" : proxy.status === "ready" ? "shield" : proxy.status === "error" ? "warning" : "activity"}
            size={14}
          />
        </button>

        {/* VPN state for the tab the user is looking at. It opens the real app
            rather than toggling anything here: a connection is a decision with
            consequences, and the places that report it should be the places
            that explain it. */}
        <button
          type="button"
          className="cr-browser__vpn"
          data-tone={
            !vpn
              ? "busy"
              : vpnCoverage.scramjet === "protected"
                ? "ok"
                : vpnCoverage.scramjet === "blocked"
                  ? "bad"
                  : "busy"
          }
          aria-label={`VPN: ${vpnCoverage.headline}`}
          title={`${vpnCoverage.headline} — open ${providerName(vpn)} VPN settings. Proxied tabs: ${
            vpnCoverage.scramjet === "protected" ? "protected" : vpnCoverage.scramjet
          }.`}
          onClick={() => openApp(providerAppId(vpn))}
        >
          <Icon name="shield" size={14} />
        </button>

        {/* Shield: what was blocked on this page, and the way to set it aside.
            It sits beside the proxy button because it only ever answers for
            requests the proxy is carrying. */}
        <button
          type="button"
          className="cr-browser__shield"
          data-on={shieldOn}
          data-active={blockedCount > 0}
          aria-pressed={shieldOn}
          aria-label={
            shieldOn
              ? `Shield: ${blockedCount} blocked on this page`
              : "Shield is off — ads, trackers and popups are not being blocked"
          }
          title={
            shieldOn
              ? `CrystalOS Shield — ${blockedCount} request${blockedCount === 1 ? "" : "s"} blocked on this page. Click for the controls.`
              : "Shield is off. Click to see the controls and turn blocking back on."
          }
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setShieldPanel((current) =>
              current ? null : { x: rect.right - 330, y: rect.bottom + 6 },
            );
          }}
        >
          <Icon name="filter" size={14} />
          {blockedCount > 0 && (
            <span className="cr-browser__shield-badge">{blockedCount > 99 ? "99+" : blockedCount}</span>
          )}
        </button>

        {tabIdentity && (
          <span
            className="cr-browser__cloak"
            title="The OS tab identity is on. Open Settings → Tab identity to change it."
          >
            <Icon name="eye-off" size={13} />
            {activeTabIdentity()?.name ?? "Identity"}
          </span>
        )}

        <IconButton
          icon="more-vertical"
          label="Browser menu"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setMenu({ x: rect.right - 240, y: rect.bottom + 6 });
          }}
        />
      </div>

      <div className="cr-browser__viewport">
        {tabs.length === 0 ? (
          <EmptyState icon="browser" title="No tabs open" hint="Create a tab to start browsing." />
        ) : (
          // Every tab keeps its frame mounted: switching tabs must not reload a
          // proxied page or lose its history.
          tabs.map((tab) => (
            <BrowserTabPane
              key={tab.id}
              tab={tab}
              active={tab.id === activeId}
              vpnLocked={vpnLocked}
            />
          ))
        )}
        {panel !== "none" && (
          <BrowserPanel
            panel={panel}
            onClose={() => setPanel("none")}
            onOpen={openFromPanel}
            signedInAs={account?.displayName ?? "guest"}
          />
        )}
      </div>

      {menu && <Menu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}

      {shieldPanel && (
        <ShieldPanel
          anchor={shieldPanel}
          owner={active?.id ?? null}
          currentUrl={active?.url ?? ""}
          onOpen={(url) => {
            store.newTab(url, true);
            setShieldPanel(null);
          }}
          onClose={() => setShieldPanel(null)}
          onOpenSettings={() => {
            setShieldPanel(null);
            openApp("settings", { args: { section: "proxy" } });
          }}
        />
      )}

      {recent && (
        <RecentPages
          anchor={recent}
          onClose={() => setRecent(null)}
          onOpen={(url) => {
            openFromPanel(url);
            setRecent(null);
          }}
          onOpenAllHistory={() => {
            setRecent(null);
            setPanel("history");
          }}
        />
      )}
    </div>
  );
}

/* ---- toolbar navigation ------------------------------------------------- */

function BrowserNav({ tab, onRetry }: { tab: BrowserTab | null; onRetry: () => void }) {
  const disabled = !tab || tab.url.startsWith("about:");
  // A directly loaded page is cross-origin, so its history stack is not
  // reachable from the shell. Saying so is better than a button that does
  // nothing.
  const historyDisabled = disabled || Boolean(tab?.direct);
  return (
    <>
      <IconButton
        icon="chevron-left"
        label={tab?.direct ? "Back — not available without the proxy" : "Back"}
        disabled={historyDisabled}
        onClick={() => {
          if (tab) window.dispatchEvent(new CustomEvent("crescent:browser-back", { detail: tab.id }));
        }}
      />
      <IconButton
        icon="chevron-right"
        label={tab?.direct ? "Forward — not available without the proxy" : "Forward"}
        disabled={historyDisabled}
        onClick={() => {
          if (tab) window.dispatchEvent(new CustomEvent("crescent:browser-forward", { detail: tab.id }));
        }}
      />
      <IconButton icon={tab?.loading ? "close" : "refresh"} label={tab?.loading ? "Stop" : "Reload"} disabled={!tab} onClick={onRetry} />
    </>
  );
}

/* ---- one proxied pane per tab ------------------------------------------ */

function BrowserTabPane({
  tab,
  active,
  vpnLocked,
}: {
  tab: BrowserTab;
  active: boolean;
  /** The VPN is enforcing and is not up: loading outside the tunnel is refused. */
  vpnLocked: boolean;
}) {
  const settleTab = useBrowserStore((state) => state.settleTab);
  const proxyEnabled = useSystemStore((state) => state.proxyEnabled);
  const proxyMode = useBrowserStore((state) => state.proxyMode);
  const vpn = useVpnSnapshot();
  const vpnBusy = useVpnStore((state) => state.busy);
  // Either the tab or the whole browser can be in direct mode.
  const proxyOn = proxyMode === "inherit" ? proxyEnabled : proxyMode === "on";
  const directMode = tab.direct === true || !proxyOn;
  const isStart = tab.url.startsWith("about:");
  /*
   * The Scramjet hook is called for every tab so the hook order stays stable,
   * but a tab in direct mode never attaches its ref: with no element the hook
   * never creates a frame, and the pane below loads the page itself.
   */
  const frame = useProxiedFrame(directMode ? "about:blank" : tab.url, {
    // Shield's counters belong to the tab: the popover reports the page in
    // front of the person, not everything the window has loaded.
    owner: tab.id,
    onUrlChange: (url) => settleTab(tab.id, url),
  });

  /*
   * The way out of a failed page when a VPN is up.
   *
   * A public exit is proven against a handshake and one small answer, and it can
   * still fail a particular site — that is how a "connected" VPN turns into a
   * page that never arrives. Reconnecting would re-prove the same exit, so this
   * instead drops the stored endpoint and asks for a fresh scan whose canary is
   * the very host that just failed: an exit that can carry *this* site.
   */
  const findAnotherExit = () => {
    let host: string | null = null;
    try {
      host = new URL(tab.url).hostname || null;
    } catch {
      host = null;
    }
    const vpnStore = useVpnStore.getState();
    void vpnStore
      .clearEndpoint()
      .then(() => vpnStore.quickConnect({ canary: host ? [host] : [] }))
      .then((snapshot) => {
        if (snapshot?.status === "connected") frame.retry();
      })
      .catch(() => undefined);
  };

  // Toolbar history buttons drive the active pane's own stack.
  useEffect(() => {
    if (!active || directMode) return;
    const onBack = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== tab.id) return;
      frame.back();
    };
    const onForward = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== tab.id) return;
      frame.forward();
    };
    window.addEventListener("crescent:browser-back", onBack);
    window.addEventListener("crescent:browser-forward", onForward);
    return () => {
      window.removeEventListener("crescent:browser-back", onBack);
      window.removeEventListener("crescent:browser-forward", onForward);
    };
  }, [active, directMode, frame, tab.id]);

  if (isStart) {
    return (
      <div className="cr-browser__page" data-active={active} data-start="true">
        <StartPage tabId={tab.id} />
      </div>
    );
  }

  /*
   * The VPN is enforcing and is not connected.
   *
   * This used to be checked only for a tab that would load itself, which left the
   * proxied case to fail on its own — and a refused proxied stream is not an
   * error the page can show: the frame came up as an empty pane, or as the
   * transport's own terse one-line error. Either way the person saw a page that
   * did not load and nothing that said why. So the refusal is rendered here, for
   * both routes, with the real reason and the ways out.
   */
  if (vpnLocked) {
    return <VpnBlockedPane tab={tab} active={active} proxied={!directMode} />;
  }

  if (directMode) {
    return <DirectPane tab={tab} active={active} proxyOn={proxyOn} />;
  }

  return (
    <div className="cr-browser__page" data-active={active}>
      <iframe
        ref={frame.attach}
        className="cr-browser__frame"
        title={tab.title}
        sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts allow-downloads"
        allow="clipboard-write; clipboard-read; fullscreen; gamepad; autoplay; encrypted-media; microphone; camera"
        referrerPolicy="no-referrer"
      />

      {frame.status === "error" && (
        <div className="cr-browser__overlay" data-kind="error">
          <Icon name="warning" size={26} />
          <h3 className="cr-browser__overlay-title">That address could not be opened</h3>
          <p className="cr-browser__overlay-text">{frame.error ?? tab.error ?? "The page did not load."}</p>
          <div className="cr-browser__overlay-actions">
            <Button variant="primary" icon="refresh" onClick={frame.retry}>
              Try again
            </Button>
            {vpn?.status === "connected" && (
              <Button icon="shield" disabled={vpnBusy !== null} onClick={findAnotherExit}>
                {vpnBusy === "quick" ? "Finding another exit…" : "Try a different VPN exit"}
              </Button>
            )}
            <Button icon="globe" onClick={() => useBrowserStore.getState().setDirectMode(tab.id, true)}>
              Load without the proxy
            </Button>
            <Button
              icon="external"
              onClick={() => window.open(tab.url, "_blank", "noopener,noreferrer")}
            >
              Open in a browser tab
            </Button>
          </div>
        </div>
      )}

      {frame.status === "connecting" && (
        <div className="cr-browser__overlay" data-kind="loading">
          <span className="cr-spinner" />
          <p className="cr-browser__overlay-text">Connecting {prettyTitle(tab.url)} through Scramjet…</p>
        </div>
      )}
    </div>
  );
}

/* ---- blocked by the VPN -------------------------------------------------
 *
 * What "fail closed" looks like to a person. With the VPN wanted and
 * enforcement on, nothing CrystalOS carries is allowed to leave unprotected, so
 * a request is refused instead of being quietly served without the tunnel.
 *
 * There are two ways to arrive here, and the copy says which one happened:
 *
 *   • a tab that would load itself — the proxy is off, or this tab was put in
 *     direct mode before the VPN came on — because a page cannot set a proxy for
 *     itself, so it could not be tunnelled at all;
 *   • a proxied tab, whose streams the controller is refusing, which without
 *     this pane renders as a page that simply did not load.
 *
 * The way out is stated rather than hidden: connect, or explicitly give up on
 * protection. Nothing here silently leaks. The controller's own error message is
 * shown when it has one, so "no free server answered" is legible here instead of
 * only in the VPN window.
 */

function VpnBlockedPane({
  tab,
  active,
  proxied,
}: {
  tab: BrowserTab;
  active: boolean;
  proxied: boolean;
}) {
  const vpn = useVpnSnapshot();
  const proxyEnabled = useSystemStore((state) => state.proxyEnabled);
  const setProxyMode = useBrowserStore((state) => state.setProxyMode);
  const status = vpn?.status ?? "unknown";
  const reason = vpn?.error?.message ?? null;

  return (
    <div className="cr-browser__page" data-active={active}>
      <div className="cr-browser__vpn-block" role="status">
        <Icon name="shield" size={26} />
        <h3>Blocked by the VPN</h3>
        <p>
          {proxied ? (
            <>
              {prettyTitle(tab.url)} is loaded through CrystalOS's proxy, and every request it makes is
              being refused rather than sent without the tunnel. {providerName(vpn)} is currently{" "}
              <strong>{status}</strong>.
            </>
          ) : (
            <>
              {prettyTitle(tab.url)} would be loaded by this window itself, outside {providerName(vpn)}'s
              tunnel, and the VPN is set to block unprotected traffic. The connection is currently{" "}
              <strong>{status}</strong>.
            </>
          )}
        </p>
        {reason && <p className="cr-browser__vpn-block-reason">{reason}</p>}
        <p className="cr-row__desc">
          {proxied
            ? `Connect ${providerName(vpn)} and this page loads again on its own. Turn the VPN off instead if you would rather browse without it.`
            : "Turn Scramjet back on and connect, or turn the VPN off if you would rather browse without it."}
        </p>
        <div className="cr-browser__vpn-block-actions">
          {!proxied && !proxyEnabled && (
            <Button variant="primary" icon="globe" onClick={() => setProxyMode("on")}>
              Use Scramjet
            </Button>
          )}
          <Button variant="primary" icon="shield" onClick={() => openApp(providerAppId(vpn))}>
            Open {providerName(vpn)} VPN
          </Button>
          <Button
            icon="wifi-off"
            onClick={() => {
              void useVpnStore.getState().disconnect().then(() => {
                notify({
                  title: "VPN turned off",
                  body: "This window may now load pages directly, unprotected.",
                  icon: "warning",
                });
              });
            }}
          >
            Turn the VPN off
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---- direct pane --------------------------------------------------------
 *
 * What "load without the proxy" means: this window fetches the page itself.
 * That keeps the site inside CrystalOS when the Scramjet backend is down,
 * at the cost of the protections the proxy normally provides — cross-origin
 * restrictions apply again, and a site that sends X-Frame-Options or a CSP
 * frame-ancestors rule will refuse to render. Both facts are stated in the bar
 * above the page instead of leaving the user with a blank pane.
 */

const DIRECT_LOAD_TIMEOUT_MS = 20_000;

function DirectPane({ tab, active, proxyOn }: { tab: BrowserTab; active: boolean; proxyOn: boolean }) {
  const updateTab = useBrowserStore((state) => state.updateTab);
  const setDirectMode = useBrowserStore((state) => state.setDirectMode);
  const setProxyMode = useBrowserStore((state) => state.setProxyMode);
  // Turning the proxy back on has to clear whichever switch forced direct mode.
  const useProxy = () => {
    if (!proxyOn) setProxyMode("on");
    setDirectMode(tab.id, false);
  };
  const [status, setStatus] = useState<"loading" | "ready" | "stalled">("loading");
  const timerRef = useRef<number | null>(null);
  /*
   * The bar is a notice, not a modal: it explains why the page is being loaded
   * this way, and once read it can be put away. Dismissing it only lasts until
   * the tab navigates or switches loader (see browser.ts), so the warning is
   * never gone for good — it simply stops sitting above every page.
   */
  const barHidden = tab.directBarHidden === true;

  useEffect(() => {
    setStatus("loading");
    updateTab(tab.id, { loading: true, error: undefined });
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setStatus("stalled");
      updateTab(tab.id, { loading: false });
    }, DIRECT_LOAD_TIMEOUT_MS);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
    // Remounting on `nonce` is how a reload is requested.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, tab.nonce]);

  const loaded = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setStatus("ready");
    updateTab(tab.id, { loading: false, error: undefined });
  };

  return (
    <div className="cr-browser__page" data-active={active} data-direct="true">
      {!barHidden && (
        <div className="cr-browser__direct-bar" role="status">
          <Icon name="warning" size={13} />
          <span>
            {proxyOn
              ? `Direct mode: this window loads ${prettyTitle(tab.url)} itself, without Scramjet. A site that refuses to be framed stays blank.`
              : `The proxy is off, so ${prettyTitle(tab.url)} is loaded directly in this window. A site that refuses to be framed stays blank.`}
          </span>
          <Button size="sm" icon="globe" onClick={useProxy}>
            Use the proxy
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="refresh"
            onClick={() => updateTab(tab.id, { nonce: tab.nonce + 1, loading: true })}
          >
            Reload
          </Button>
          <IconButton
            className="cr-browser__direct-bar-close"
            icon="close"
            size={13}
            label="Hide this notice"
            onClick={() => updateTab(tab.id, { directBarHidden: true })}
          />
        </div>
      )}

      <iframe
        key={tab.nonce}
        className="cr-browser__frame"
        title={tab.title}
        src={tab.url}
        onLoad={loaded}
        sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts allow-downloads"
        allow="clipboard-write; clipboard-read; fullscreen; gamepad; autoplay; encrypted-media; microphone; camera"
        referrerPolicy="no-referrer"
      />

      {status === "stalled" && (
        <div className="cr-browser__overlay" data-kind="error">
          <Icon name="warning" size={26} />
          <h3 className="cr-browser__overlay-title">Nothing loaded without the proxy</h3>
          <p className="cr-browser__overlay-text">
            {prettyTitle(tab.url)} did not finish loading in {DIRECT_LOAD_TIMEOUT_MS / 1000} seconds.
            Most sites send a header that forbids being shown inside another page — working around
            that is exactly what the Scramjet proxy does. Starting the backend
            (<span className="cr-code cr-code--sm">npm run dev:all</span>) and trying again is the
            reliable option.
          </p>
          <div className="cr-browser__overlay-actions">
            <Button variant="primary" icon="globe" onClick={useProxy}>
              Load through the proxy
            </Button>
            <Button icon="refresh" onClick={() => updateTab(tab.id, { nonce: tab.nonce + 1, loading: true })}>
              Try again
            </Button>
            <Button icon="external" onClick={() => window.open(tab.url, "_blank", "noopener,noreferrer")}>
              Open in a browser tab
            </Button>
          </div>
        </div>
      )}

      {status === "loading" && (
        <div className="cr-browser__overlay" data-kind="loading" data-soft="true">
          <span className="cr-spinner" />
          <p className="cr-browser__overlay-text">Loading {prettyTitle(tab.url)} directly…</p>
        </div>
      )}
    </div>
  );
}

/* ---- shortcuts ----------------------------------------------------------
 * New tabs are a search field and a handful of squares. Everything else the
 * browser can do lives in the menu, where it stays out of the way until it is
 * asked for.
 */

export interface BrowserShortcut {
  name: string;
  url: string;
  /** Host whose favicon stands in for the site. */
  host: string;
}

export const browserShortcuts: BrowserShortcut[] = [
  { name: "EasyFun", url: "https://easyfun.gg", host: "easyfun.gg" },
  { name: "NVIDIA GeForce", url: "https://www.nvidia.com/en-us/geforce/", host: "nvidia.com" },
  { name: "CloudMoon", url: "https://web.cloudmoonapp.com", host: "cloudmoonapp.com" },
  { name: "ChatGPT", url: "https://chatgpt.com", host: "chatgpt.com" },
  { name: "Claude", url: "https://claude.ai", host: "claude.ai" },
  { name: "Gemini", url: "https://gemini.google.com", host: "gemini.google.com" },
  { name: "DeepSeek", url: "https://chat.deepseek.com", host: "deepseek.com" },
  { name: "Microsoft Copilot", url: "https://copilot.microsoft.com", host: "copilot.microsoft.com" },
];

/** Same favicon service the game library uses for its tiles. */
function faviconUrl(host: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * A site's icon, falling back to its initial when the favicon cannot be
 * fetched — an offline OS should not show broken images.
 */
function SiteIcon({ host, label, size = 16 }: { host: string; label: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed || !host) {
    return (
      <span className="cr-browser__site-letter" style={{ width: size, height: size }} aria-hidden="true">
        {label.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      className="cr-browser__site-icon"
      src={faviconUrl(host)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/* ---- new tab page -------------------------------------------------------
 * Modelled on the CrystalOS shell: a quiet starfield behind the gem, one
 * greeting line, a search field, the shortcut tiles, and a row of cards built
 * from the browser's own history — the pages this user actually visited.
 */

function CrystalGem() {
  const gradientId = useId();
  const id1 = `gem-a-${gradientId}`;
  const id2 = `gem-b-${gradientId}`;
  return (
    <svg className="cr-ntp__gem" viewBox="0 0 52 52" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={id1} x1="0" y1="0" x2="52" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#7eb8ff" />
          <stop offset="100%" stopColor="#4060f0" />
        </linearGradient>
        <linearGradient id={id2} x1="52" y1="0" x2="0" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#a0d0ff" />
          <stop offset="100%" stopColor="#2040c0" />
        </linearGradient>
      </defs>
      <polygon points="26,4 42,16 36,44 16,44 10,16" fill={`url(#${id1})`} opacity="0.9" />
      <polygon points="26,4 42,16 26,22" fill={`url(#${id2})`} opacity="0.85" />
      <polygon points="26,4 10,16 26,22" fill="#90c0ff" opacity="0.7" />
      <polygon points="42,16 36,44 26,22" fill="#4070e0" opacity="0.8" />
      <polygon points="10,16 16,44 26,22" fill="#80b0ff" opacity="0.75" />
      <polygon points="26,22 36,44 16,44" fill="#5080f0" opacity="0.85" />
      <polygon points="26,4 34,13 26,15 18,13" fill="rgba(255,255,255,0.35)" />
    </svg>
  );
}

function startGreeting(): { part: string; sub: string } {
  const h = new Date().getHours();
  return {
    part: h < 12 ? "morning" : h < 17 ? "afternoon" : "evening",
    sub: h < 12 ? "ready to explore" : h < 17 ? "where to next?" : "winding down?",
  };
}

/** Stable colour seed for a card's backdrop, so a host always looks the same. */
function hueOf(host: string): number {
  let value = 0;
  for (let i = 0; i < host.length; i += 1) value = (value * 31 + host.charCodeAt(i)) % 360;
  return value;
}

function pathLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = (parsed.pathname === "/" ? "" : parsed.pathname) + parsed.search;
    return path.replace(/^\//, "").slice(0, 42) || "Home";
  } catch {
    return "";
  }
}

function StartPage({ tabId }: { tabId: string }) {
  const store = useBrowserStore();
  const engine = store.searchEngine;
  const { part, sub } = startGreeting();
  /* The row reflects real visits: the newest entries of this browser's history. */
  const recents = store.history.slice(0, 3);

  /*
   * The search box belongs to one tab, so it navigates that tab — and makes it
   * the active one first. Navigating whatever tab happened to be active was how
   * a search could load a page in a tab behind this one.
   */
  const open = (url: string) => {
    store.setActiveTab(tabId);
    store.navigate(tabId, url);
  };

  return (
    <div className="cr-ntp">
      <div className="cr-ntp__wallpaper" aria-hidden="true" />

      <div className="cr-ntp__content">
        <header className="cr-ntp__brand">
          <CrystalGem />
          <h1 className="cr-ntp__brand-name">Crystal<span>OS</span></h1>
          <p className="cr-ntp__brand-sub">Browser · v2.4</p>
        </header>

        <p className="cr-ntp__greeting">
          Good {part} — <strong>{sub}</strong>
        </p>

        <form
          className="cr-ntp__search"
          onSubmit={(event) => {
            event.preventDefault();
            const input = new FormData(event.currentTarget).get("query");
            if (typeof input !== "string" || !input.trim()) return;
            open(input);
          }}
        >
          <Icon name="search" size={18} className="cr-ntp__search-icon" />
          <input
            name="query"
            placeholder={`Search ${engine} or enter an address`}
            aria-label="Search the web"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="cr-ntp__search-submit" aria-label="Search">
            <Icon name="chevron-right" size={14} />
          </button>
        </form>

        <div className="cr-ntp__section">Shortcuts</div>
        <div className="cr-ntp__shortcuts">
          {browserShortcuts.map((site) => (
            <Tooltip key={site.url} label={`${site.name} — ${site.url.replace(/^https?:\/\//, "")}`}>
              <button type="button" className="cr-ntp__shortcut" onClick={() => open(site.url)}>
                <span className="cr-ntp__shortcut-icon">
                  <SiteIcon host={site.host} label={site.name} size={28} />
                </span>
                <span className="cr-ntp__shortcut-name">{site.name}</span>
              </button>
            </Tooltip>
          ))}
        </div>

        <div className="cr-ntp__section">Recently visited</div>
        {recents.length === 0 ? (
          <p className="cr-ntp__empty">Pages you visit in this browser show up here.</p>
        ) : (
          <div className="cr-ntp__cards">
            {recents.map((entry) => {
              const host = hostOf(entry.url);
              const hue = hueOf(host);
              return (
                <button
                  key={entry.id}
                  type="button"
                  className="cr-ntp__card"
                  title={entry.url}
                  onClick={() => open(entry.url)}
                >
                  <span
                    className="cr-ntp__card-thumb"
                    style={{
                      background: `linear-gradient(135deg, hsl(${hue} 45% 14%) 0%, hsl(${hue} 50% 26%) 100%)`,
                    }}
                  >
                    <SiteIcon host={host} label={entry.title} size={44} />
                  </span>
                  <span className="cr-ntp__card-meta">
                    <SiteIcon host={host} label={entry.title} size={14} />
                    <span className="cr-ntp__card-name">{entry.title}</span>
                    <span className="cr-ntp__card-path">{pathLabel(entry.url)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- recently visited ---------------------------------------------------
 * The address bar only ever shows one page at a time, so the last few live
 * one click away in the corner menu rather than behind a full side panel.
 */

const RECENT_LIMIT = 8;

function RecentPages({
  anchor,
  onOpen,
  onClose,
  onOpenAllHistory,
}: {
  anchor: { x: number; y: number };
  onOpen: (url: string) => void;
  onClose: () => void;
  onOpenAllHistory: () => void;
}) {
  const history = useBrowserStore((state) => state.history);
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(anchor);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // offsetWidth/offsetHeight are layout pixels, the same units the viewport
    // is measured in. A bounding rect is scaled by the shell's zoom, which
    // would otherwise make this popover look far taller than it is.
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    setPosition({
      x: Math.max(6, Math.min(anchor.x, window.innerWidth - width - 6)),
      y: Math.max(6, Math.min(anchor.y, window.innerHeight - height - 6)),
    });
  }, [anchor.x, anchor.y, history.length]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const entries = history.slice(0, RECENT_LIMIT);

  return createPortal(
    <div
      ref={ref}
      className="cr-browser__recent"
      role="dialog"
      aria-label="Recently visited"
      style={{ left: position.x, top: position.y }}
    >
      <header className="cr-browser__recent-head">
        <span>Recently visited</span>
        <IconButton icon="close" label="Close recently visited" size={13} onClick={onClose} />
      </header>

      {entries.length === 0 ? (
        <p className="cr-browser__recent-empty">Pages you visit in this browser show up here.</p>
      ) : (
        <ul className="cr-browser__recent-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className="cr-browser__recent-row"
                title={entry.title}
                onClick={() => onOpen(entry.url)}
              >
                <SiteIcon host={hostOf(entry.url)} label={entry.title} />
                <span className="cr-browser__recent-text">
                  <span className="cr-browser__recent-title">{entry.title}</span>
                  <span className="cr-browser__recent-meta">
                    {entry.url.replace(/^https?:\/\//, "")} · {formatRelative(entry.at)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="cr-browser__recent-all" onClick={onOpenAllHistory}>
        <Icon name="list" size={13} />
        All history
      </button>
    </div>,
    document.body,
  );
}

/* ---- side panel --------------------------------------------------------- */

function BrowserPanel({
  panel,
  onClose,
  onOpen,
  signedInAs,
}: {
  panel: "bookmarks" | "history" | "downloads";
  onClose: () => void;
  onOpen: (url: string) => void;
  signedInAs: string;
}) {
  const store = useBrowserStore();
  const title = panel === "bookmarks" ? "Bookmarks" : panel === "history" ? "History" : "Downloads";

  return (
    <aside className="cr-browser__panel" aria-label={title}>
      <header className="cr-browser__panel-head">
        <h3>{title}</h3>
        <IconButton icon="close" label="Close panel" onClick={onClose} />
      </header>
      <div className="cr-browser__panel-body">
        {panel === "bookmarks" &&
          (store.bookmarks.length === 0 ? (
            <EmptyState icon="star" title="No bookmarks" hint="Press the star in the address bar to save a page." />
          ) : (
            store.bookmarks.map((entry) => (
              <div key={entry.id} className="cr-browser__panel-row">
                <button type="button" onClick={() => onOpen(entry.url)}>
                  <span className="cr-browser__panel-title">{entry.title}</span>
                  <span className="cr-browser__panel-url">{entry.url}</span>
                </button>
                <IconButton icon="trash" label={`Remove ${entry.title}`} onClick={() => store.removeBookmark(entry.id)} />
              </div>
            ))
          ))}

        {panel === "history" &&
          (store.history.length === 0 ? (
            <EmptyState icon="clock" title="No history" hint="Pages you visit appear here." />
          ) : (
            store.history.map((entry) => (
              <div key={entry.id} className="cr-browser__panel-row">
                <button type="button" onClick={() => onOpen(entry.url)}>
                  <span className="cr-browser__panel-title">{entry.title}</span>
                  <span className="cr-browser__panel-url">
                    {entry.url} · {formatRelative(entry.at)}
                  </span>
                </button>
                <IconButton icon="trash" label={`Remove ${entry.title}`} onClick={() => store.removeHistoryEntry(entry.id)} />
              </div>
            ))
          ))}

        {panel === "downloads" &&
          (store.downloads.length === 0 ? (
            <EmptyState
              icon="download"
              title="No downloads"
              hint="Downloads saved into the filesystem are listed here."
            />
          ) : (
            store.downloads.map((entry) => (
              <div key={entry.id} className="cr-browser__panel-row">
                <div>
                  <span className="cr-browser__panel-title">{entry.name}</span>
                  <span className="cr-browser__panel-url">
                    {formatRelative(entry.at)}
                    {entry.size ? ` · ${Math.round(entry.size / 1024)} KB` : ""}
                    {entry.savedToFiles ? " · saved to ~/Downloads" : " · not saved"}
                  </span>
                </div>
              </div>
            ))
          ))}
      </div>
      <footer className="cr-browser__panel-foot">
        <Badge>{signedInAs}</Badge>
        <span className="cr-row__desc">Proxied by Scramjet. Transport settings live in Settings → Browser.</span>
      </footer>
    </aside>
  );
}

function proxyLabel(
  status: "idle" | "loading" | "ready" | "error",
  transport: string | null,
): string {
  if (status === "error") return "Proxy offline";
  if (status === "ready") return transport ? `Proxied · ${transport}` : "Proxied";
  if (status === "loading") return "Starting proxy";
  return "Proxy idle";
}

function proxyTone(status: "idle" | "loading" | "ready" | "error"): "ok" | "busy" | "bad" {
  if (status === "error") return "bad";
  if (status === "ready") return "ok";
  return "busy";
}

export default Browser;
