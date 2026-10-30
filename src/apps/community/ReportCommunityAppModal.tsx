import { useState } from "react";
import { Button, Field, Modal, Select, Textarea } from "@/components/ui";
import { reportCommunityApp, type AppReport } from "@/services/communityApps";
import { notify } from "@/services/os";

interface ReportModalProps {
  appId: string;
  appName: string;
  open: boolean;
  onClose: () => void;
}

const REPORT_CATEGORIES: { value: AppReport["category"]; label: string }[] = [
  { value: "malicious", label: "Malicious or suspicious website" },
  { value: "phishing", label: "Phishing or impersonation" },
  { value: "misleading", label: "Misleading description" },
  { value: "broken", label: "Broken application" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "copyright", label: "Copyright or trademark concern" },
  { value: "other", label: "Other issue" },
];

export function ReportCommunityAppModal({ appId, appName, open, onClose }: ReportModalProps) {
  const [category, setCategory] = useState<AppReport["category"]>("malicious");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    const result = await reportCommunityApp(appId, category, description);
    setSubmitting(false);

    if (result.ok) {
      notify({
        title: "Report Submitted",
        body: `Thank you for reporting "${appName}". CrystalOS moderators will review it promptly.`,
      });
      onClose();
    } else {
      setError(result.error ?? "Failed to submit report.");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Report "${appName}"`}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", width: "100%" }}>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="danger" icon="warning" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Submitting..." : "Submit Report"}
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>
          Reports are reviewed manually by CrystalOS staff. False reports or abuse of the reporting
          system may result in account penalties.
        </p>

        {error && (
          <div
            style={{
              padding: "10px 12px",
              background: "color-mix(in srgb, var(--accent-danger) 15%, transparent)",
              border: "1px solid var(--accent-danger)",
              borderRadius: "6px",
              fontSize: "12px",
              color: "var(--text-primary)",
            }}
          >
            {error}
          </div>
        )}

        <Field label="Reason for report">
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value as AppReport["category"])}
            options={REPORT_CATEGORIES}
          />
        </Field>

        <Field label="Explanation & Evidence (optional)">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Please describe why this application should be reviewed..."
            rows={4}
            maxLength={1000}
          />
        </Field>
      </div>
    </Modal>
  );
}
