import { useCallback, useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AppErrorBoundary } from "@/components/ErrorBoundary";
import { Menu, type MenuItem } from "@/components/ui";
import { metaFor } from "@/apps/catalog";
import { getAppComponent } from "@/apps/registry";
import { useWindowStore } from "@/state/windows";
import { useWorkspaceStore } from "@/state/workspaces";
import { Window, type WindowPreview } from "./Window";
import { zoneRect } from "./geometry";
import { openApp } from "@/services/os";
import type { AppProps, Rect } from "@/types";

/* ==========================================================================
   Window manager layer

   Renders every open window in stacking order. The manager itself knows
   nothing about specific applications — it resolves components from the
   registry and gives each one a crash boundary.
   ========================================================================== */

export function WindowManager() {
  const windows = useWindowStore((state) => state.windows);
  const workArea = useWindowStore((state) => state.workArea);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeId);
  const closeWindow = useWindowStore((state) => state.close);
  const minimize = useWindowStore((state) => state.minimize);
  const toggleFullScreen = useWindowStore((state) => state.toggleFullScreen);

  const [preview, setPreview] = useState<WindowPreview>(null);
  const [closingWindows, setClosingWindows] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; windowId: string; appId: string } | null>(
    null,
  );

  const previewRect: Rect | null = useMemo(() => {
    if (!preview) return null;
    if (preview.kind === "maximize") return workArea;
    return zoneRect(preview.zone, workArea);
  }, [preview, workArea]);

  const handleContextMenu = useCallback(
    (windowId: string, appId: string) => (event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault();
      setMenu({ x: event.clientX, y: event.clientY, windowId, appId });
    },
    [],
  );

  // Handle window closing animation
  useEffect(() => {
    const actualWindows = windows.map((w) => w.id);
    // Prune IDs that have already left the store. The updater returns the
    // previous set when nothing was pruned: handing back a fresh `Set` every
    // pass made the effect depend on its own output, so it ran forever and
    // re-rendered the whole desktop with it.
    setClosingWindows((prev) => {
      let next: Set<string> | null = null;
      for (const id of prev) {
        if (!actualWindows.includes(id)) {
          next ??= new Set(prev);
          next.delete(id);
        }
      }
      return next ?? prev;
    });
  }, [windows]);

  const startClosing = useCallback((windowId: string) => {
    setClosingWindows((prev) => new Set(prev).add(windowId));
    // Remove from store after animation completes
    const timer = setTimeout(() => {
      closeWindow(windowId);
      setClosingWindows((prev) => {
        const next = new Set(prev);
        next.delete(windowId);
        return next;
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [closeWindow]);

  const menuItems: MenuItem[] = useMemo(() => {
    if (!menu) return [];
    const meta = metaFor(menu.appId);
    /*
       The window's own bar is the only place the four controls normally live,
       and full screen unmounts it — so the menu is where close, minimize and
       the way back out of full screen have to be reachable. It leads with the
       mode the window is actually in: full screen to enter it, exit full
       screen to leave it, with the other two always present underneath. */
    const target = windows.find((window) => window.id === menu.windowId);
    const full = target?.full === true;
    const items: MenuItem[] = [
      {
        id: "full-screen",
        label: full ? "Exit full screen" : "Full screen",
        icon: full ? "collapse" : "expand",
        run: () => toggleFullScreen(menu.windowId),
      },
      {
        id: "minimize",
        label: "Minimize",
        icon: "minimize",
        run: () => minimize(menu.windowId),
      },
      {
        id: "close",
        label: "Close window",
        icon: "close",
        run: () => startClosing(menu.windowId),
      },
      {
        id: "new",
        label: `New ${meta?.name ?? "window"}`,
        icon: "plus",
        separatorBefore: true,
        disabled: Boolean(meta?.singleton),
        run: () => meta && openApp(meta.id, { newInstance: true }),
      },
    ];
    return items;
  }, [menu, minimize, closeWindow, toggleFullScreen, windows]);

  return (
    <div className="cr-window-layer">
      {windows.map((instance) => {
        const meta = metaFor(instance.appId);
        const Component = getAppComponent(instance.appId);
        const appProps: AppProps = { windowId: instance.id, args: instance.args };
        const isClosing = closingWindows.has(instance.id);
        /*
         * Windows on another workspace stay mounted — their applications keep
         * running — but leave the desk exactly the way a minimized window does.
         * Sticky windows are the exception: they belong to every workspace.
         */
        const hidden =
          instance.sticky !== true &&
          Boolean(instance.workspaceId) &&
          instance.workspaceId !== activeWorkspaceId;

        return (
          <Window
            key={instance.id}
            window={instance}
            minSize={meta?.minSize ?? { width: 320, height: 240 }}
            resizable={meta?.resizable !== false}
            onPreview={setPreview}
            onContextMenu={handleContextMenu(instance.id, instance.appId)}
            isClosing={isClosing}
            hidden={hidden}
          >
            {Component ? (
              <AppErrorBoundary
                appName={meta?.name ?? instance.appId}
                onClose={() => closeWindow(instance.id)}
              >
                <Component {...appProps} />
              </AppErrorBoundary>
            ) : (
              <UnavailableApp appId={instance.appId} onClose={() => closeWindow(instance.id)} />
            )}
          </Window>
        );
      })}

      {previewRect && (
        <div
          className="cr-snap-preview"
          style={{
            transform: `translate3d(${Math.round(previewRect.x)}px, ${Math.round(previewRect.y)}px, 0)`,
            width: Math.round(previewRect.width),
            height: Math.round(previewRect.height),
          }}
          aria-hidden="true"
        />
      )}

      {menu && (
        <Menu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}

/** Rendered when a window references an application that is not registered. */
function UnavailableApp({ appId, onClose }: { appId: string; onClose: () => void }) {
  return (
    <div className="cr-crash">
      <div className="cr-crash__title">Application unavailable</div>
      <p className="cr-empty__hint">
        Nothing is registered for <code className="cr-mono">{appId}</code>. It may have been removed
        in the CrystalOS Store.
      </p>
      <button type="button" className="cr-btn cr-btn--secondary" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
