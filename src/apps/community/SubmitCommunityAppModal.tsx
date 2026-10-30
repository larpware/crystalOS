import { useState } from "react";
import { Badge, Button, Field, Modal, Select, Textarea, TextInput } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import {
  COMMUNITY_CATEGORIES,
  submitCommunityApp,
  uploadAppIcon,
  type CommunityApp,
  type CommunityAppCategory,
} from "@/services/communityApps";
import { notify } from "@/services/os";
import { useAuthStore } from "@/state/auth";

interface SubmitModalProps {
  open: boolean;
  onClose: () => void;
  onSubmitted?: (app: CommunityApp) => void;
}

export function SubmitCommunityAppModal({ open, onClose, onSubmitted }: SubmitModalProps) {
  const account = useAuthStore((state) => state.account);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  const [category, setCategory] = useState<CommunityAppCategory>("productivity");
  const [visibility, setVisibility] = useState<"public" | "unlisted">("public");
  const [moderatorNotes, setModeratorNotes] = useState("");

  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedApp, setSubmittedApp] = useState<CommunityApp | null>(null);

  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingIcon(true);
    setError(null);
    const res = await uploadAppIcon(file);
    setUploadingIcon(false);
    if (res.ok && res.url) {
      setIconUrl(res.url);
      notify({ title: "Icon Uploaded", body: "Application icon uploaded successfully." });
    } else {
      setError(res.error ?? "Icon upload failed.");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    const cleanUrl = websiteUrl.trim();
    if (!cleanUrl.startsWith("https://")) {
      setError("Website URL must start with https:// — insecure or non-web schemes are forbidden.");
      return;
    }

    if (name.trim().length < 2 || name.trim().length > 80) {
      setError("Application name must be between 2 and 80 characters.");
      return;
    }

    if (description.trim().length < 10 || description.trim().length > 2000) {
      setError("Description must be between 10 and 2000 characters.");
      return;
    }

    setSubmitting(true);
    const res = await submitCommunityApp({
      name: name.trim(),
      description: description.trim(),
      websiteUrl: cleanUrl,
      iconUrl: iconUrl.trim() || undefined,
      category,
      visibility,
      moderatorNotes: moderatorNotes.trim() || undefined,
    });
    setSubmitting(false);

    if (res.ok && res.app) {
      setSubmittedApp(res.app);
      onSubmitted?.(res.app);
    } else {
      setError(res.error ?? "Failed to submit application.");
    }
  };

  const handleClose = () => {
    setName("");
    setDescription("");
    setWebsiteUrl("");
    setIconUrl("");
    setCategory("productivity");
    setVisibility("public");
    setModeratorNotes("");
    setError(null);
    setSubmittedApp(null);
    onClose();
  };

  // If already submitted, show confirmation screen
  if (submittedApp) {
    return (
      <Modal open={open} onClose={handleClose} title="Application Submitted" width={520}>
        <div style={{ textAlign: "center", padding: "16px 8px" }}>
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "50%",
              background: "color-mix(in srgb, var(--accent-primary) 15%, transparent)",
              color: "var(--accent-primary)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "16px",
            }}
          >
            <Icon name="check" size={30} />
          </div>

          <h3 style={{ margin: "0 0 8px 0", fontSize: "18px" }}>Submitted for Verification</h3>
          <p style={{ color: "var(--text-secondary)", fontSize: "13px", lineHeight: "1.5", maxWidth: "420px", margin: "0 auto 20px auto" }}>
            <strong>{submittedApp.name}</strong> has been added to the moderation queue with status{" "}
            <Badge tone="default">Pending Verification</Badge>.
          </p>

          <div
            style={{
              padding: "14px",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "8px",
              textAlign: "left",
              fontSize: "12px",
              color: "var(--text-muted)",
              lineHeight: "1.5",
              marginBottom: "20px",
            }}
          >
            <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>
              What happens next:
            </div>
            1. CrystalOS staff manually inspect the website, iframe compatibility, and safety.<br />
            2. Once approved, the application will become installable and discoverable.<br />
            3. You will receive a notification in CrystalOS when a decision is recorded.
          </div>

          <Button variant="primary" onClick={handleClose}>
            Done
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Submit Community Application"
      width={560}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", width: "100%" }}>
          <Button variant="secondary" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" icon="upload" onClick={handleSubmit as any} disabled={submitting}>
            {submitting ? "Submitting..." : "Submit for Verification"}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
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

        <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
          Submitting as{" "}
          <strong style={{ color: "var(--text-primary)" }}>
            {account?.displayName || account?.username || "Guest User"}
          </strong>
          . All submissions require manual verification before they can be installed.
        </div>

        <Field label="Application Name" hint="2 to 80 characters">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Retro Calculator"
            maxLength={80}
            required
          />
        </Field>

        <Field label="Website URL (HTTPS Only)" hint="Must begin with https:// and support iframe embedding">
          <TextInput
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://yourapp.example.com"
            required
          />
        </Field>

        <Field label="Short Description" hint="Explain what your app does (10 to 2000 characters)">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe features, purpose, and usage..."
            rows={3}
            maxLength={2000}
            required
          />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <Field label="Category">
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value as CommunityAppCategory)}
              options={COMMUNITY_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))}
            />
          </Field>

          <Field label="Visibility">
            <Select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as "public" | "unlisted")}
              options={[
                { value: "public", label: "Public (Listed in Gallery)" },
                { value: "unlisted", label: "Unlisted (Direct Link Only)" },
              ]}
            />
          </Field>
        </div>

        <Field label="Application Icon (Optional)" hint="Image URL or upload PNG/JPG/WebP/SVG (max 2MB)">
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <TextInput
              value={iconUrl}
              onChange={(e) => setIconUrl(e.target.value)}
              placeholder="https://.../icon.png"
              style={{ flex: 1 }}
            />
            <label className="cr-btn cr-btn--secondary" style={{ cursor: "pointer", whiteSpace: "nowrap" }}>
              <Icon name="upload" size={14} />
              <span>{uploadingIcon ? "Uploading..." : "Upload Icon"}</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                style={{ display: "none" }}
                onChange={handleIconUpload}
                disabled={uploadingIcon}
              />
            </label>
          </div>
        </Field>

        <Field label="Notes for Moderators (Optional)" hint="Any instructions, test accounts, or context for review">
          <TextInput
            value={moderatorNotes}
            onChange={(e) => setModeratorNotes(e.target.value)}
            placeholder="e.g. Free sandbox mode enabled, no login required"
            maxLength={500}
          />
        </Field>
      </form>
    </Modal>
  );
}
