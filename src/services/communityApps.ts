import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";
import { useAuthStore } from "@/state/auth";

/* ==========================================================================
   CrystalOS Community Apps Service
   Integrates user-submitted iframe applications with Supabase backend.
   ========================================================================== */

export type CommunityAppCategory =
  | "productivity"
  | "entertainment"
  | "utilities"
  | "games"
  | "social"
  | "education"
  | "other";

export const COMMUNITY_CATEGORIES: { id: CommunityAppCategory; label: string; icon: string }[] = [
  { id: "productivity", label: "Productivity", icon: "terminal" },
  { id: "entertainment", label: "Entertainment", icon: "media" },
  { id: "utilities", label: "Utilities", icon: "settings" },
  { id: "games", label: "Games", icon: "games" },
  { id: "social", label: "Social", icon: "messages" },
  { id: "education", label: "Education", icon: "notes" },
  { id: "other", label: "Other", icon: "grid" },
];

export type VerificationStatus =
  | "pending"
  | "under_review"
  | "changes_requested"
  | "verified"
  | "rejected"
  | "suspended";

export const VERIFICATION_STATUS_META: Record<
  VerificationStatus,
  { label: string; tone: "default" | "success" | "warning" | "danger"; hint: string }
> = {
  pending: {
    label: "Pending Review",
    tone: "default",
    hint: "Waiting for a moderator to review this application.",
  },
  under_review: {
    label: "Under Review",
    tone: "warning",
    hint: "A moderator is currently reviewing this application.",
  },
  changes_requested: {
    label: "Changes Requested",
    tone: "warning",
    hint: "Modifications requested before this app can be approved.",
  },
  verified: {
    label: "Verified",
    tone: "success",
    hint: "Manually verified by CrystalOS staff. Safe to install.",
  },
  rejected: {
    label: "Rejected",
    tone: "danger",
    hint: "Not approved for inclusion in CrystalOS.",
  },
  suspended: {
    label: "Suspended",
    tone: "danger",
    hint: "Previously verified but temporarily or permanently disabled.",
  },
};

export interface CommunityApp {
  id: string;
  developerId: string;
  developerUsername?: string;
  developerDisplayName?: string;
  developerAvatar?: string;
  name: string;
  description: string;
  websiteUrl: string;
  iconUrl?: string | null;
  category: CommunityAppCategory;
  visibility: "public" | "unlisted";
  verificationStatus: VerificationStatus;
  moderatorNotes?: string;
  rejectionReason?: string | null;
  suspensionReason?: string | null;
  changesRequestedReason?: string | null;
  shareToken?: string | null;
  installCount: number;
  createdAt: string;
  updatedAt: string;
  verifiedAt?: string | null;
  verifiedBy?: string | null;
}

export interface AppInstallation {
  id: string;
  appId: string;
  userId: string;
  installedAt: string;
}

export interface AppReport {
  id: string;
  appId: string;
  reporterId: string;
  category: "malicious" | "phishing" | "misleading" | "broken" | "inappropriate" | "copyright" | "other";
  description: string;
  status: "pending" | "investigating" | "resolved" | "dismissed";
  resolutionNote?: string | null;
  createdAt: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  app?: CommunityApp;
}

export interface AppModerationLog {
  id: number;
  appId: string;
  moderatorId: string | null;
  action: string;
  reason: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

export function isModerator(): boolean {
  const account = useAuthStore.getState().account;
  return account?.role === "admin" || String(account?.role) === "moderator";
}

/** Converts raw custom_apps db row into CommunityApp */
function toCommunityApp(row: Record<string, unknown>, profile?: Record<string, unknown>): CommunityApp {
  return {
    id: String(row.id),
    developerId: String(row.developer_id),
    developerUsername: profile?.username ? String(profile.username) : (row.developer_username ? String(row.developer_username) : undefined),
    developerDisplayName: profile?.display_name ? String(profile.display_name) : (row.developer_display_name ? String(row.developer_display_name) : undefined),
    developerAvatar: profile?.avatar_url ? String(profile.avatar_url) : (row.developer_avatar ? String(row.developer_avatar) : undefined),
    name: String(row.name),
    description: String(row.description),
    websiteUrl: String(row.website_url),
    iconUrl: row.icon_url ? String(row.icon_url) : null,
    category: (row.category as CommunityAppCategory) || "other",
    visibility: (row.visibility as "public" | "unlisted") || "public",
    verificationStatus: (row.verification_status as VerificationStatus) || "pending",
    moderatorNotes: row.moderator_notes ? String(row.moderator_notes) : undefined,
    rejectionReason: row.rejection_reason ? String(row.rejection_reason) : null,
    suspensionReason: row.suspension_reason ? String(row.suspension_reason) : null,
    changesRequestedReason: row.changes_requested_reason ? String(row.changes_requested_reason) : null,
    shareToken: row.share_token ? String(row.share_token) : null,
    installCount: Number(row.install_count ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
    verifiedAt: row.verified_at ? String(row.verified_at) : null,
    verifiedBy: row.verified_by ? String(row.verified_by) : null,
  };
}

/** Fetches verified public applications with optional category & search filter */
export async function fetchPublicCommunityApps(options?: {
  category?: CommunityAppCategory | "all";
  query?: string;
  sort?: "popular" | "recent";
}): Promise<CommunityApp[]> {
  if (!hasSupabaseConfig()) return [];
  try {
    const supabase = getSupabase();
    let query = supabase
      .from("custom_apps")
      .select("*, profiles:developer_id(username, display_name, avatar_url)")
      .eq("visibility", "public")
      .eq("verification_status", "verified");

    if (options?.category && options.category !== "all") {
      query = query.eq("category", options.category);
    }

    if (options?.sort === "popular") {
      query = query.order("install_count", { ascending: false });
    } else {
      query = query.order("created_at", { ascending: false });
    }

    const { data, error } = await query;
    if (error || !data) return [];

    let apps = data.map((row: any) => toCommunityApp(row, row.profiles));
    if (options?.query && options.query.trim()) {
      const q = options.query.trim().toLowerCase();
      apps = apps.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          (a.developerUsername && a.developerUsername.toLowerCase().includes(q)),
      );
    }
    return apps;
  } catch (err) {
    console.error("fetchPublicCommunityApps failed", err);
    return [];
  }
}

/** Resolves an application by ID or unlisted share token */
export async function resolveCommunityApp(identifier: string): Promise<CommunityApp | null> {
  if (!hasSupabaseConfig() || !identifier) return null;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("community_app_resolve", {
      p_identifier: identifier,
    });
    if (error || !data) return null;
    return toCommunityApp(data);
  } catch (err) {
    console.error("resolveCommunityApp failed", err);
    return null;
  }
}

/** Fetches apps submitted by the currently logged-in developer */
export async function fetchMySubmissions(): Promise<CommunityApp[]> {
  if (!hasSupabaseConfig()) return [];
  try {
    const supabase = getSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from("custom_apps")
      .select("*, profiles:developer_id(username, display_name, avatar_url)")
      .eq("developer_id", user.id)
      .order("created_at", { ascending: false });

    if (error || !data) return [];
    return data.map((row: any) => toCommunityApp(row, row.profiles));
  } catch (err) {
    console.error("fetchMySubmissions failed", err);
    return [];
  }
}

/** Submits a new community application for verification */
export async function submitCommunityApp(input: {
  name: string;
  description: string;
  websiteUrl: string;
  iconUrl?: string;
  category: CommunityAppCategory;
  visibility: "public" | "unlisted";
  moderatorNotes?: string;
}): Promise<{ ok: boolean; app?: CommunityApp; error?: string }> {
  if (!hasSupabaseConfig()) {
    return { ok: false, error: "Database backend not configured." };
  }

  // Client-side HTTPS validation
  const url = input.websiteUrl.trim();
  if (!/^https:\/\/[^\s/$.?#].[^\s]*$/i.test(url)) {
    return { ok: false, error: "Application URL must start with https:// and be a valid web address." };
  }

  if (input.name.trim().length < 2 || input.name.trim().length > 80) {
    return { ok: false, error: "Name must be between 2 and 80 characters." };
  }

  if (input.description.trim().length < 10 || input.description.trim().length > 2000) {
    return { ok: false, error: "Description must be between 10 and 2000 characters." };
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("community_app_submit", {
      p_name: input.name.trim(),
      p_description: input.description.trim(),
      p_website_url: url,
      p_icon_url: input.iconUrl?.trim() || null,
      p_category: input.category,
      p_visibility: input.visibility,
      p_moderator_notes: input.moderatorNotes?.trim() || "",
    });

    if (error || !data) {
      return { ok: false, error: error?.message ?? "Could not submit application." };
    }

    return { ok: true, app: toCommunityApp(data) };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Failed to submit application." };
  }
}

/** Updates metadata of an existing application */
export async function updateCommunityApp(
  appId: string,
  patch: {
    name?: string;
    description?: string;
    websiteUrl?: string;
    iconUrl?: string;
    category?: CommunityAppCategory;
    visibility?: "public" | "unlisted";
    moderatorNotes?: string;
  },
): Promise<{ ok: boolean; error?: string }> {
  if (!hasSupabaseConfig()) return { ok: false, error: "Not configured" };

  if (patch.websiteUrl && !/^https:\/\/[^\s/$.?#].[^\s]*$/i.test(patch.websiteUrl.trim())) {
    return { ok: false, error: "Website URL must be a valid https:// address." };
  }

  try {
    const supabase = getSupabase();
    const updatePayload: Record<string, unknown> = {};
    if (patch.name !== undefined) updatePayload.name = patch.name.trim();
    if (patch.description !== undefined) updatePayload.description = patch.description.trim();
    if (patch.websiteUrl !== undefined) updatePayload.website_url = patch.websiteUrl.trim();
    if (patch.iconUrl !== undefined) updatePayload.icon_url = patch.iconUrl.trim() || null;
    if (patch.category !== undefined) updatePayload.category = patch.category;
    if (patch.visibility !== undefined) updatePayload.visibility = patch.visibility;
    if (patch.moderatorNotes !== undefined) updatePayload.moderator_notes = patch.moderatorNotes.trim();

    const { error } = await supabase
      .from("custom_apps")
      .update(updatePayload)
      .eq("id", appId);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Update failed" };
  }
}

/** Installs a verified application for the current user */
export async function installCommunityApp(appId: string): Promise<{ ok: boolean; error?: string }> {
  if (!hasSupabaseConfig()) return { ok: false, error: "Backend unavailable" };
  try {
    const supabase = getSupabase();
    const { error } = await supabase.rpc("community_app_install", { p_app_id: appId });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Install failed" };
  }
}

/** Uninstalls a community application from the current user's profile */
export async function uninstallCommunityApp(appId: string): Promise<{ ok: boolean; error?: string }> {
  if (!hasSupabaseConfig()) return { ok: false, error: "Backend unavailable" };
  try {
    const supabase = getSupabase();
    const { error } = await supabase.rpc("community_app_uninstall", { p_app_id: appId });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Uninstall failed" };
  }
}

/** Fetches IDs of all community apps installed by current user */
export async function fetchUserInstalledAppIds(): Promise<string[]> {
  if (!hasSupabaseConfig()) return [];
  try {
    const supabase = getSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from("app_installations")
      .select("app_id")
      .eq("user_id", user.id);

    if (error || !data) return [];
    return data.map((row) => row.app_id);
  } catch {
    return [];
  }
}

/** Regenerates a secure share token for an unlisted app */
export async function regenerateShareToken(appId: string): Promise<{ ok: boolean; token?: string; error?: string }> {
  if (!hasSupabaseConfig()) return { ok: false, error: "Backend unavailable" };
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("community_app_regenerate_token", {
      p_app_id: appId,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, token: data };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Token generation failed" };
  }
}

/** Reports a community application */
export async function reportCommunityApp(
  appId: string,
  category: AppReport["category"],
  description: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!hasSupabaseConfig()) return { ok: false, error: "Backend unavailable" };
  try {
    const supabase = getSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to submit a report." };

    const { error } = await supabase.from("app_reports").insert({
      app_id: appId,
      reporter_id: user.id,
      category,
      description: description.trim(),
    });

    if (error) {
      if (error.code === "23505") {
        return { ok: false, error: "You already have a pending report for this application." };
      }
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Failed to submit report." };
  }
}

/** Uploads an icon to the community-app-icons storage bucket */
export async function uploadAppIcon(file: File): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!hasSupabaseConfig()) return { ok: false, error: "Backend unavailable" };

  const validTypes = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
  if (!validTypes.includes(file.type)) {
    return { ok: false, error: "Icons must be PNG, JPEG, WebP, or SVG." };
  }

  const maxBytes = 2 * 1024 * 1024; // 2MB
  if (file.size > maxBytes) {
    return { ok: false, error: "Icon file size must be under 2MB." };
  }

  try {
    const supabase = getSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to upload an icon." };

    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const safeExt = /^[a-z0-9]+$/i.test(ext) ? ext : "png";
    const filename = `${crypto.randomUUID()}.${safeExt}`;
    const path = `${user.id}/${filename}`;

    const { error: uploadError } = await supabase.storage
      .from("community-app-icons")
      .upload(path, file, { contentType: file.type, upsert: true });

    if (uploadError) return { ok: false, error: uploadError.message };

    const { data: publicUrlData } = supabase.storage
      .from("community-app-icons")
      .getPublicUrl(path);

    return { ok: true, url: publicUrlData.publicUrl };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Upload failed" };
  }
}

/* ---- Moderator Staff Operations ----------------------------------------- */

export async function fetchModerationQueue(status?: VerificationStatus | "all"): Promise<CommunityApp[]> {
  if (!hasSupabaseConfig() || !isModerator()) return [];
  try {
    const supabase = getSupabase();
    let query = supabase
      .from("custom_apps")
      .select("*, profiles:developer_id(username, display_name, avatar_url)");

    if (status && status !== "all") {
      query = query.eq("verification_status", status);
    }
    query = query.order("created_at", { ascending: false });

    const { data, error } = await query;
    if (error || !data) return [];
    return data.map((row: any) => toCommunityApp(row, row.profiles));
  } catch (err) {
    console.error("fetchModerationQueue error", err);
    return [];
  }
}

export async function decideCommunityApp(
  appId: string,
  action: "claim" | "approve" | "reject" | "request_changes" | "suspend" | "restore",
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!hasSupabaseConfig() || !isModerator()) {
    return { ok: false, error: "Unauthorized" };
  }
  try {
    const supabase = getSupabase();
    const { error } = await supabase.rpc("community_app_decide", {
      p_app_id: appId,
      p_action: action,
      p_reason: reason?.trim() || "",
    });

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Decision failed" };
  }
}

export async function fetchAllReports(status?: AppReport["status"] | "all"): Promise<AppReport[]> {
  if (!hasSupabaseConfig() || !isModerator()) return [];
  try {
    const supabase = getSupabase();
    let query = supabase
      .from("app_reports")
      .select("*, custom_apps(*)")
      .order("created_at", { ascending: false });

    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error || !data) return [];

    return data.map((row: any) => ({
      id: row.id,
      appId: row.app_id,
      reporterId: row.reporter_id,
      category: row.category,
      description: row.description,
      status: row.status,
      resolutionNote: row.resolution_note,
      createdAt: row.created_at,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at,
      app: row.custom_apps ? toCommunityApp(row.custom_apps) : undefined,
    }));
  } catch (err) {
    console.error("fetchAllReports error", err);
    return [];
  }
}

export async function resolveReport(
  reportId: string,
  resolution: "resolved" | "dismissed",
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!hasSupabaseConfig() || !isModerator()) return { ok: false, error: "Unauthorized" };
  try {
    const supabase = getSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase
      .from("app_reports")
      .update({
        status: resolution,
        resolution_note: note?.trim() || null,
        reviewed_by: user?.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", reportId);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Failed to resolve report" };
  }
}

export async function fetchAppModerationLogs(appId: string): Promise<AppModerationLog[]> {
  if (!hasSupabaseConfig() || !isModerator()) return [];
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("app_moderation_logs")
      .select("*")
      .eq("app_id", appId)
      .order("created_at", { ascending: false });

    if (error || !data) return [];
    return data.map((row: any) => ({
      id: row.id,
      appId: row.app_id,
      moderatorId: row.moderator_id,
      action: row.action,
      reason: row.reason,
      previousStatus: row.previous_status,
      newStatus: row.new_status,
      detail: row.detail ?? {},
      createdAt: row.created_at,
    }));
  } catch {
    return [];
  }
}
