import { useState } from "react";
import { Badge, Button, Modal } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import {
  installCommunityApp,
  regenerateShareToken,
  uninstallCommunityApp,
  VERIFICATION_STATUS_META,
  type CommunityApp,
} from "@/services/communityApps";
import { addDesktopShortcut, hasDesktopShortcut, notify, openApp } from "@/services/os";
import { useAppsStore } from "@/state/apps";
import { useAuthStore } from "@/state/auth";
import { ReportCommunityAppModal } from "./ReportCommunityAppModal";

interface DetailsModalProps {
  app: CommunityApp | null;
  open: boolean;
  onClose: () => void;
  onUpdate?: () => void;
}

export function CommunityAppDetailsModal({ app, open, onClose, onUpdate }: DetailsModalProps) {
  const [reportOpen, setReportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const account = useAuthStore((state) => state.account);
  const installedApps = useAppsStore((state) => state.installedCommunityApps);
  const installCommunity = useAppsStore((state) => state.installCommunity);
  const uninstallCommunity = useAppsStore((state) => state.uninstallCommunity);

  if (!app) return null;

  const isInstalled = installedApps.some((a) => a.id === app.id);
  const isOwner = Boolean(account && account.id === app.developerId);
  const isVerified = app.verificationStatus === "verified";
  const onDesktop = hasDesktopShortcut(`community:${app.id}`);

  const statusMeta = VERIFICATION_STATUS_META[app.verificationStatus] ?? {
    label: app.verificationStatus,
    tone: "default" as const,
    hint: "",
  };

  const domain = (() => {
    try {
      return new URL(app.websiteUrl).hostname;
    } catch {
      return app.websiteUrl;
    }
  })();

  const shareUrl = (() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://crystalos.example";
    if (app.visibility === "unlisted" && app.shareToken) {
      return `${origin}/?app=${encodeURIComponent(app.id)}&token=${encodeURIComponent(app.shareToken)}`;
    }
    return `${origin}/?app=${encodeURIComponent(app.id)}`;
  })();

  const handleInstall = async () => {
    if (!isVerified) {
      notify({ title: "Installation Blocked", body: "Only verified applications can be installed." });
      return;
    }
    setBusy(true);
    const res = await installCommunityApp(app.id);
    setBusy(false);
    if (res.ok) {
      installCommunity({
        id: app.id,
        name: app.name,
        description: app.description,
        websiteUrl: app.websiteUrl,
        iconUrl: app.iconUrl,
        category: app.category,
        developerUsername: app.developerUsername,
        developerDisplayName: app.developerDisplayName,
        installedAt: Date.now(),
      });
      notify({ title: "Community App", body: `Installed "${app.name}". Available in launcher and desktop.` });
      onUpdate?.();
    } else {
      notify({ title: "Install Failed", body: res.error ?? "Failed to install." });
    }
  };

  const handleUninstall = async () => {
    setBusy(true);
    const res = await uninstallCommunityApp(app.id);
    setBusy(false);
    if (res.ok) {
      uninstallCommunity(app.id);
      notify({ title: "Community App", body: `Uninstalled "${app.name}".` });
      onUpdate?.();
    } else {
      notify({ title: "Uninstall Failed", body: res.error ?? "Failed to uninstall." });
    }
  };

  const handleLaunch = () => {
    openApp(`community:${app.id}`, {
      args: {
        communityAppId: app.id,
        websiteUrl: app.websiteUrl,
        name: app.name,
      },
    });
    onClose();
  };

  const handlePinDesktop = () => {
    const shortcutId = addDesktopShortcut(`community:${app.id}`);
    if (shortcutId) {
      notify({ title: "Desktop Shortcut", body: `Added shortcut for "${app.name}" to your desktop.` });
    }
  };

  const handleCopyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      notify({ title: "Link Copied", body: "Direct share link copied to clipboard." });
    } catch {
      notify({ title: "Copy Failed", body: shareUrl });
    }
  };

  const handleRegenerateToken = async () => {
    setBusy(true);
    const res = await regenerateShareToken(app.id);
    setBusy(false);
    if (res.ok && res.token) {
      notify({ title: "Share Link Regenerated", body: "Previous share links have been invalidated." });
      onUpdate?.();
    } else {
      notify({ title: "Error", body: res.error ?? "Could not regenerate token." });
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={app.name}
        width={560}
        footer={
          <div className="cr-comm-details__actions">
            <div style={{ display: "flex", gap: "6px" }}>
              <Button size="sm" variant="ghost" icon="warning" onClick={() => setReportOpen(true)}>
                Report
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={copied ? "check" : "share"}
                onClick={handleCopyShare}
              >
                {copied ? "Copied" : "Share"}
              </Button>
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              {isInstalled ? (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="plus"
                    disabled={onDesktop}
                    onClick={handlePinDesktop}
                  >
                    {onDesktop ? "Pinned to Desktop" : "Pin to Desktop"}
                  </Button>
                  <Button size="sm" variant="danger" icon="trash" onClick={handleUninstall} disabled={busy}>
                    Uninstall
                  </Button>
                  <Button size="sm" variant="primary" icon="external" onClick={handleLaunch}>
                    Launch
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  icon="download"
                  disabled={!isVerified || busy}
                  onClick={handleInstall}
                >
                  {isVerified ? (busy ? "Installing..." : "Install App") : "Not Installable"}
                </Button>
              )}
            </div>
          </div>
        }
      >
        <div className="cr-comm-details">
          {/* Header */}
          <div className="cr-comm-details__header">
            {app.iconUrl ? (
              <img src={app.iconUrl} alt={app.name} className="cr-comm-details__icon" />
            ) : (
              <div
                className="cr-comm-details__icon"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "var(--bg-elevated)",
                }}
              >
                <Icon name="grid" size={32} />
              </div>
            )}

            <div className="cr-comm-details__info">
              <h2>{app.name}</h2>
              <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                Developed by{" "}
                <strong style={{ color: "var(--text-primary)" }}>
                  {app.developerDisplayName || app.developerUsername || "Community Developer"}
                </strong>
              </div>
              <div className="cr-comm-details__tags">
                <Badge tone="default">Community App</Badge>
                <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                <Badge tone="default">{app.category}</Badge>
                {app.visibility === "unlisted" && <Badge tone="warning">Unlisted</Badge>}
              </div>
            </div>
          </div>

          {/* Suspended alert banner */}
          {app.verificationStatus === "suspended" && (
            <div
              style={{
                padding: "12px 14px",
                background: "color-mix(in srgb, var(--accent-danger) 15%, transparent)",
                border: "1px solid var(--accent-danger)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            >
              <div style={{ fontWeight: 600, color: "var(--accent-danger)", marginBottom: "4px" }}>
                Application Suspended
              </div>
              <p style={{ margin: 0, color: "var(--text-secondary)" }}>
                This community application was suspended by CrystalOS staff.
                {app.suspensionReason && ` Reason: ${app.suspensionReason}`}
              </p>
            </div>
          )}

          {/* Pending verification banner */}
          {app.verificationStatus === "pending" && (
            <div
              style={{
                padding: "12px 14px",
                background: "color-mix(in srgb, var(--accent-warning) 15%, transparent)",
                border: "1px solid var(--accent-warning)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            >
              <div style={{ fontWeight: 600, color: "var(--accent-warning)", marginBottom: "4px" }}>
                Awaiting Verification
              </div>
              <p style={{ margin: 0, color: "var(--text-secondary)" }}>
                This application is queued for manual safety review by staff. It cannot be installed
                until verified.
              </p>
            </div>
          )}

          {/* Description */}
          <div className="cr-comm-details__desc">{app.description}</div>

          {/* Metadata Grid */}
          <div className="cr-comm-details__meta-grid">
            <div className="cr-comm-details__meta-item">
              <div className="cr-comm-details__meta-label">Website Domain</div>
              <div className="cr-comm-details__meta-val" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <Icon name="lock" size={11} />
                <span>{domain}</span>
              </div>
            </div>

            <div className="cr-comm-details__meta-item">
              <div className="cr-comm-details__meta-label">Installations</div>
              <div className="cr-comm-details__meta-val">{app.installCount} users</div>
            </div>

            <div className="cr-comm-details__meta-item">
              <div className="cr-comm-details__meta-label">Security Runtime</div>
              <div className="cr-comm-details__meta-val">Isolated Sandboxed Iframe</div>
            </div>

            <div className="cr-comm-details__meta-item">
              <div className="cr-comm-details__meta-label">Submitted</div>
              <div className="cr-comm-details__meta-val">
                {new Date(app.createdAt).toLocaleDateString()}
              </div>
            </div>
          </div>

          {/* Owner controls for unlisted apps */}
          {isOwner && app.visibility === "unlisted" && (
            <div
              style={{
                padding: "12px",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
              }}
            >
              <div style={{ fontSize: "12px" }}>
                <div style={{ fontWeight: 600 }}>Unlisted Access Link</div>
                <div style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                  Anyone with this link can view and install this verified app.
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={handleRegenerateToken} disabled={busy}>
                Regenerate Link
              </Button>
            </div>
          )}
        </div>
      </Modal>

      <ReportCommunityAppModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        appId={app.id}
        appName={app.name}
      />
    </>
  );
}
