import { apiPath, apiRequest, type ApiResult } from "./api";

/* ==========================================================================
   Crystal Store — community submissions

   A submission proposes a web application (a URL plus its metadata) for the
   catalogue. Approval is a real moderation gate on the account server; an
   approved app opens in the CrystalOS Browser, so nothing uploaded ever
   executes here.
   ========================================================================== */

export type SubmissionStatus = "pending" | "under_review" | "changes_requested" | "verified" | "rejected" | "suspended";

export interface StoreSubmission {
  id: string;
  name: string;
  description: string;
  category: string;
  url: string;
  status: SubmissionStatus;
  reviewNote: string | null;
  createdAt: number;
  reviewedAt: number | null;
  submitter: { id: string; username: string | null; displayName: string | null };
}

export function approvedApps(): Promise<ApiResult<{ submissions: StoreSubmission[] }>> {
  return apiRequest<{ apps: any[] }>("/community/apps").then((result) => result.ok
    ? { ok: true, data: { submissions: result.data.apps.map(toSubmission) } }
    : result as ApiResult<{ submissions: StoreSubmission[] }>);
}

export function mySubmissions(): Promise<ApiResult<{ submissions: StoreSubmission[] }>> {
  return apiRequest<{ apps: any[] }>("/community/mine").then((result) => result.ok
    ? { ok: true, data: { submissions: result.data.apps.map(toSubmission) } }
    : result as ApiResult<{ submissions: StoreSubmission[] }>);
}

export function submitApp(input: {
  name: string;
  description: string;
  category: string;
  url: string;
}) {
  return apiRequest<{ app: any }>("/community/submit", {
    method: "POST",
    body: { ...input, website_url: input.url },
  }).then((result) => result.ok
    ? { ok: true as const, data: { submission: toSubmission(result.data.app) } }
    : result as ApiResult<{ submission: StoreSubmission }>);
}

export function adminQueue(status: SubmissionStatus = "pending") {
  return apiRequest<{ apps: any[] }>(
    `/community/moderation?status=${encodeURIComponent(status === "verified" ? "verified" : status)}`,
  ).then((result) => result.ok
    ? { ok: true, data: { submissions: result.data.apps.map(toSubmission), pendingCount: result.data.apps.filter((app: any) => app.verification_status === "pending").length } }
    : result as ApiResult<{ submissions: StoreSubmission[]; pendingCount: number }>);
}

export function reviewSubmission(id: string, action: "approve" | "reject", note: string | null) {
  return apiRequest<{ app: any }>(apiPath("community", "moderation", id, action === "approve" ? "approve" : "reject"), {
    method: "POST",
    body: { reason: note ?? "" },
  }).then((result) => result.ok
    ? { ok: true as const, data: { submission: toSubmission(result.data.app) } }
    : result as ApiResult<{ submission: StoreSubmission }>);
}

function toSubmission(app: any): StoreSubmission {
  return {
    id: String(app.id), name: String(app.name), description: String(app.description ?? ""),
    category: String(app.category ?? "other"), url: String(app.website_url ?? ""),
    status: app.verification_status, reviewNote: app.rejection_reason ?? app.suspension_reason ?? null,
    createdAt: Date.parse(app.created_at ?? "") || Date.now(), reviewedAt: Date.parse(app.last_reviewed_at ?? "") || null,
    submitter: { id: String(app.developer_id ?? ""), username: null, displayName: null },
  };
}
