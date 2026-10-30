/* ==========================================================================
   CrystalOS Game Ownership Verification

   Routes under /api/accounts/verification/*. Three access tiers:

     1. User routes (session required, RLS-scoped) — generate/regen/revoke
        linking codes, list my tickets, list my ownerships, cancel my ticket.

     2. Bot routes (VERIFICATION_BOT_SECRET auth) — call the six SECURITY
        DEFINER RPCs (verification_link_account, verification_open_ticket,
        verification_select_game, verification_submit_evidence,
        verification_decide, verification_cancel_ticket) using the
        SUPABASE_SERVICE_KEY so they bypass RLS but NOT the business rules
        inside Postgres.

     3. Admin routes (profile.role === "admin") — manage restricted_games,
        verification_staff, list all tickets/events.

   SQLSTATE V10xx codes raised by the functions are mapped to HTTP statuses
   and friendly error codes here.
   ========================================================================== */

import type { Env } from "./env";
import { postgrest, supabaseConfig, SupabaseError, type SupabaseConfig } from "./supabase";
import { bodyAsJson, cleanText, fail, json } from "./http";
import { type Session } from "./accounts";

/* ---- Constants ----------------------------------------------------------- */

const LINK_CODE_BYTES = 24; // 48 hex chars, well above 8-char minimum in SQL
const LINK_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/* ---- SQLSTATE-to-HTTP mapping ------------------------------------------- */

const V_ERRORS: Record<string, { status: number; code: string }> = {
  V1001: { status: 404, code: "LINK_CODE_INVALID" },
  V1002: { status: 410, code: "LINK_CODE_EXPIRED" },
  V1003: { status: 410, code: "LINK_CODE_USED" },
  V1005: { status: 409, code: "DUPLICATE_ACTIVE_TICKET" },
  V1006: { status: 403, code: "NOT_STAFF" },
  V1007: { status: 403, code: "STAFF_REVOKED" },
  V1008: { status: 403, code: "SELF_VERIFICATION" },
  V1009: { status: 404, code: "TICKET_NOT_FOUND" },
  V1010: { status: 400, code: "GAME_REQUIRED" },
  V1011: { status: 400, code: "YAPIN_ID_REQUIRED" },
  V1012: { status: 404, code: "NO_LINKED_ACCOUNT" },
  V1013: { status: 409, code: "ACCOUNT_ALREADY_LINKED" },
  V1014: { status: 400, code: "EVIDENCE_REQUIRED" },
  V1015: { status: 400, code: "DECISION_INVALID" },
  V1016: { status: 409, code: "ALREADY_PROCESSED" },
  V1017: { status: 403, code: "NOT_TICKET_OWNER" },
  V1018: { status: 409, code: "YAPIN_ALREADY_LINKED" },
  V1019: { status: 404, code: "ACCOUNT_NOT_LINKED" },
  V1020: { status: 400, code: "ACTOR_REQUIRED" },
  V1021: { status: 409, code: "TICKET_NOT_DECIDABLE" },
};

function sqlstateError(error: unknown): { status: number; code: string; message: string } | null {
  if (!(error instanceof SupabaseError)) return null;
  // PostgREST wraps SQLSTATE in the error message: `"V1001"` somewhere.
  const match = /"?(V10\d\d)"?/.exec(error.message);
  if (!match) return null;
  const mapping = V_ERRORS[match[1]];
  if (!mapping) return null;
  return { ...mapping, message: error.message };
}

/* ---- Helpers ------------------------------------------------------------- */

/** Generate a cryptographically random hex code. */
function generateCode(): string {
  const bytes = new Uint8Array(LINK_CODE_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/** Call a SECURITY DEFINER function with the service role key. */
async function callRpc(
  config: SupabaseConfig,
  env: Env,
  fnName: string,
  params: Record<string, unknown>,
): Promise<{ data: unknown; status: number }> {
  const sk = env.SUPABASE_SERVICE_KEY;
  if (!sk || sk.length < 20) {
    return { data: { ok: false, error: { code: "NOT_CONFIGURED", message: "Service key is not configured." } }, status: 503 };
  }
  const response = await fetch(`${config.url}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      apikey: config.key,
      authorization: `Bearer ${sk}`,
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(10_000),
  });

  let data: unknown = null;
  const text = await response.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  // PostgREST returns 200 with a JSON body on success. Non-JSON bodies or
  // error shapes from the function still carry a 200 status in PostgREST.
  // Only a non-200 status here is a PostgREST-level error (bad args, bad key).
  if (!response.ok) {
    const message = typeof data === "object" && data !== null && "message" in (data as Record<string, unknown>)
      ? String((data as Record<string, unknown>).message)
      : `RPC ${fnName} failed with status ${response.status}`;
    return { data: { ok: false, error: { code: "RPC_ERROR", message } }, status: response.status };
  }

  return { data, status: response.status };
}

/** Authenticate a bot request: the Authorization header must be `Bearer <secret>`. */
function requireBot(request: Request, env: Env): Response | null {
  const auth = request.headers.get("authorization") ?? "";
  const expected = env.VERIFICATION_BOT_SECRET;
  if (!expected || expected.length < 8) {
    return fail(503, "NOT_CONFIGURED", "The bot secret is not configured.");
  }
  // Constant-time-ish check to avoid timing hints.
  const actual = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (actual.length !== expected.length) return fail(401, "UNAUTHORIZED", "Invalid bot credentials.");
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) return fail(401, "UNAUTHORIZED", "Invalid bot credentials.");
  return null;
}

/* ==========================================================================
   Route handler
   ========================================================================== */

const VERIFICATION_ROUTE = "/api/accounts/verification";

export async function handleVerification(
  request: Request,
  env: Env,
  url: URL,
  /** Null only for the bot routes, which authenticate with a shared secret. */
  session: Session | null,
): Promise<Response> {
  const method = request.method.toUpperCase();
  const path = url.pathname.slice(VERIFICATION_ROUTE.length).split("/").filter(Boolean);
  const config = supabaseConfig(env);
  if (!config) return fail(503, "NOT_CONFIGURED", "The backend is missing its Supabase key.");

  /* ---- Bot routes (authenticated by bot secret, not session) ------------ */
  if (path[0] === "bot") {
    const botErr = requireBot(request, env);
    if (botErr) return botErr;
    return handleBotRoutes(request, env, config, path.slice(1));
  }

  /* Every remaining branch resolves a person from a verified session, so the
     absence of one is a refusal rather than a fall-through. */
  if (!session) return fail(401, "NO_SESSION", "Sign in to continue.");

  /* ---- Admin routes ---------------------------------------------------- */
  if (path[0] === "admin") {
    if (session.profile.role !== "admin") {
      return fail(403, "NOT_ADMIN", "Only administrators can access verification admin routes.");
    }
    return handleAdminRoutes(request, env, config, session, path.slice(1), url);
  }

  /* ---- User routes ----------------------------------------------------- */
  return handleUserRoutes(request, env, config, session, path, method, url);
}

/* ==========================================================================
   User routes
   ========================================================================== */

async function handleUserRoutes(
  _request: Request,
  _env: Env,
  config: SupabaseConfig,
  session: Session,
  path: string[],
  method: string,
  requestUrl: URL,
): Promise<Response> {
  const head = path[0];

  // GET /api/accounts/verification/link-code
  // Returns the current active (unused, unexpired) link code, or null.
  if (head === "link-code" && method === "GET") {
    const { data } = await postgrest(config, "verification_link_codes", {
      params: {
        select: "code,created_at,expires_at,used_at,consumed_by",
        user_id: `eq.${session.userId}`,
        used_at: "is.null",
        expires_at: `gt.${new Date().toISOString()}`,
        order: "created_at.desc",
        limit: "1",
      },
      token: session.token,
    });
    const codes = Array.isArray(data) ? data : [];
    const active = codes[0] ?? null;
    // Mask the code — never send the full value back on a GET.
    return json({ ok: true, linkCode: active ? { ...active, code: active.code.slice(0, 8) + "…" } : null });
  }

  // POST /api/accounts/verification/link-code (regenerate)
  if (head === "link-code" && method === "POST") {
    // Revoke any existing unused codes for this user.
    await postgrest(config, "verification_link_codes", {
      method: "DELETE",
      params: { user_id: `eq.${session.userId}`, used_at: "is.null" },
      token: session.token,
    });

    const code = generateCode();
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS).toISOString();

    try {
      await postgrest(config, "verification_link_codes", {
        method: "POST",
        body: { code, user_id: session.userId, expires_at: expiresAt },
        token: session.token,
      });
    } catch (error) {
      if (error instanceof SupabaseError) {
        if (error.message.includes("unique constraint")) {
          // Collision is astronomically unlikely, but handle gracefully.
          return fail(500, "GENERATION_FAILED", "Could not generate a unique code. Try again.");
        }
        return fail(503, "DB_ERROR", error.message);
      }
      throw error;
    }

    return json({ ok: true, linkCode: { code, expiresAt }, status: 201 });
  }

  // DELETE /api/accounts/verification/link-code (revoke active)
  if (head === "link-code" && method === "DELETE") {
    await postgrest(config, "verification_link_codes", {
      method: "DELETE",
      params: { user_id: `eq.${session.userId}`, used_at: "is.null" },
      token: session.token,
    });
    return json({ ok: true });
  }

  // GET /api/accounts/verification/tickets
  if (head === "tickets" && method === "GET" && !path[1]) {
    const { data } = await postgrest(config, "verification_tickets", {
      params: {
        select: "*",
        user_id: `eq.${session.userId}`,
        order: "created_at.desc",
      },
      token: session.token,
    });
    const tickets = Array.isArray(data) ? data : [];
    return json({ ok: true, tickets });
  }

  // POST /api/accounts/verification/tickets/:id/cancel
  if (head === "tickets" && path[2] === "cancel" && method === "POST") {
    const ticketId = path[1];
    if (!ticketId) return fail(400, "TICKET_ID_REQUIRED", "Ticket id is required.");

    try {
      const { data } = await postgrest(config, "verification_tickets", {
        method: "PATCH",
        params: { id: `eq.${ticketId}`, user_id: `eq.${session.userId}` },
        body: { status: "cancelled" },
        token: session.token,
      });
      return json({ ok: true, ticket: Array.isArray(data) ? data[0] : data });
    } catch (error) {
      const mapped = sqlstateError(error);
      if (mapped) return fail(mapped.status, mapped.code, mapped.message);
      const supabaseErr = error as SupabaseError;
      return fail(supabaseErr.status ?? 500, supabaseErr.code ?? "DB_ERROR", supabaseErr.message);
    }
  }

  // GET /api/accounts/verification/ownerships
  if (head === "ownerships" && method === "GET") {
    const { data } = await postgrest(config, "game_ownerships", {
      params: {
        select: "*",
        user_id: `eq.${session.userId}`,
        order: "granted_at.desc",
      },
      token: session.token,
    });
    const rows = Array.isArray(data) ? data : [];
    return json({ ok: true, ownerships: rows });
  }

  // GET /api/accounts/verification/restricted
  if (head === "restricted" && method === "GET") {
    const { data } = await postgrest(config, "restricted_games", {
      params: { select: "*", order: "game_id.asc" },
      token: session.token,
    });
    const rows = Array.isArray(data) ? data : [];
    return json({ ok: true, restricted: rows });
  }

  return fail(404, "ROUTE_NOT_FOUND", `There is no ${method} ${requestUrl.pathname} on the verification API.`);
}

/* ==========================================================================
   Bot routes — authenticated by VERIFICATION_BOT_SECRET
   ========================================================================== */

async function handleBotRoutes(
  request: Request,
  env: Env,
  config: SupabaseConfig,
  path: string[],
): Promise<Response> {
  const method = request.method.toUpperCase();
  const head = path[0];

  // POST /api/accounts/verification/bot/link-account
  if (head === "link-account" && method === "POST") {
    const body = await bodyAsJson(request);
    const code = cleanText(body.code);
    const yapinUserId = cleanText(body.yapin_user_id);
    const yapinUsername = cleanText(body.yapin_username || "");

    if (!code) return fail(400, "CODE_REQUIRED", "Link code is required.");
    if (!yapinUserId) return fail(400, "YAPIN_USER_ID_REQUIRED", "Yapin user id is required.");

    try {
      const { data } = await callRpc(config, env, "verification_link_account", {
        p_code: code,
        p_yapin_user_id: yapinUserId,
        p_yapin_username: yapinUsername,
      });
      return json(data ?? { ok: false, error: { code: "RPC_ERROR", message: "No response." } });
    } catch (error) {
      return rpcErrorResponse(error);
    }
  }

  // POST /api/accounts/verification/bot/open-ticket
  if (head === "open-ticket" && method === "POST") {
    const body = await bodyAsJson(request);
    const yapinUserId = cleanText(body.yapin_user_id);
    const yapinUsername = cleanText(body.yapin_username || "");
    const gameId = cleanText(body.game_id || "");
    const evidence = cleanText(body.evidence || "");
    const channelId = cleanText(body.channel_id || "");
    const yapinTicketId = cleanText(body.yapin_ticket_id || "");

    if (!yapinUserId) return fail(400, "YAPIN_USER_ID_REQUIRED", "Yapin user id is required.");

    try {
      const { data } = await callRpc(config, env, "verification_open_ticket", {
        p_yapin_user_id: yapinUserId,
        p_yapin_username: yapinUsername,
        p_game_id: gameId || null,
        p_evidence: evidence,
        p_channel_id: channelId || null,
        p_yapin_ticket_id: yapinTicketId || null,
      });
      return json(data ?? { ok: false, error: { code: "RPC_ERROR", message: "No response." } });
    } catch (error) {
      return rpcErrorResponse(error);
    }
  }

  // POST /api/accounts/verification/bot/select-game
  if (head === "select-game" && method === "POST") {
    const body = await bodyAsJson(request);
    const ticketId = cleanText(body.ticket_id);
    const gameId = cleanText(body.game_id);

    if (!ticketId) return fail(400, "TICKET_ID_REQUIRED", "Ticket id is required.");
    if (!gameId) return fail(400, "GAME_ID_REQUIRED", "Game id is required.");

    try {
      const { data } = await callRpc(config, env, "verification_select_game", {
        p_ticket_id: ticketId,
        p_game_id: gameId,
      });
      return json(data ?? { ok: false, error: { code: "RPC_ERROR", message: "No response." } });
    } catch (error) {
      return rpcErrorResponse(error);
    }
  }

  // POST /api/accounts/verification/bot/submit-evidence
  if (head === "submit-evidence" && method === "POST") {
    const body = await bodyAsJson(request);
    const ticketId = cleanText(body.ticket_id);
    const evidence = cleanText(body.evidence);

    if (!ticketId) return fail(400, "TICKET_ID_REQUIRED", "Ticket id is required.");
    if (!evidence) return fail(400, "EVIDENCE_REQUIRED", "Evidence text is required.");

    try {
      const { data } = await callRpc(config, env, "verification_submit_evidence", {
        p_ticket_id: ticketId,
        p_evidence: evidence,
      });
      return json(data ?? { ok: false, error: { code: "RPC_ERROR", message: "No response." } });
    } catch (error) {
      return rpcErrorResponse(error);
    }
  }

  // POST /api/accounts/verification/bot/decide
  if (head === "decide" && method === "POST") {
    const body = await bodyAsJson(request);
    const ticketId = cleanText(body.ticket_id);
    const actorYapinId = cleanText(body.actor_yapin_id);
    const decision = cleanText(body.decision);
    const note = cleanText(body.note || "");

    if (!ticketId) return fail(400, "TICKET_ID_REQUIRED", "Ticket id is required.");
    if (!actorYapinId) return fail(400, "ACTOR_YAPIN_ID_REQUIRED", "Actor Yapin id is required.");
    if (!decision || !["approve", "reject"].includes(decision))
      return fail(400, "DECISION_INVALID", "Decision must be 'approve' or 'reject'.");

    try {
      const { data } = await callRpc(config, env, "verification_decide", {
        p_ticket_id: ticketId,
        p_actor_yapin_id: actorYapinId,
        p_decision: decision,
        p_note: note,
      });
      return json(data ?? { ok: false, error: { code: "RPC_ERROR", message: "No response." } });
    } catch (error) {
      return rpcErrorResponse(error);
    }
  }

  // POST /api/accounts/verification/bot/cancel-ticket
  if (head === "cancel-ticket" && method === "POST") {
    const body = await bodyAsJson(request);
    const ticketId = cleanText(body.ticket_id);
    const actorYapinId = cleanText(body.actor_yapin_id);

    if (!ticketId) return fail(400, "TICKET_ID_REQUIRED", "Ticket id is required.");
    if (!actorYapinId) return fail(400, "YAPIN_USER_ID_REQUIRED", "Yapin user id is required.");

    try {
      const { data } = await callRpc(config, env, "verification_cancel_ticket", {
        p_ticket_id: ticketId,
        p_actor_yapin_id: actorYapinId,
      });
      return json(data ?? { ok: false, error: { code: "RPC_ERROR", message: "No response." } });
    } catch (error) {
      return rpcErrorResponse(error);
    }
  }

  // GET /api/accounts/verification/bot/ticket/:id
  if (head === "ticket" && path[1] && method === "GET") {
    const ticketId = path[1];
    // Bot uses service role to read any ticket directly.
    const sk = env.SUPABASE_SERVICE_KEY;
    if (!sk || sk.length < 20) return fail(503, "NOT_CONFIGURED", "Service key is not configured.");

    try {
      const response = await fetch(
        `${config.url}/rest/v1/verification_tickets?id=eq.${encodeURIComponent(ticketId)}&select=*`,
        {
          headers: {
            apikey: config.key,
            authorization: `Bearer ${sk}`,
            accept: "application/json",
          },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!response.ok) {
        const text = await response.text();
        return fail(response.status, "DB_ERROR", text.slice(0, 300));
      }
      const tickets = (await response.json()) as unknown[];
      return json({ ok: true, ticket: tickets[0] ?? null });
    } catch (error) {
      return fail(503, "DB_UNREACHABLE", `Database did not answer: ${String(error)}`);
    }
  }

  // GET /api/accounts/verification/bot/tickets-by-yapin/:yapinUserId
  if (head === "tickets-by-yapin" && path[1] && method === "GET") {
    const yapinUserId = path[1];
    const sk = env.SUPABASE_SERVICE_KEY;
    if (!sk || sk.length < 20) return fail(503, "NOT_CONFIGURED", "Service key is not configured.");

    try {
      const response = await fetch(
        `${config.url}/rest/v1/verification_tickets?yapin_user_id=eq.${encodeURIComponent(yapinUserId)}&select=*&order=created_at.desc`,
        {
          headers: {
            apikey: config.key,
            authorization: `Bearer ${sk}`,
            accept: "application/json",
          },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!response.ok) {
        const text = await response.text();
        return fail(response.status, "DB_ERROR", text.slice(0, 300));
      }
      const tickets = (await response.json()) as unknown[];
      return json({ ok: true, tickets });
    } catch (error) {
      return fail(503, "DB_UNREACHABLE", `Database did not answer: ${String(error)}`);
    }
  }

  return fail(404, "ROUTE_NOT_FOUND", `There is no ${method} ${path.join("/")} on the bot API.`);
}

/* ==========================================================================
   Admin routes
   ========================================================================== */

async function handleAdminRoutes(
  request: Request,
  _env: Env,
  config: SupabaseConfig,
  session: Session,
  path: string[],
  url: URL,
): Promise<Response> {
  const method = request.method.toUpperCase();
  const head = path[0];

  // GET /api/accounts/verification/admin/staff
  // POST /api/accounts/verification/admin/staff — add or update a staff entry
  if (head === "staff") {
    if (method === "GET") {
      const { data } = await postgrest(config, "verification_staff", {
        params: { select: "*,profile:profile_id(username,display_name,avatar_url)", order: "created_at.desc" },
        token: session.token,
      });
      const rows = Array.isArray(data) ? data : [];
      return json({ ok: true, staff: rows });
    }

    if (method === "POST") {
      const body = await bodyAsJson(request);
      const profileId = cleanText(body.profile_id);
      const yapinUserId = cleanText(body.yapin_user_id || "");
      const status = cleanText(body.status || "active");
      const note = cleanText(body.note || "");

      if (!profileId) return fail(400, "PROFILE_ID_REQUIRED", "Profile id is required.");
      if (!["active", "revoked"].includes(status))
        return fail(400, "INVALID_STATUS", "Status must be 'active' or 'revoked'.");

      try {
        const { data } = await postgrest(config, "verification_staff", {
          method: "POST",
          body: { profile_id: profileId, yapin_user_id: yapinUserId || null, status, granted_by: session.userId, note },
          token: session.token,
        });
        return json({ ok: true, staff: Array.isArray(data) ? data[0] : data }, { status: 201 });
      } catch (error) {
        if (error instanceof SupabaseError) {
          if (error.message.includes("unique constraint")) {
            // Already exists — update it.
            const { data } = await postgrest(config, `verification_staff?profile_id=eq.${profileId}`, {
              method: "PATCH",
              body: {
                yapin_user_id: yapinUserId || null,
                status,
                note,
                revoked_at: status === "revoked" ? new Date().toISOString() : null,
              },
              token: session.token,
            });
            return json({ ok: true, staff: Array.isArray(data) ? data[0] : data });
          }
          return fail(error.status ?? 500, "DB_ERROR", error.message);
        }
        throw error;
      }
    }

    if (method === "PATCH" && path[1]) {
      // PATCH /api/accounts/verification/admin/staff/:profileId
      const profileId = path[1];
      const body = await bodyAsJson(request);
      const updates: Record<string, unknown> = {};
      if (body.yapin_user_id !== undefined) updates.yapin_user_id = cleanText(body.yapin_user_id) || null;
      if (body.status !== undefined) {
        updates.status = cleanText(body.status);
        if (body.status === "revoked") updates.revoked_at = new Date().toISOString();
      }
      if (body.note !== undefined) updates.note = cleanText(body.note);

      try {
        const { data } = await postgrest(config, `verification_staff?profile_id=eq.${profileId}`, {
          method: "PATCH",
          body: updates,
          token: session.token,
        });
        return json({ ok: true, staff: Array.isArray(data) ? data[0] : data });
      } catch (error) {
        const supabaseErr = error as SupabaseError;
        return fail(supabaseErr.status ?? 500, "DB_ERROR", supabaseErr.message);
      }
    }

    return fail(405, "METHOD_NOT_ALLOWED", "Use GET, POST or PATCH on staff.");
  }

  // GET /api/accounts/verification/admin/restricted
  // POST /api/accounts/verification/admin/restricted
  // DELETE /api/accounts/verification/admin/restricted/:gameId
  if (head === "restricted") {
    if (method === "GET") {
      const { data } = await postgrest(config, "restricted_games", {
        params: { select: "*", order: "game_id.asc" },
        token: session.token,
      });
      const rows = Array.isArray(data) ? data : [];
      return json({ ok: true, restricted: rows });
    }

    if (method === "POST") {
      const body = await bodyAsJson(request);
      const gameId = cleanText(body.game_id);
      const reason = cleanText(body.reason || "");

      if (!gameId) return fail(400, "GAME_ID_REQUIRED", "Game id is required.");

      try {
        const { data } = await postgrest(config, "restricted_games", {
          method: "POST",
          body: { game_id: gameId, reason, created_by: session.userId },
          token: session.token,
        });
        return json({ ok: true, restricted: Array.isArray(data) ? data[0] : data }, { status: 201 });
      } catch (error) {
        if (error instanceof SupabaseError) {
          if (error.message.includes("unique constraint")) {
            return fail(409, "ALREADY_RESTRICTED", "This game is already restricted.");
          }
          return fail(error.status ?? 500, "DB_ERROR", error.message);
        }
        throw error;
      }
    }

    if (method === "DELETE" && path[1]) {
      const gameId = path[1];
      await postgrest(config, `restricted_games?game_id=eq.${encodeURIComponent(gameId)}`, {
        method: "DELETE",
        token: session.token,
      });
      return json({ ok: true });
    }

    return fail(405, "METHOD_NOT_ALLOWED", "Use GET, POST or DELETE on restricted.");
  }

  // GET /api/accounts/verification/admin/tickets
  if (head === "tickets" && method === "GET") {
    const status = url.searchParams.get("status") ?? "";
    const params: Record<string, string> = {
      select: "*",
      order: "created_at.desc",
      limit: url.searchParams.get("limit") ?? "100",
    };
    if (status && ["open", "linked", "submitted", "approved", "rejected", "cancelled"].includes(status)) {
      params.status = `eq.${status}`;
    }
    const { data } = await postgrest(config, "verification_tickets", {
      params,
      token: session.token,
    });
    const tickets = Array.isArray(data) ? data : [];
    return json({ ok: true, tickets });
  }

  // GET /api/accounts/verification/admin/events
  if (head === "events" && method === "GET") {
    const ticketId = url.searchParams.get("ticket_id") ?? "";
    const params: Record<string, string> = {
      select: "*,actor_profile:actor_profile_id(username,display_name)",
      order: "created_at.desc",
      limit: url.searchParams.get("limit") ?? "200",
    };
    if (ticketId) params.ticket_id = `eq.${ticketId}`;
    const { data } = await postgrest(config, "verification_events", {
      params,
      token: session.token,
    });
    const events = Array.isArray(data) ? data : [];
    return json({ ok: true, events });
  }

  // GET /api/accounts/verification/admin/stats — summary counts
  if (head === "stats" && method === "GET") {
    // Fetch counts for each status
    const statuses = ["open", "linked", "submitted", "approved", "rejected", "cancelled"];
    const counts: Record<string, number> = {};
    for (const s of statuses) {
      const { total } = await postgrest(config, "verification_tickets", {
        params: { select: "id", status: `eq.${s}` },
        count: true,
        token: session.token,
      });
      counts[s] = total ?? 0;
    }
    // Staff counts
    const { total: activeStaff } = await postgrest(config, "verification_staff", {
      params: { select: "profile_id", status: "eq.active" },
      count: true,
      token: session.token,
    });
    const { total: restrictedCount } = await postgrest(config, "restricted_games", {
      params: { select: "game_id" },
      count: true,
      token: session.token,
    });
    return json({ ok: true, stats: { tickets: counts, activeStaff: activeStaff ?? 0, restrictedGames: restrictedCount ?? 0 } });
  }

  return fail(404, "ROUTE_NOT_FOUND", `There is no ${method} ${url.pathname} on the admin verification API.`);
}

function rpcErrorResponse(error: unknown): Response {
  const mapped = sqlstateError(error);
  if (mapped) return fail(mapped.status, mapped.code, mapped.message);
  const supabaseErr = error as SupabaseError;
  return fail(supabaseErr.status ?? 500, supabaseErr.code ?? "RPC_ERROR", supabaseErr.message);
}


