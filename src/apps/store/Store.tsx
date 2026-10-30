import { useEffect, useMemo, useState } from "react";
import { Badge, Button, EmptyState, Segmented, TextInput } from "@/components/ui";
import { AppIcon, Icon } from "@/icons/Icon";
import { appCatalog, metaFor, optionalApps } from "@/apps/catalog";
import { isImplemented } from "@/apps/registry";
import { notify, openApp } from "@/services/os";
import { useAppsStore } from "@/state/apps";
import { useAuthStore } from "@/state/auth";
import { SYSTEM_VERSION } from "@/version";
import type { AppCapability, AppCategory, AppProps } from "@/types";
import { APP_CATEGORY_LABEL } from "@/types";
import { formatRelative } from "@/utils/format";
import { CommunityAppsGallery } from "@/apps/community/CommunityAppsGallery";
import { MyCommunitySubmissions } from "@/apps/community/MyCommunitySubmissions";
import { CommunityModerationDashboard } from "@/apps/community/CommunityModerationDashboard";
import { SubmitCommunityAppModal } from "@/apps/community/SubmitCommunityAppModal";

/* ==========================================================================
   CrystalOS Store

   Provides access to both:
   1. Official Built-in Apps: bundled with the OS, enabled/removed per profile.
   2. Community Apps: user-submitted, verified sandboxed web applications.
   ========================================================================== */

type Section = "catalogue" | "installed" | "updates" | "community" | "mine" | "review";

const CAPABILITY_LABEL: Record<AppCapability, string> = {
  filesystem: "Virtual files",
  network: "Network",
  notifications: "Notifications",
  storage: "Local storage",
  microphone: "Microphone",
  camera: "Camera",
};

export function Store({ args }: AppProps = { windowId: "store" }) {
  const installed = useAppsStore((state) => state.installed);
  const removed = useAppsStore((state) => state.removed);
  const installedCommunityApps = useAppsStore((state) => state.installedCommunityApps);
  const install = useAppsStore((state) => state.install);
  const remove = useAppsStore((state) => state.remove);
  const syncBundled = useAppsStore((state) => state.syncBundled);
  const launchCounts = useAppsStore((state) => state.launchCounts);

  const account = useAuthStore((state) => state.account);
  const isStaff = account?.role === "admin" || (account?.role as string) === "moderator";

  const initialSection = ((): Section => {
    if (args?.communityAppId || args?.section === "community") return "community";
    if (args?.section === "mine") return "mine";
    if (args?.section === "review" && isStaff) return "review";
    if (args?.section === "installed") return "installed";
    if (args?.section === "updates") return "updates";
    return "catalogue";
  })();

  const [section, setSection] = useState<Section>(initialSection);
  const [category, setCategory] = useState<AppCategory | "all">("all");
  const [query, setQuery] = useState("");
  const [submitModalOpen, setSubmitModalOpen] = useState(Boolean(args?.action === "submit"));

  // Record every bundled application the first time the store is opened.
  useEffect(() => {
    syncBundled(appCatalog.map((meta) => ({ appId: meta.id, version: meta.version })));
  }, [syncBundled]);

  // Sync if args change
  useEffect(() => {
    if (args?.communityAppId) {
      setSection("community");
    } else if (
      args?.section &&
      ["catalogue", "installed", "updates", "community", "mine", "review"].includes(args.section as string)
    ) {
      setSection(args.section as Section);
    }
    if (args?.action === "submit") {
      setSubmitModalOpen(true);
    }
  }, [args?.communityAppId, args?.section, args?.action]);

  const catalogue = useMemo(() => optionalApps(), []);

  const categories = useMemo(() => {
    const counts = new Map<AppCategory, number>();
    for (const meta of catalogue) counts.set(meta.category, (counts.get(meta.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [catalogue]);

  const list = useMemo(() => {
    const value = query.trim().toLowerCase();
    return catalogue.filter((meta) => {
      if (category !== "all" && meta.category !== category) return false;
      if (section === "installed" && removed.includes(meta.id)) return false;
      if (section === "updates") {
        const entry = installed.find((item) => item.appId === meta.id);
        if (!entry || entry.version === meta.version) return false;
      }
      if (!value) return true;
      return `${meta.name} ${meta.summary} ${meta.features.join(" ")}`.toLowerCase().includes(value);
    });
  }, [catalogue, category, installed, query, removed, section]);

  const pendingUpdates = installed.filter((entry) => {
    const meta = metaFor(entry.appId);
    return meta && meta.version !== entry.version;
  });

  const showsBundled =
    section === "catalogue" || section === "installed" || section === "updates";

  const sectionOptions: { value: Section; label: string }[] = [
    { value: "catalogue", label: "Official Apps" },
    { value: "installed", label: "Enabled" },
    { value: "updates", label: `Updates ${pendingUpdates.length || ""}`.trim() },
    { value: "community", label: "Community Apps" },
    { value: "mine", label: "My Submissions" },
    ...(isStaff ? [{ value: "review" as Section, label: "Staff Review" }] : []),
  ];

  return (
    <div className="cr-store">
      <header className="cr-store__hero">
        <div className="cr-store__hero-text">
          <h2>CrystalOS Store</h2>
          <p className="cr-row__desc">
            Explore official applications bundled with CrystalOS {SYSTEM_VERSION.version} alongside verified community web applications submitted by creators. Official apps are run natively within the system; community apps are isolated in secure sandboxed windows.
          </p>
          <div className="cr-store__actions">
            <Button
              variant="primary"
              icon="send"
              onClick={() => {
                if (!account || account.guest) {
                  notify({
                    title: "Authentication Required",
                    body: "Sign in with an account to submit an application for verification.",
                  });
                } else {
                  setSubmitModalOpen(true);
                }
              }}
            >
              Submit Application
            </Button>
            <Button icon="users" onClick={() => openApp("social")}>
              Discussions
            </Button>
            <Button icon="question" onClick={() => openApp("social", { args: { compose: "questions" } })}>
              Ask for help
            </Button>
            <Button icon="palette" onClick={() => openApp("workshop")}>
              Crystal Workshop
            </Button>
          </div>
        </div>
        <div className="cr-store__hero-stats">
          <div>
            <strong>{installed.length}</strong>
            <span>official enabled</span>
          </div>
          <div>
            <strong>{installedCommunityApps.length}</strong>
            <span>community installed</span>
          </div>
          <div>
            <strong>{pendingUpdates.length}</strong>
            <span>updates</span>
          </div>
        </div>
      </header>

      <div className="cr-store__bar">
        <Segmented
          label="Store sections"
          value={section}
          onChange={setSection}
          options={sectionOptions}
        />
        {showsBundled && (
          <>
            <div className="cr-store__search">
              <TextInput
                icon="search"
                value={query}
                aria-label="Search the store"
                placeholder="Search official applications"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <select
              className="cr-select"
              aria-label="Filter by category"
              value={category}
              onChange={(event) => setCategory(event.target.value as AppCategory | "all")}
            >
              <option value="all">All categories</option>
              {categories.map(([id, count]) => (
                <option key={id} value={id}>
                  {APP_CATEGORY_LABEL[id]} ({count})
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      <div className="cr-store__scroll">
        {section === "updates" && (
          <div className="cr-store__note">
            <Icon name="info" size={15} />
            <span>
              Updates are applied from the bundle that ships with the OS. When this build is
              replaced, the version recorded here changes with it.
            </span>
          </div>
        )}

        {section === "community" && (
          <CommunityAppsGallery
            onOpenSubmit={() => setSubmitModalOpen(true)}
            initialAppId={args?.communityAppId as string | undefined}
          />
        )}

        {section === "mine" && (
          <MyCommunitySubmissions onOpenSubmit={() => setSubmitModalOpen(true)} />
        )}

        {section === "review" && isStaff && (
          <CommunityModerationDashboard />
        )}

        {showsBundled &&
          (list.length === 0 ? (
            <EmptyState
              icon={section === "updates" ? "check" : "store"}
              title={
                section === "updates"
                  ? "Every application is up to date"
                  : section === "installed"
                    ? "Nothing enabled in this profile"
                    : "No applications match"
              }
              hint={
                section === "updates"
                  ? "Nothing to apply right now."
                  : "Try a different search term or category."
              }
            />
          ) : (
            <div className="cr-store__grid">
              {list.map((meta) => {
                const entry = installed.find((item) => item.appId === meta.id);
                const isRemoved = removed.includes(meta.id);
                const launches = launchCounts[meta.id] ?? 0;
                const ready = isImplemented(meta.id);
                return (
                  <article key={meta.id} className="cr-store__card" data-removed={isRemoved}>
                    <header>
                      <AppIcon appId={meta.id} name={meta.icon} size={42} />
                      <div>
                        <h3>{meta.name}</h3>
                        <div className="cr-store__meta">
                          <Badge>{APP_CATEGORY_LABEL[meta.category]}</Badge>
                          <span className="cr-row__desc">v{meta.version}</span>
                          {!ready && <Badge tone="warning">Not in this build</Badge>}
                        </div>
                      </div>
                    </header>

                    <p className="cr-store__summary">{meta.summary}</p>

                    <ul className="cr-store__features">
                      {meta.features.slice(0, 3).map((feature) => (
                        <li key={feature}>
                          <Icon name="check" size={12} />
                          {feature}
                        </li>
                      ))}
                    </ul>

                    {meta.capabilities && meta.capabilities.length > 0 && (
                      <div className="cr-store__caps">
                        <span className="cr-row__desc">Declares:</span>
                        {meta.capabilities.map((capability) => (
                          <Badge key={capability}>{CAPABILITY_LABEL[capability]}</Badge>
                        ))}
                      </div>
                    )}

                    <footer>
                      <span className="cr-row__desc">
                        {isRemoved
                          ? "Removed from this profile"
                          : entry
                            ? launches > 0
                              ? `Enabled · launched ${launches}×`
                              : `Enabled ${formatRelative(entry.installedAt)}`
                            : "Bundled"}
                      </span>
                      <div className="cr-store__actions">
                        <Button
                          size="sm"
                          icon="external"
                          disabled={!ready}
                          title={ready ? undefined : "This catalogue entry has no bundle in this build."}
                          onClick={() => openApp(meta.id)}
                        >
                          Open
                        </Button>
                        {isRemoved ? (
                          <Button size="sm" variant="primary" icon="download" onClick={() => install(meta.id, meta.version)}>
                            Enable
                          </Button>
                        ) : (
                          !meta.system && (
                            <Button size="sm" variant="ghost" icon="trash" onClick={() => remove(meta.id)}>
                              Remove
                            </Button>
                          )
                        )}
                      </div>
                    </footer>
                  </article>
                );
              })}
            </div>
          ))}
      </div>

      <SubmitCommunityAppModal
        open={submitModalOpen}
        onClose={() => setSubmitModalOpen(false)}
        onSubmitted={() => {
          setSubmitModalOpen(false);
          setSection("mine");
        }}
      />
    </div>
  );
}

export default Store;
