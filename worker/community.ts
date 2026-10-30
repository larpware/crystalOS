import type { Env } from "./env";
import { type Session } from "./accounts";
import { bodyAsJson, cleanText, fail, json } from "./http";
import { postgrest, supabaseConfig, SupabaseError } from "./supabase";

const HEAD = "/api/community";
const CATEGORIES = new Set(["productivity", "entertainment", "utilities", "games", "social", "education", "other"]);

function safeUrl(value: unknown): string | null {
  const raw = cleanText(value).trim();
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !/[\s<>"']/.test(raw) ? url.toString() : null;
  } catch { return null; }
}

function communityError(error: unknown): Response {
  if (error instanceof SupabaseError) {
    const match = /CA\d{3}/.exec(error.message);
    if (match) return fail(match[0] === "CA010" || match[0] === "CA012" ? 403 : 400, match[0], error.message);
    return fail(error.status || 500, error.code || "DB_ERROR", error.message);
  }
  return fail(500, "INTERNAL_ERROR", "Community apps could not be loaded.");
}

export async function handleCommunity(request: Request, env: Env, url: URL, session: Session | null): Promise<Response> {
  const config = session?.config ?? supabaseConfig(env);
  if (!config) return fail(503, "NOT_CONFIGURED", "The backend is missing its Supabase key.");
  const segments = url.pathname.slice(HEAD.length).split("/").filter(Boolean);
  const method = request.method.toUpperCase();
  const [head, id, action] = segments;
  if (!session && !(method === "GET" && (head === "apps" || head === "resolve"))) return fail(401, "NO_SESSION", "Sign in to continue.");
  const token = session?.token;
  const user = session as Session;

  try {
    if (head === "apps" && !id && method === "GET") {
      const { data } = await postgrest(config, "custom_apps", {
        params: { select: "id,name,description,website_url,icon_url,category,visibility,verification_status,install_count,created_at,developer_id", visibility: "eq.public", verification_status: "eq.verified", order: "created_at.desc", limit: "100" },
        token,
      });
      return json({ ok: true, apps: Array.isArray(data) ? data : [] });
    }
    if (head === "apps" && id && method === "GET") {
      const { data } = await postgrest(config, "rpc/community_app_resolve", { method: "POST", body: { p_identifier: id }, token });
      return json({ ok: true, app: data ?? null });
    }
    if (head === "mine" && method === "GET") {
      const { data } = await postgrest(config, "custom_apps", { params: { select: "*", developer_id: `eq.${user.userId}`, order: "created_at.desc" }, token: user.token });
      return json({ ok: true, apps: Array.isArray(data) ? data : [] });
    }
    if (head === "submit" && method === "POST") {
      const body = await bodyAsJson(request);
      const name = cleanText(body.name).trim();
      const description = cleanText(body.description).trim();
      const websiteUrl = safeUrl(body.website_url ?? body.url);
      const category = cleanText(body.category).trim().toLowerCase();
      const visibility = cleanText(body.visibility || "public").trim().toLowerCase();
      if (name.length < 2 || name.length > 80) return fail(400, "INVALID_NAME", "App names must be 2–80 characters.");
      if (description.length < 10 || description.length > 2000) return fail(400, "INVALID_DESCRIPTION", "Descriptions must be 10–2000 characters.");
      if (!websiteUrl) return fail(400, "HTTPS_REQUIRED", "The app URL must use HTTPS.");
      if (!CATEGORIES.has(category)) return fail(400, "INVALID_CATEGORY", "Choose a supported category.");
      if (!["public", "unlisted"].includes(visibility)) return fail(400, "INVALID_VISIBILITY", "Visibility must be public or unlisted.");
      const { data } = await postgrest(config, "rpc/community_app_submit", { method: "POST", body: { p_name: name, p_description: description, p_website_url: websiteUrl, p_icon_url: cleanText(body.icon_url || "") || null, p_category: category, p_visibility: visibility, p_moderator_notes: cleanText(body.moderator_notes || "").slice(0, 2000) }, token: user.token });
      return json({ ok: true, app: data }, { status: 201 });
    }
    if (head === "apps" && id && action === "install" && method === "POST") {
      const { data } = await postgrest(config, "rpc/community_app_install", { method: "POST", body: { p_app_id: id }, token: user.token });
      return json({ ok: true, installation: data });
    }
    if (head === "apps" && id && action === "install" && method === "DELETE") {
      const { data } = await postgrest(config, "rpc/community_app_uninstall", { method: "POST", body: { p_app_id: id }, token: user.token });
      return json({ ok: true, installation: data });
    }
    if (head === "installations" && method === "GET") {
      const { data } = await postgrest(config, "app_installations", { params: { select: "*,app:app_id(*)", user_id: `eq.${user.userId}` }, token: user.token });
      return json({ ok: true, installations: Array.isArray(data) ? data : [] });
    }
    if (head === "apps" && id && action === "reports" && method === "POST") {
      const body = await bodyAsJson(request);
      const category = cleanText(body.category).trim();
      if (!["malicious", "phishing", "misleading", "broken", "inappropriate", "copyright", "other"].includes(category)) return fail(400, "INVALID_REPORT_CATEGORY", "Choose a report category.");
      const { data } = await postgrest(config, "app_reports", { method: "POST", body: { app_id: id, reporter_id: user.userId, category, description: cleanText(body.description).slice(0, 2000) }, token: user.token });
      return json({ ok: true, report: Array.isArray(data) ? data[0] : data }, { status: 201 });
    }
    if (head === "moderation" && method === "GET") {
      if (user.profile.role !== "admin" && user.profile.role !== "moderator") return fail(403, "NOT_MODERATOR", "Moderator access is required.");
      const status = url.searchParams.get("status") || "pending";
      const { data } = await postgrest(config, "custom_apps", { params: { select: "*", verification_status: `eq.${status}`, order: "created_at.asc", limit: "200" }, token: user.token });
      return json({ ok: true, apps: Array.isArray(data) ? data : [] });
    }
    if (head === "moderation" && id && action && method === "POST") {
      if (user.profile.role !== "admin" && user.profile.role !== "moderator") return fail(403, "NOT_MODERATOR", "Moderator access is required.");
      const body = await bodyAsJson(request);
      const { data } = await postgrest(config, "rpc/community_app_decide", { method: "POST", body: { p_app_id: id, p_action: action, p_reason: cleanText(body.reason).slice(0, 2000) }, token: user.token });
      return json({ ok: true, app: data });
    }
    return fail(404, "ROUTE_NOT_FOUND", "Community route not found.");
  } catch (error) { return communityError(error); }
}
