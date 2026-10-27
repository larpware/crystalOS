import { useEffect, useMemo, useState } from "react";
import { Badge, Button, EmptyState, Segmented, Textarea, TextInput } from "@/components/ui";
import { AppIcon, Icon } from "@/icons/Icon";
import { appCatalog, metaFor, optionalApps } from "@/apps/catalog";
import { isImplemented } from "@/apps/registry";
import {
  adminQueue,
  approvedApps,
  mySubmissions,
  reviewSubmission,
  submitApp,
  type StoreSubmission,
} from "@/services/appStore";
import { notify, openApp } from "@/services/os";
import { useAppsStore } from "@/state/apps";
import { useAuthStore } from "@/state/auth";
import { useBrowserStore } from "@/state/browser";
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

type Section = "catalogue" | "installed" | "updates" | "community" | "submit" | "mine" | "review";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function Store() {
  const installed = useAppsStore((state) => state.installed);
  const removed = useAppsStore((state) => state.removed);
  const install = useAppsStore((state) => state.install);
  const remove = useAppsStore((state) => state.remove);
  const syncBundled = useAppsStore((state) => state.syncBundled);
  const launchCounts = useAppsStore((state) => state.launchCounts);
  const account = useAuthStore((state) => state.account);
  const isAdmin = account?.role === "admin";
  const [section, setSection] = useState<Section>("catalogue");
  const [category, setCategory] = useState<AppCategory | "all">("all");
  const [query, setQuery] = useState("");
  const [community, setCommunity] = useState<StoreSubmission[] | null>(null);
  const [mine, setMine] = useState<StoreSubmission[] | null>(null);
  const [queue, setQueue] = useState<StoreSubmission[] | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [subName, setSubName] = useState("");
  const [subDescription, setSubDescription] = useState("");
  const [subCategory, setSubCategory] = useState<AppCategory>("productivity");
  const [subUrl, setSubUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});

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

  /* ---- Community submissions ------------------------------------------- */

  // Refetched on every activation, not cached: a moderator's decision made
  // anywhere else should show up the next time the tab is opened.
  useEffect(() => {
    if (section !== "community") return;
    let cancelled = false;
    void approvedApps().then((result) => {
      if (!cancelled) setCommunity(result.ok ? result.data.submissions : []);
    });
    return () => {
      cancelled = true;
    };
  }, [section]);

  useEffect(() => {
    if (section !== "mine" || !account || account.guest) return;
    let cancelled = false;
    void mySubmissions().then((result) => {
      if (!cancelled) setMine(result.ok ? result.data.submissions : []);
    });
    return () => {
      cancelled = true;
    };
  }, [section, account]);

  useEffect(() => {
    if (section !== "review" || !isAdmin) return;
    void adminQueue().then((result) => {
      if (result.ok) {
        setQueue(result.data.submissions);
        setPendingCount(result.data.pendingCount);
      } else {
        setQueue([]);
      }
    });
  }, [section, isAdmin]);

  const openCommunityApp = (url: string) => {
    const tabId = useBrowserStore.getState().newTab(url, true);
    openApp("browser", { args: { tabId } });
  };

  const doSubmit = async () => {
    setSubmitting(true);
    const result = await submitApp({
      name: subName.trim(),
      description: subDescription.trim(),
      category: subCategory,
      url: subUrl.trim(),
    });
    setSubmitting(false);
    if (result.ok) {
      notify({ title: "Crystal Store", body: "Submitted — a moderator will review it." });
      setSubName("");
      setSubDescription("");
      setSubUrl("");
      setMine(null);
      setSection("mine");
    } else {
      notify({ title: "Crystal Store", body: result.error.message });
    }
  };

  const decide = async (id: string, action: "approve" | "reject") => {
    const note = (notes[id] ?? "").trim();
    const result = await reviewSubmission(id, action, note || null);
    if (result.ok) {
      setNotes((current) => ({ ...current, [id]: "" }));
      const fresh = await adminQueue();
      if (fresh.ok) {
        setQueue(fresh.data.submissions);
        setPendingCount(fresh.data.pendingCount);
      }
      setCommunity(null);
      setMine(null);
    } else {
      notify({ title: "Crystal Store", body: result.error.message });
    }
  };

  const showsBundled =
    section === "catalogue" || section === "installed" || section === "updates";

  const sectionOptions: { value: Section; label: string }[] = [
    { value: "catalogue", label: "Catalogue" },
    { value: "installed", label: "Enabled" },
    { value: "updates", label: `Updates ${pendingUpdates.length || ""}`.trim() },
    { value: "community", label: "Community" },
    { value: "submit", label: "Submit" },
    { value: "mine", label: "Mine" },
    ...(isAdmin ? [{ value: "review" as Section, label: `Review ${pendingCount || ""}`.trim() }] : []),
  ];

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
          options={sectionOptions}
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

        {section === "community" && (
          <div className="cr-store__community">
            <p className="cr-row__desc">
              Applications proposed by CrystalOS members and approved by a store moderator. A
              community application is a web application: opening one starts it in the CrystalOS
              Browser, so nothing is uploaded and nothing else ever runs.
            </p>
            {community === null ? (
              <EmptyState icon="store" title="Loading the community catalogue" hint="One moment." />
            ) : community.length === 0 ? (
              <EmptyState
                icon="store"
                title="No community applications yet"
                hint="Propose the first one from the Submit tab."
              />
            ) : (
              <div className="cr-store__grid">
                {community.map((app) => (
                  <article key={app.id} className="cr-store__card">
                    <header>
                      <Icon name="store" size={34} />
                      <div>
                        <h3>{app.name}</h3>
                        <div className="cr-store__meta">
                          <Badge>{app.category}</Badge>
                          <span className="cr-row__desc">
                            by {app.submitter.displayName ?? app.submitter.username ?? "unknown"}
                          </span>
                        </div>
                      </div>
                    </header>
                    <p className="cr-store__summary">{app.description}</p>
                    <footer>
                      <span className="cr-row__desc">{hostOf(app.url)}</span>
                      <div className="cr-store__actions">
                        <Button size="sm" icon="external" onClick={() => openCommunityApp(app.url)}>
                          Open in Browser
                        </Button>
                      </div>
                    </footer>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}

        {section === "submit" &&
          (!account || account.guest ? (
            <EmptyState
              icon="user"
              title="Submitting needs a CrystalOS account"
              hint="Submissions are tied to an account so a moderator can answer them. Sign in from Settings → Account."
            />
          ) : (
            <div className="cr-store__submit">
              <h3>Propose an application</h3>
              <p className="cr-row__desc">
                Submissions are web applications: give the URL the Browser should open, plus enough
                description for a moderator to judge it. Approval lists the link in the Community
                tab — it never uploads or executes code on the server.
              </p>
              <TextInput
                value={subName}
                aria-label="Application name"
                placeholder="Application name"
                onChange={(event) => setSubName(event.target.value)}
              />
              <Textarea
                value={subDescription}
                rows={3}
                aria-label="Description"
                placeholder="What does it do? What is it good at?"
                onChange={(event) => setSubDescription(event.target.value)}
              />
              <TextInput
                value={subUrl}
                aria-label="Application URL"
                placeholder="https://…"
                onChange={(event) => setSubUrl(event.target.value)}
              />
              <div className="cr-store__row">
                <select
                  className="cr-select"
                  aria-label="Category"
                  value={subCategory}
                  onChange={(event) => setSubCategory(event.target.value as AppCategory)}
                >
                  {Object.entries(APP_CATEGORY_LABEL).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
                <Button
                  variant="primary"
                  icon="send"
                  disabled={submitting}
                  onClick={() => void doSubmit()}
                >
                  Submit for review
                </Button>
              </div>
            </div>
          ))}

        {section === "mine" &&
          (!account || account.guest ? (
            <EmptyState
              icon="user"
              title="Your submissions live with your account"
              hint="Sign in from Settings → Account to propose applications and track their review."
            />
          ) : mine === null ? (
            <EmptyState icon="store" title="Loading your submissions" hint="One moment." />
          ) : mine.length === 0 ? (
            <EmptyState
              icon="store"
              title="You have not submitted anything yet"
              hint="Propose an application from the Submit tab."
            />
          ) : (
            <div className="cr-store__list">
              {mine.map((app) => (
                <div key={app.id} className="cr-store__review-row">
                  <div className="cr-store__review-text">
                    <strong>{app.name}</strong>
                    <Badge
                      tone={
                        app.status === "approved"
                          ? "success"
                          : app.status === "rejected"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {app.status}
                    </Badge>
                    <p className="cr-row__desc">{app.description}</p>
                    {app.reviewNote && <small>Moderator: {app.reviewNote}</small>}
                  </div>
                  <span className="cr-row__desc">
                    {formatRelative(app.createdAt)} · {hostOf(app.url)}
                  </span>
                </div>
              ))}
            </div>
          ))}

        {section === "review" && isAdmin && (
          <div className="cr-store__review">
            <h3>Moderation queue{pendingCount ? ` · ${pendingCount} pending` : ""}</h3>
            <p className="cr-row__desc">
              Approving lists the application in the Community tab; rejecting keeps it private to
              its submitter. Either way the note reaches them in Mine.
            </p>
            {queue === null ? (
              <EmptyState icon="store" title="Loading the queue" hint="One moment." />
            ) : queue.length === 0 ? (
              <EmptyState icon="check" title="The queue is clear" hint="Every submission has been reviewed." />
            ) : (
              queue.map((app) => (
                <div key={app.id} className="cr-store__review-row">
                  <div className="cr-store__review-text">
                    <strong>{app.name}</strong> <Badge>{app.category}</Badge>
                    <p className="cr-row__desc">{app.description}</p>
                    <small className="cr-row__desc">
                      {app.url} · by {app.submitter.username ?? "unknown"} · {formatRelative(app.createdAt)}
                    </small>
                  </div>
                  <TextInput
                    value={notes[app.id] ?? ""}
                    aria-label={`Note for ${app.name}`}
                    placeholder="Note for the submitter (optional)"
                    onChange={(event) =>
                      setNotes((current) => ({ ...current, [app.id]: event.target.value }))
                    }
                  />
                  <div className="cr-store__actions">
                    <Button size="sm" variant="primary" icon="check" onClick={() => void decide(app.id, "approve")}>
                      Approve
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void decide(app.id, "reject")}>
                      Reject
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
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
          ))}
      </div>
    </div>
  );
}

export default Store;
