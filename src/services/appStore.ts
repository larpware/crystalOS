import { apiPath, apiRequest, type ApiResult } from "./api";

/* ==========================================================================
   Crystal Store — community submissions

   A submission proposes a web application (a URL plus its metadata) for the
   catalogue. Approval is a real moderation gate on the account server; an
   approved app opens in the CrystalOS Browser, so nothing uploaded ever
   executes here.
   ========================================================================== */

export type SubmissionStatus = "pending" | "approved" | "rejected";

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
  return apiRequest("/store/approved");
}

export function mySubmissions(): Promise<ApiResult<{ submissions: StoreSubmission[] }>> {
  return apiRequest("/store/mine");
}

export function submitApp(input: {
  name: string;
  description: string;
  category: string;
  url: string;
}) {
  return apiRequest<{ submission: StoreSubmission }>("/store/submit", {
    method: "POST",
    body: input,
  });
}

export function adminQueue(status: SubmissionStatus = "pending") {
  return apiRequest<{ submissions: StoreSubmission[]; pendingCount: number }>(
    `/store/admin?status=${encodeURIComponent(status)}`,
  );
}

export function reviewSubmission(id: string, action: "approve" | "reject", note: string | null) {
  return apiRequest<{ submission: StoreSubmission }>(apiPath("store", "admin", id, "review"), {
    method: "POST",
    body: { action, note },
  });
}
