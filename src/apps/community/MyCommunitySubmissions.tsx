import { useEffect, useState } from "react";
import { Badge, Button, EmptyState, Field, Modal, Select, Spinner, Textarea, TextInput } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import {
  COMMUNITY_CATEGORIES,
  fetchMySubmissions,
  updateCommunityApp,
  VERIFICATION_STATUS_META,
  type CommunityApp,
  type CommunityAppCategory,
} from "@/services/communityApps";
import { notify } from "@/services/os";
import { useAuthStore } from "@/state/auth";
import { CommunityAppDetailsModal } from "./CommunityAppDetailsModal";

export function MyCommunitySubmissions({ onOpenSubmit }: { onOpenSubmit: () => void }) {
  const account = useAuthStore((state) => state.account);
  const [apps, setApps] = useState<CommunityApp[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedApp, setSelectedApp] = useState<CommunityApp | null>(null);

  // Edit state
  const [editingApp, setEditingApp] = useState<CommunityApp | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editIcon, setEditIcon] = useState("");
  const [editCategory, setEditCategory] = useState<CommunityAppCategory>("productivity");
  const [editVisibility, setEditVisibility] = useState<"public" | "unlisted">("public");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const loadSubmissions = async () => {
    setLoading(true);
    const data = await fetchMySubmissions();
    setApps(data);
    setLoading(false);
  };

  useEffect(() => {
    void loadSubmissions();
  }, [account?.id]);

  const openEdit = (app: CommunityApp) => {
    setEditingApp(app);
    setEditName(app.name);
    setEditDesc(app.description);
    setEditUrl(app.websiteUrl);
    setEditIcon(app.iconUrl ?? "");
    setEditCategory(app.category);
    setEditVisibility(app.visibility);
    setEditError(null);
  };

  const handleSaveEdit = async () => {
    if (!editingApp) return;
    setEditError(null);

    const cleanUrl = editUrl.trim();
    if (!cleanUrl.startsWith("https://")) {
      setEditError("Website URL must start with https://");
      return;
    }

    const urlChanged = cleanUrl !== editingApp.websiteUrl;

    setEditSaving(true);
    const res = await updateCommunityApp(editingApp.id, {
      name: editName.trim(),
      description: editDesc.trim(),
      websiteUrl: cleanUrl,
      iconUrl: editIcon.trim() || undefined,
      category: editCategory,
      visibility: editVisibility,
    });
    setEditSaving(false);

    if (res.ok) {
      notify({
        title: "Application Updated",
        body: urlChanged
          ? "Website URL changed: application reverted to pending verification."
          : `Saved changes to "${editName}".`,
      });
      setEditingApp(null);
      void loadSubmissions();
    } else {
      setEditError(res.error ?? "Failed to save changes.");
    }
  };

  if (!account || account.guest) {
    return (
      <EmptyState
        icon="users"
        title="Sign in to Manage Applications"
        hint="Sign in to your CrystalOS account to submit and manage community apps."
      />
    );
  }

  if (loading) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center" }}>
        <Spinner label="Loading submissions" />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h3 style={{ margin: "0 0 4px 0", fontSize: "16px" }}>Developer Dashboard</h3>
          <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)" }}>
            Manage your submitted applications and monitor verification decisions.
          </p>
        </div>
        <Button variant="primary" icon="plus" onClick={onOpenSubmit}>
          Submit New App
        </Button>
      </div>

      {apps === null || apps.length === 0 ? (
        <EmptyState
          icon="grid"
          title="No Applications Submitted"
          hint="You haven't submitted any community applications yet. Submit your website to make it available in CrystalOS."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {apps.map((app) => {
            const statusMeta = VERIFICATION_STATUS_META[app.verificationStatus] ?? {
              label: app.verificationStatus,
              tone: "default" as const,
              hint: "",
            };

            return (
              <div
                key={app.id}
                style={{
                  padding: "16px",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "10px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
                  <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                    {app.iconUrl ? (
                      <img
                        src={app.iconUrl}
                        alt=""
                        style={{ width: "42px", height: "42px", borderRadius: "8px", objectFit: "contain", background: "var(--bg-surface)" }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "42px",
                          height: "42px",
                          borderRadius: "8px",
                          background: "var(--bg-surface)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Icon name="grid" size={22} />
                      </div>
                    )}
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <strong style={{ fontSize: "15px" }}>{app.name}</strong>
                        <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                        {app.visibility === "unlisted" && <Badge tone="warning">Unlisted</Badge>}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                        {app.websiteUrl} • Category: {app.category} • {app.installCount} installs
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "6px" }}>
                    <Button size="sm" variant="secondary" onClick={() => setSelectedApp(app)}>
                      Details
                    </Button>
                    <Button size="sm" variant="ghost" icon="pencil" onClick={() => openEdit(app)}>
                      Edit
                    </Button>
                  </div>
                </div>

                <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                  {app.description}
                </div>

                {/* Moderator feedback banners */}
                {app.verificationStatus === "changes_requested" && app.changesRequestedReason && (
                  <div
                    style={{
                      padding: "8px 12px",
                      background: "color-mix(in srgb, var(--accent-warning) 15%, transparent)",
                      border: "1px solid var(--accent-warning)",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                  >
                    <strong>Changes Requested by Moderator:</strong> {app.changesRequestedReason}
                  </div>
                )}

                {app.verificationStatus === "rejected" && app.rejectionReason && (
                  <div
                    style={{
                      padding: "8px 12px",
                      background: "color-mix(in srgb, var(--accent-danger) 15%, transparent)",
                      border: "1px solid var(--accent-danger)",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                  >
                    <strong>Rejection Reason:</strong> {app.rejectionReason}
                  </div>
                )}

                {app.verificationStatus === "suspended" && app.suspensionReason && (
                  <div
                    style={{
                      padding: "8px 12px",
                      background: "color-mix(in srgb, var(--accent-danger) 15%, transparent)",
                      border: "1px solid var(--accent-danger)",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                  >
                    <strong>Suspension Reason:</strong> {app.suspensionReason}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Edit modal */}
      {editingApp && (
        <Modal
          open={Boolean(editingApp)}
          onClose={() => setEditingApp(null)}
          title={`Edit "${editingApp.name}"`}
          width={540}
          footer={
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", width: "100%" }}>
              <Button variant="secondary" onClick={() => setEditingApp(null)} disabled={editSaving}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleSaveEdit} disabled={editSaving}>
                {editSaving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {editError && (
              <div
                style={{
                  padding: "8px 12px",
                  background: "color-mix(in srgb, var(--accent-danger) 15%, transparent)",
                  border: "1px solid var(--accent-danger)",
                  borderRadius: "6px",
                  fontSize: "12px",
                }}
              >
                {editError}
              </div>
            )}

            <div
              style={{
                padding: "8px 12px",
                background: "color-mix(in srgb, var(--accent-warning) 12%, transparent)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "6px",
                fontSize: "11px",
                color: "var(--text-muted)",
              }}
            >
              Note: If you change the Website URL, the application will automatically require new
              verification before it can be run.
            </div>

            <Field label="Application Name">
              <TextInput value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={80} />
            </Field>

            <Field label="Website URL (HTTPS)">
              <TextInput value={editUrl} onChange={(e) => setEditUrl(e.target.value)} />
            </Field>

            <Field label="Description">
              <Textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={3} maxLength={2000} />
            </Field>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <Field label="Category">
                <Select
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value as CommunityAppCategory)}
                  options={COMMUNITY_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))}
                />
              </Field>

              <Field label="Visibility">
                <Select
                  value={editVisibility}
                  onChange={(e) => setEditVisibility(e.target.value as "public" | "unlisted")}
                  options={[
                    { value: "public", label: "Public" },
                    { value: "unlisted", label: "Unlisted" },
                  ]}
                />
              </Field>
            </div>

            <Field label="Icon URL">
              <TextInput value={editIcon} onChange={(e) => setEditIcon(e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}

      {selectedApp && (
        <CommunityAppDetailsModal
          app={selectedApp}
          open={Boolean(selectedApp)}
          onClose={() => setSelectedApp(null)}
          onUpdate={loadSubmissions}
        />
      )}
    </div>
  );
}
