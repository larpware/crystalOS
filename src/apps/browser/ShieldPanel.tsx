import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconButton, Switch } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import {
  SHIELD_LIST_SOURCE,
  clearPopups,
  defaultFilterList,
  dismissPopup,
  isSiteAllowed,
  popupsFor,
  setPopupSiteAllowed,
  setSiteAllowed,
  siteOfUrl,
  updateShieldSettings,
} from "@/services/shield";
import { useShield } from "@/services/shield/useShield";

/* ==========================================================================
   The Shield popover

   The one place a person can see what was blocked on the page in front of
   them and say "not here". It reports the session's own counts, which is the
   only thing it can honestly claim to know: CrystalOS does not keep a log of
   what anybody browsed.
   ========================================================================== */

export function ShieldPanel({
  anchor,
  owner,
  currentUrl,
  onOpen,
  onClose,
  onOpenSettings,
}: {
  anchor: { x: number; y: number };
  owner: string | null;
  currentUrl: string;
  onOpen: (url: string) => void;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const shield = useShield();
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(anchor);

  const site = currentUrl.startsWith("about:") ? null : siteOfUrl(currentUrl);
  const blocked = shield.blocked[owner ?? ""] ?? 0;
  const last = shield.lastBlocked[owner ?? ""] ?? null;
  const popups = popupsFor(owner);
  const rules = defaultFilterList();

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    setPosition({
      x: Math.max(6, Math.min(anchor.x, window.innerWidth - width - 6)),
      y: Math.max(6, Math.min(anchor.y, window.innerHeight - height - 6)),
    });
  }, [anchor.x, anchor.y, popups.length, blocked]);

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

  return createPortal(
    <div
      ref={ref}
      className="cr-browser__shield-panel"
      role="dialog"
      aria-label="Shield"
      style={{ left: position.x, top: position.y }}
    >
      <header className="cr-browser__shield-head">
        <span className="cr-browser__shield-title">
          <Icon name="filter" size={14} />
          Shield
        </span>
        <IconButton icon="close" label="Close Shield" size={13} onClick={onClose} />
      </header>

      <div className="cr-browser__shield-row">
        <span className="cr-browser__shield-label">Block ads and trackers</span>
        <Switch
          label="Block ads and trackers"
          checked={shield.settings.enabled}
          onChange={(enabled) => updateShieldSettings({ enabled })}
        />
      </div>

      <div className="cr-browser__shield-row">
        <span className="cr-browser__shield-label">Block popups</span>
        <Switch
          label="Block popups"
          checked={shield.settings.popups}
          onChange={(popups) => updateShieldSettings({ popups })}
        />
      </div>

      {site && (
        <div className="cr-browser__shield-row">
          <span className="cr-browser__shield-label">
            Allow everything on <strong>{site}</strong>
          </span>
          <Switch
            label={`Allow everything on ${site}`}
            id="cr-shield-site-allow"
            checked={isSiteAllowed(site)}
            onChange={(allowed) => setSiteAllowed(site, allowed)}
          />
        </div>
      )}

      <div className="cr-browser__shield-stat">
        <span className="cr-browser__shield-count">{blocked}</span>
        <span className="cr-browser__shield-stat-text">
          blocked on this page
          {last && (
            <span className="cr-browser__shield-last">
              last: {last.host} <span className="cr-browser__shield-type">{last.type}</span>
            </span>
          )}
        </span>
      </div>

      {shield.settings.popups && popups.length > 0 && (
        <div className="cr-browser__shield-popups">
          <div className="cr-browser__shield-popups-head">
            <span>
              {popups.length} popup{popups.length === 1 ? "" : "s"} stopped
            </span>
            <button type="button" className="cr-browser__shield-link" onClick={clearPopups}>
              Clear
            </button>
          </div>
          <ul className="cr-browser__shield-popup-list">
            {popups.map((popup) => (
              <li key={popup.id} className="cr-browser__shield-popup">
                <span className="cr-browser__shield-popup-url" title={popup.url}>
                  {popup.url.replace(/^https?:\/\//, "")}
                </span>
                <span className="cr-browser__shield-popup-actions">
                  <button
                    type="button"
                    className="cr-browser__shield-link"
                    onClick={() => {
                      onOpen(popup.url);
                      dismissPopup(popup.id);
                    }}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    className="cr-browser__shield-link"
                    title="Allow popups from this site. The page has to ask again."
                    onClick={() => {
                      const host = siteOfUrl(popup.pageUrl ?? currentUrl);
                      if (host) setPopupSiteAllowed(host, true);
                      dismissPopup(popup.id);
                    }}
                  >
                    Allow here
                  </button>
                  <button
                    type="button"
                    className="cr-browser__shield-link"
                    aria-label="Dismiss"
                    onClick={() => dismissPopup(popup.id)}
                  >
                    Dismiss
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="cr-browser__shield-foot">
        <span>
          {rules.rules.length} rules · {SHIELD_LIST_SOURCE}
          {rules.unsupported.length > 0 ? ` · ${rules.unsupported.length} unsupported` : ""}
        </span>
        <button type="button" className="cr-browser__shield-link" onClick={onOpenSettings}>
          Proxy and Shield settings…
        </button>
      </footer>
    </div>,
    document.body,
  );
}
