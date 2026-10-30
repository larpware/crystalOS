import { useEffect, useState } from "react";
import { Badge, Button, EmptyState, Field, Modal, Segmented, Spinner, Textarea } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import {
  decideCommunityApp,
  fetchAllReports,
  fetchAppModerationLogs,
  fetchModerationQueue,
  isModerator,
  resolveReport,
  VERIFICATION_STATUS_META,
  type AppModerationLog,
  type AppReport,
  type CommunityApp,
} from "@/services/communityApps";
import { notify } from "@/services/os";
import { CommunityAppDetailsModal } from "./CommunityAppDetailsModal";

type ModTab =
  | "pending"
  | "under_review"
  | "verified"
  | "changes_requested"
  | "rejected"
  | "suspended"
  | "reports"
  | "unlisted";

export function CommunityModerationDashboard() {
  const [tab, setTab] = useState<ModTab>("pending");
  const [apps, setApps] = useState<CommunityApp[] | null>(null);
  const [reports, setReports] = useState<AppReport[] | null>(null);
  const [loading, setLoading] = useState(true);

  // Detail / Preview modals
  const [selectedApp, setSelectedApp] = useState<CommunityApp | null>(null);
  const [previewApp, setPreviewApp] = useState<CommunityApp | null>(null);
  const [auditLogs, setAuditLogs] = useState<AppModerationLog[] | null>(null);
  const [viewingLogsApp, setViewingLogsApp] = useState<CommunityApp | null>(null);

  // Decision action modal
  const [actionModal, setActionModal] = useState<{
    app: CommunityApp;
    action: "claim" | "approve" | "reject" | "request_changes" | "suspend" | "restore";
    title: string;
  } | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Report resolution modal
  const [resolvingReport, setResolvingReport] = useState<AppReport | null>(null);
  const [reportNote, setReportNote] = useState("");

  const authorized = isModerator();

  const loadData = async () => {
    if (!authorized) return;
    setLoading(true);
    if (tab === "reports") {
      const data = await fetchAllReports();
      setReports(data);
    } else {
      const data = await fetchModerationQueue();
      setApps(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadData();
  }, [tab, authorized]);

  const openAction = (
    app: CommunityApp,
    action: "claim" | "approve" | "reject" | "request_changes" | "suspend" | "restore",
    title: string,
  ) => {
    setActionModal({ app, action, title });
    setActionReason("");
    setActionError(null);
  };

  const handleExecuteAction = async () => {
    if (!actionModal) return;
    setActionError(null);

    // Enforce required reasons for rejection/changes/suspension
    if (["reject", "request_changes", "suspend"].includes(actionModal.action) && actionReason.trim().length < 3) {
      setActionError("A detailed explanation is required for this moderation action.");
      return;
    }

    setActionBusy(true);
    const res = await decideCommunityApp(actionModal.app.id, actionModal.action, actionReason.trim());
    setActionBusy(false);

    if (res.ok) {
      notify({
        title: "Moderation Action Recorded",
        body: `Successfully executed "${actionModal.title}" for ${actionModal.app.name}.`,
      });
      setActionModal(null);
      void loadData();
    } else {
      setActionError(res.error ?? "Action execution failed.");
    }
  };

  const handleResolveReport = async (resolution: "resolved" | "dismissed") => {
    if (!resolvingReport) return;
    setActionBusy(true);
    const res = await resolveReport(resolvingReport.id, resolution, reportNote);
    setActionBusy(false);

    if (res.ok) {
      notify({ title: "Report Handled", body: `Report marked as ${resolution}.` });
      setResolvingReport(null);
      setReportNote("");
      void loadData();
    } else {
      notify({ title: "Error", body: res.error ?? "Failed to update report." });
    }
  };

  const handleViewLogs = async (app: CommunityApp) => {
    setViewingLogsApp(app);
    const logs = await fetchAppModerationLogs(app.id);
    setAuditLogs(logs);
  };

  if (!authorized) {
    return (
      <EmptyState
        icon="shield"
        title="Moderator Access Required"
        hint="This section is restricted to CrystalOS staff and moderators."
      />
    );
  }

  // Filter queue by current tab
  const filteredApps = (apps ?? []).filter((a) => {
    if (tab === "unlisted") return a.visibility === "unlisted";
    return a.verificationStatus === tab;
  });

  const pendingCount = (apps ?? []).filter((a) => a.verificationStatus === "pending").length;
  const reportsCount = (reports ?? []).filter((r) => r.status === "pending").length;

  const tabOptions = [
    { value: "pending" as ModTab, label: `Pending (${pendingCount})` },
    { value: "under_review" as ModTab, label: "Under Review" },
    { value: "verified" as ModTab, label: "Verified" },
    { value: "changes_requested" as ModTab, label: "Changes Req." },
    { value: "rejected" as ModTab, label: "Rejected" },
    { value: "suspended" as ModTab, label: "Suspended" },
    { value: "unlisted" as ModTab, label: "Unlisted" },
    { value: "reports" as ModTab, label: `Reports (${reportsCount})` },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <h3 style={{ margin: "0 0 4px 0", fontSize: "16px" }}>Staff Moderation Portal</h3>
          <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)" }}>
            Review, verify, and moderate community web application submissions.
          </p>
        </div>
        <Button size="sm" variant="secondary" icon="restart" onClick={loadData} disabled={loading}>
          Refresh
        </Button>
      </div>

      <Segmented
        label="Moderation Tabs"
        value={tab}
        onChange={(v) => setTab(v as ModTab)}
        options={tabOptions}
      />

      {loading ? (
        <div style={{ padding: "40px 0", textAlign: "center" }}>
          <Spinner label="Loading moderation queue" />
        </div>
      ) : tab === "reports" ? (
        /* Reports view */
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {reports === null || reports.length === 0 ? (
            <EmptyState icon="check" title="No Pending Reports" hint="All reported applications have been reviewed." />
          ) : (
            reports.map((report) => (
              <div
                key={report.id}
                style={{
                  padding: "14px 16px",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "8px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Badge tone="danger">{report.category.toUpperCase()}</Badge>
                    <strong>{report.app?.name ?? "Application"}</strong>
                    <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                      Reported on {new Date(report.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    {report.app && (
                      <Button size="sm" variant="secondary" onClick={() => setSelectedApp(report.app!)}>
                        Inspect App
                      </Button>
                    )}
                    <Button size="sm" variant="primary" onClick={() => setResolvingReport(report)}>
                      Review Report
                    </Button>
                  </div>
                </div>
                <div style={{ fontSize: "12px", color: "var(--text-secondary)", background: "var(--bg-surface)", padding: "8px 12px", borderRadius: "6px" }}>
                  {report.description || "No written explanation provided."}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        /* Applications view */
        <div className="cr-comm-mod-queue">
          {filteredApps.length === 0 ? (
            <EmptyState
              icon="check"
              title="Queue Empty"
              hint={`No applications in "${tab.replace("_", " ")}" section.`}
            />
          ) : (
            filteredApps.map((app) => (
              <div key={app.id} className="cr-comm-mod-item">
                <div className="cr-comm-mod-item__info">
                  {app.iconUrl ? (
                    <img src={app.iconUrl} alt="" style={{ width: "38px", height: "38px", borderRadius: "8px", objectFit: "contain" }} />
                  ) : (
                    <div style={{ width: "38px", height: "38px", borderRadius: "8px", background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon name="grid" size={20} />
                    </div>
                  )}

                  <div className="cr-comm-mod-item__details">
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span className="cr-comm-mod-item__name">{app.name}</span>
                      <Badge tone={VERIFICATION_STATUS_META[app.verificationStatus]?.tone ?? "default"}>
                        {app.verificationStatus}
                      </Badge>
                      {app.visibility === "unlisted" && <Badge tone="warning">Unlisted</Badge>}
                    </div>
                    <div className="cr-comm-mod-item__meta">
                      <span>Dev: {app.developerDisplayName || app.developerUsername || "unknown"}</span>
                      <span>•</span>
                      <span>{app.websiteUrl}</span>
                      <span>•</span>
                      <span>{app.category}</span>
                    </div>
                  </div>
                </div>

                <div className="cr-comm-mod-item__actions">
                  <Button size="sm" variant="ghost" icon="external" onClick={() => setPreviewApp(app)}>
                    Preview
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setSelectedApp(app)}>
                    Details
                  </Button>
                  <Button size="sm" variant="ghost" icon="info" onClick={() => handleViewLogs(app)}>
                    History
                  </Button>

                  {/* Contextual Moderator Decisions */}
                  {app.verificationStatus === "pending" && (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => openAction(app, "claim", "Claim Review")}>
                        Claim
                      </Button>
                      <Button size="sm" variant="primary" icon="check" onClick={() => openAction(app, "approve", "Approve Application")}>
                        Approve
                      </Button>
                      <Button size="sm" variant="danger" icon="close" onClick={() => openAction(app, "reject", "Reject Application")}>
                        Reject
                      </Button>
                    </>
                  )}

                  {app.verificationStatus === "under_review" && (
                    <>
                      <Button size="sm" variant="primary" icon="check" onClick={() => openAction(app, "approve", "Approve Application")}>
                        Approve
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => openAction(app, "request_changes", "Request Changes")}>
                        Req. Changes
                      </Button>
                      <Button size="sm" variant="danger" icon="close" onClick={() => openAction(app, "reject", "Reject Application")}>
                        Reject
                      </Button>
                    </>
                  )}

                  {app.verificationStatus === "verified" && (
                    <Button size="sm" variant="danger" icon="warning" onClick={() => openAction(app, "suspend", "Suspend Application")}>
                      Suspend
                    </Button>
                  )}

                  {app.verificationStatus === "suspended" && (
                    <Button size="sm" variant="primary" icon="restart" onClick={() => openAction(app, "restore", "Restore Application")}>
                      Restore
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Decision Action Modal */}
      {actionModal && (
        <Modal
          open={Boolean(actionModal)}
          onClose={() => setActionModal(null)}
          title={`${actionModal.title}: ${actionModal.app.name}`}
          footer={
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", width: "100%" }}>
              <Button variant="secondary" onClick={() => setActionModal(null)} disabled={actionBusy}>
                Cancel
              </Button>
              <Button
                variant={["reject", "suspend"].includes(actionModal.action) ? "danger" : "primary"}
                onClick={handleExecuteAction}
                disabled={actionBusy}
              >
                {actionBusy ? "Saving..." : "Confirm Decision"}
              </Button>
            </div>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {actionError && (
              <div
                style={{
                  padding: "8px 12px",
                  background: "color-mix(in srgb, var(--accent-danger) 15%, transparent)",
                  border: "1px solid var(--accent-danger)",
                  borderRadius: "6px",
                  fontSize: "12px",
                }}
              >
                {actionError}
              </div>
            )}

            <div style={{ fontSize: "13px" }}>
              Target App: <strong>{actionModal.app.name}</strong> ({actionModal.app.websiteUrl})
            </div>

            {["reject", "request_changes", "suspend"].includes(actionModal.action) && (
              <Field label="Explanation & Feedback (Required)">
                <Textarea
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  placeholder="Provide explicit reasons for this decision..."
                  rows={4}
                  required
                />
              </Field>
            )}

            {actionModal.action === "approve" && (
              <div
                style={{
                  padding: "10px",
                  background: "color-mix(in srgb, var(--accent-success) 12%, transparent)",
                  borderRadius: "6px",
                  fontSize: "12px",
                }}
              >
                Approving this application will make it installable by CrystalOS users.
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Safe Preview Modal */}
      {previewApp && (
        <Modal
          open={Boolean(previewApp)}
          onClose={() => setPreviewApp(null)}
          title={`Safe Preview: ${previewApp.name}`}
          width={800}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ fontSize: "11px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "6px" }}>
              <Icon name="shield" size={13} />
              <span>Strictly sandboxed inspection preview. External links and parent access disabled.</span>
            </div>
            <div style={{ width: "100%", height: "480px", borderRadius: "8px", overflow: "hidden", border: "1px solid var(--border-default)" }}>
              <iframe
                src={previewApp.websiteUrl}
                title="Preview"
                style={{ width: "100%", height: "100%", border: "none", background: "#fff" }}
                sandbox="allow-scripts allow-forms"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Audit Log Modal */}
      {viewingLogsApp && (
        <Modal
          open={Boolean(viewingLogsApp)}
          onClose={() => setViewingLogsApp(null)}
          title={`Moderation History: ${viewingLogsApp.name}`}
          width={560}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "400px", overflowY: "auto" }}>
            {auditLogs === null ? (
              <Spinner label="Loading history" />
            ) : auditLogs.length === 0 ? (
              <div style={{ fontSize: "12px", color: "var(--text-muted)", textAlign: "center", padding: "20px" }}>
                No moderation logs recorded for this app yet.
              </div>
            ) : (
              auditLogs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    padding: "10px 12px",
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "6px",
                    fontSize: "12px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                    <strong style={{ textTransform: "capitalize" }}>{log.action.replace("_", " ")}</strong>
                    <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {log.reason && (
                    <div style={{ color: "var(--text-secondary)", marginTop: "2px" }}>
                      Note: {log.reason}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </Modal>
      )}

      {/* Report Resolution Modal */}
      {resolvingReport && (
        <Modal
          open={Boolean(resolvingReport)}
          onClose={() => setResolvingReport(null)}
          title="Resolve Safety Report"
          width={480}
          footer={
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", width: "100%" }}>
              <Button variant="secondary" onClick={() => setResolvingReport(null)} disabled={actionBusy}>
                Cancel
              </Button>
              <Button variant="ghost" onClick={() => handleResolveReport("dismissed")} disabled={actionBusy}>
                Dismiss Report
              </Button>
              <Button variant="danger" onClick={() => handleResolveReport("resolved")} disabled={actionBusy}>
                Resolve & Close
              </Button>
            </div>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <Field label="Resolution Note (Optional)">
              <Textarea
                value={reportNote}
                onChange={(e) => setReportNote(e.target.value)}
                placeholder="Reason for dismissal or action taken..."
                rows={3}
              />
            </Field>
          </div>
        </Modal>
      )}

      {selectedApp && (
        <CommunityAppDetailsModal
          app={selectedApp}
          open={Boolean(selectedApp)}
          onClose={() => setSelectedApp(null)}
          onUpdate={loadData}
        />
      )}
    </div>
  );
}
