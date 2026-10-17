import { useEffect, useMemo, useState } from "react";
import { Badge, Button, EmptyState, Segmented, TextInput } from "@/components/ui";
import { AppIcon, Icon } from "@/icons/Icon";
import { appCatalog, metaFor, optionalApps } from "@/apps/catalog";
import { isImplemented } from "@/apps/registry";
import { openApp } from "@/services/os";
import { useAppsStore } from "@/state/apps";
import { SYSTEM_VERSION } from "@/version";
import type { AppCategory } from "@/types";
import { APP_CATEGORY_LABEL } from "@/types";
import { formatRelative } from "@/utils/format";

/* ==========================================================================
   CrystalOS Store

   This store is honest about its install model: every application in it is
   bundled with the OS. Installing records that the application is enabled;
   removing hides it from this profile. There is no download, so there is no
   progress bar pretending to be one.
   ========================================================================== */

type Section = "catalogue" | "installed" | "updates";

export function Store() {
  const installed = useAppsStore((state) => state.installed);
  const removed = useAppsStore((state) => state.removed);
  const install = useAppsStore((state) => state.install);
  const remove = useAppsStore((state) => state.remove);
  const syncBundled = useAppsStore((state) => state.syncBundled);
  const launchCounts = useAppsStore((state) => state.launchCounts);
  const [section, setSection] = useState<Section>("catalogue");
  const [category, setCategory] = useState<AppCategory | "all">("all");
  const [query, setQuery] = useState("");

  // Record every bundled application the first time the store is opened.
  useEffect(() => {
    syncBundled(appCatalog.map((meta) => ({ appId: meta.id, version: meta.version })));
  }, [syncBundled]);

  // Only optional applications are listed. Applications that are part of the
  // operating system itself live in Settings → Applications under "System
  // apps", not here — the Store is for things you can add or remove.
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

  return (
    <div className="cr-store">
      <header className="cr-store__hero">
        <div className="cr-store__hero-text">
          <h2>CrystalOS Store</h2>
          <p className="cr-row__desc">
            Optional applications bundled with CrystalOS {SYSTEM_VERSION.version}: {catalogue.length}{" "}
            of them, {catalogue.filter((meta) => isImplemented(meta.id)).length} with an implementation in
            this build. Nothing here is downloaded — enabling adds the application to this profile and
            removing it hides it. The system applications that are part of the OS are listed in
            Settings → Applications.
          </p>
        </div>
        <div className="cr-store__hero-stats">
          <div>
            <strong>{installed.length}</strong>
            <span>in this profile</span>
          </div>
          <div>
            <strong>{removed.length}</strong>
            <span>removed</span>
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
          options={[
            { value: "catalogue", label: "Catalogue" },
            { value: "installed", label: "Enabled" },
            { value: "updates", label: `Updates ${pendingUpdates.length || ""}`.trim() },
          ]}
        />
        <div className="cr-store__search">
          <TextInput
            icon="search"
            value={query}
            aria-label="Search the store"
            placeholder="Search applications"
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

        {list.length === 0 ? (
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
              return (
                <article key={meta.id} className="cr-store__card" data-removed={isRemoved}>
                  <header>
                    <AppIcon appId={meta.id} name={meta.icon} size={42} />
                    <div>
                      <h3>{meta.name}</h3>
                      <div className="cr-store__meta">
                        <Badge>{APP_CATEGORY_LABEL[meta.category]}</Badge>
                        <span className="cr-row__desc">v{meta.version}</span>
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
                      <Button size="sm" icon="external" onClick={() => openApp(meta.id)}>
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
        )}
      </div>
    </div>
  );
}

export default Store;
