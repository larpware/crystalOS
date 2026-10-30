import { useEffect, useMemo, useState } from "react";
import { Badge, Button, EmptyState, Segmented, Spinner, TextInput, Tooltip } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import {
  COMMUNITY_CATEGORIES,
  fetchPublicCommunityApps,
  installCommunityApp,
  resolveCommunityApp,
  type CommunityApp,
  type CommunityAppCategory,
} from "@/services/communityApps";
import { notify, openApp } from "@/services/os";
import { useAppsStore } from "@/state/apps";
import { CommunityAppDetailsModal } from "./CommunityAppDetailsModal";
import { ReportCommunityAppModal } from "./ReportCommunityAppModal";

type FilterSort = "featured" | "popular" | "recent";

export function CommunityAppsGallery({
  onOpenSubmit,
  initialAppId,
}: {
  onOpenSubmit: () => void;
  initialAppId?: string;
}) {
  const [apps, setApps] = useState<CommunityApp[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CommunityAppCategory | "all">("all");
  const [sort, setSort] = useState<FilterSort>("featured");

  // Modals
  const [selectedApp, setSelectedApp] = useState<CommunityApp | null>(null);
  const [reportingApp, setReportingApp] = useState<CommunityApp | null>(null);

  const installedCommunityApps = useAppsStore((state) => state.installedCommunityApps);
  const installCommunity = useAppsStore((state) => state.installCommunity);

  const loadApps = async () => {
    setLoading(true);
    const data = await fetchPublicCommunityApps({
      category,
      query,
      sort: sort === "popular" ? "popular" : "recent",
    });
    setApps(data);
    setLoading(false);

    if (initialAppId && !selectedApp) {
      const match = data.find((a) => a.id === initialAppId);
      if (match) {
        setSelectedApp(match);
      } else {
        void resolveCommunityApp(initialAppId).then((resolved) => {
          if (resolved) setSelectedApp(resolved);
        });
      }
    }
  };

  useEffect(() => {
    void loadApps();
  }, [category, sort]);

  const filtered = useMemo(() => {
    if (!apps) return [];
    if (!query.trim()) return apps;
    const q = query.trim().toLowerCase();
    return apps.filter(
      (app) =>
        app.name.toLowerCase().includes(q) ||
        app.description.toLowerCase().includes(q) ||
        (app.developerUsername && app.developerUsername.toLowerCase().includes(q)),
    );
  }, [apps, query]);

  const handleInstallClick = async (e: React.MouseEvent, app: CommunityApp) => {
    e.stopPropagation();
    if (app.verificationStatus !== "verified") {
      notify({ title: "Cannot Install", body: "Application is not verified." });
      return;
    }
    const res = await installCommunityApp(app.id);
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
      notify({ title: "Community App", body: `Installed "${app.name}".` });
      void loadApps();
    } else {
      notify({ title: "Install Failed", body: res.error ?? "Failed to install." });
    }
  };

  const handleLaunchClick = (e: React.MouseEvent, app: CommunityApp) => {
    e.stopPropagation();
    openApp(`community:${app.id}`, {
      args: { communityAppId: app.id, websiteUrl: app.websiteUrl, name: app.name },
    });
  };

  return (
    <div className="cr-comm-gallery">
      {/* Banner differentiating Built-in vs Community apps */}
      <div className="cr-comm-gallery__hero">
        <div>
          <h3>Community Web Applications</h3>
          <p>
            User-submitted websites running in isolated, secure sandboxed windows. Every application
            is individually reviewed and verified by CrystalOS staff before it can be installed.
          </p>
        </div>
        <Button variant="primary" icon="upload" onClick={onOpenSubmit}>
          Submit Application
        </Button>
      </div>

      {/* Filter and search bar */}
      <div className="cr-comm-gallery__nav">
        <Segmented
          label="Filter order"
          value={sort}
          onChange={(v) => setSort(v as FilterSort)}
          options={[
            { value: "featured", label: "Featured" },
            { value: "popular", label: "Popular" },
            { value: "recent", label: "Recently Verified" },
          ]}
        />

        <div style={{ display: "flex", gap: "8px", flex: 1, maxWidth: "400px" }}>
          <TextInput
            icon="search"
            value={query}
            aria-label="Search community applications"
            placeholder="Search verified community apps..."
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <select
          className="cr-select"
          aria-label="Filter community category"
          value={category}
          onChange={(e) => setCategory(e.target.value as CommunityAppCategory | "all")}
        >
          <option value="all">All Categories</option>
          {COMMUNITY_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {/* Grid of verified applications */}
      {loading ? (
        <div style={{ padding: "40px 0", textAlign: "center" }}>
          <Spinner label="Loading verified community apps" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="store"
          title="No Community Applications Found"
          hint={
            query
              ? `No verified apps matching "${query}".`
              : "No community applications in this category yet. Be the first to submit one!"
          }
        />
      ) : (
        <div className="cr-comm-gallery__grid">
          {filtered.map((app) => {
            const isInstalled = installedCommunityApps.some((a) => a.id === app.id);
            return (
              <div
                key={app.id}
                className="cr-comm-card"
                onClick={() => setSelectedApp(app)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setSelectedApp(app)}
              >
                <div className="cr-comm-card__header">
                  {app.iconUrl ? (
                    <img src={app.iconUrl} alt="" className="cr-comm-card__icon" />
                  ) : (
                    <div
                      className="cr-comm-card__icon"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Icon name="grid" size={24} />
                    </div>
                  )}

                  <div className="cr-comm-card__title-box">
                    <div className="cr-comm-card__title-row">
                      <span className="cr-comm-card__name">{app.name}</span>
                      <Tooltip label="Verified by CrystalOS staff">
                        <span>
                          <Icon name="check" size={13} style={{ color: "var(--accent-success, #3fd07a)" }} />
                        </span>
                      </Tooltip>
                    </div>
                    <div className="cr-comm-card__dev">
                      by {app.developerDisplayName || app.developerUsername || "Community Dev"}
                    </div>
                  </div>
                </div>

                <p className="cr-comm-card__desc">{app.description}</p>

                <div className="cr-comm-card__footer">
                  <div className="cr-comm-card__footer-left">
                    <Badge tone="default">{app.category}</Badge>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                      {app.installCount} installs
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        setReportingApp(app);
                      }}
                      title="Report Application"
                    >
                      Report
                    </Button>
                    {isInstalled ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon="external"
                        onClick={(e) => handleLaunchClick(e, app)}
                      >
                        Launch
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        icon="download"
                        onClick={(e) => handleInstallClick(e, app)}
                      >
                        Install
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* App Details Modal */}
      {selectedApp && (
        <CommunityAppDetailsModal
          app={selectedApp}
          open={Boolean(selectedApp)}
          onClose={() => setSelectedApp(null)}
          onUpdate={loadApps}
        />
      )}

      {/* Report Modal */}
      {reportingApp && (
        <ReportCommunityAppModal
          appId={reportingApp.id}
          appName={reportingApp.name}
          open={Boolean(reportingApp)}
          onClose={() => setReportingApp(null)}
        />
      )}
    </div>
  );
}
