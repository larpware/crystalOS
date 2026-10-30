/* ==========================================================================
   The accounts API on the Worker — /api/accounts/*

   A careful port of the OS account server (server/accounts) onto the
   Workers runtime, with Supabase Postgres as the store. Every route keeps
   the shape the frontend already expects (src/services/social.ts,
   src/services/auth.ts, src/services/feed.ts) — same paths, same JSON
   payloads, same error codes — so the desktop does not care which runtime
   answered.

   Ground rules carried over from the Node backend:
     - the client can never name a user id; every session user comes from a
       verified Supabase token;
     - mutating requests must be same-origin;
     - friend codes and rarity are drawn here once and immutable;
     - role/tags/friend_code are never accepted in a request body.
   ========================================================================== */

import type { Env } from "./env";
import { postgrest, supabaseConfig, verifyAccessToken } from "./supabase";
import { SESSION_COOKIE, REFRESH_COOKIE, authenticate, clearCookie, sessionCookie } from "./session";
import {
  formatFriendCode,
  generateFriendCode,
  isWellFormedFriendCode,
  normalizeFriendCode,
  rarityGuide,
  rollRarity,
} from "./rarity";
import { handleVerification } from "./verify";
import { handleCommunity } from "./community";

/* ---- limits, mirrored from the account server ---------------------------- */

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,20}$/;
const DISPLAY_NAME_MAX = 40;
const BIO_MAX = 200;
const MESSAGE_MAX = 2000;
const AVATAR_MAX_BYTES = 512 * 1024;
const AVATAR_PATTERN = /^data:image\/(?:png|jpe?g|webp|gif|avif);base64,[A-Za-z0-9+/=]+$/;
const FRIEND_CODE_ATTEMPTS = 8;
const PRESENCE_WINDOW_MS = 60_000;

/* ---- small helpers -------------------------------------------------------- */

// The response envelope lives in ./http so the sibling route modules answer
// identically; re-exported here because index.ts has always imported them
// from this module.
export { json, fail } from "./http";
import { bodyAsJson, cleanText, fail, json, ms, orFilter, constraintError } from "./http";

/** Mutating requests must come from this origin, as with the Node backend. */
export function crossOrigin(request: Request, url: URL): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return false;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host !== url.host;
    } catch {
      return true;
    }
  }
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host !== url.host;
    } catch {
      return true;
    }
  }
  return false;
}

/* ---- profile shapes ------------------------------------------------------- */

/** A profiles row as PostgREST returns it (snake_case, ISO timestamps). */
export interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string | null;
  friend_code: string | null;
  rarity: string | null;
  rarity_roll: number | null;
  bio: string | null;
  avatar_url: string | null;
  role: string | null;
  tags: string[] | null;
  private_account: boolean | null;
  created_at: string;
  last_seen_at: string | null;
}

export function publicUser(row: ProfileRow | null, now = Date.now()) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    friendCode: formatFriendCode(row.friend_code ?? ""),
    bio: row.bio ?? undefined,
    avatar: row.avatar_url ?? undefined,
    rarity: row.rarity ?? undefined,
    tags: (row.tags && row.tags.length ? row.tags : undefined),
    private: Boolean(row.private_account),
    supabaseLinked: true,
    role: row.role ?? "user",
    createdAt: ms(row.created_at),
    online: ms(row.last_seen_at) > now - PRESENCE_WINDOW_MS,
    lastSeenAt: ms(row.last_seen_at),
  };
}

export function friendSummary(row: ProfileRow, extras: { friendsSince?: string } = {}) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    friendCode: formatFriendCode(row.friend_code ?? ""),
    avatar: row.avatar_url ?? undefined,
    rarity: row.rarity ?? undefined,
    tags: row.tags && row.tags.length ? row.tags : undefined,
    online: ms(row.last_seen_at) > Date.now() - PRESENCE_WINDOW_MS,
    lastSeenAt: ms(row.last_seen_at),
    friendsSince: extras.friendsSince ? ms(extras.friendsSince) : undefined,
  };
}

/** `dm_{lower}__{upper}` — the canonical order both participants share. */
function conversationIdFor(a: string, b: string): string {
  const ordered = a < b ? [a, b] : [b, a];
  return `dm_${ordered[0]}__${ordered[1]}`;
}

/* ---- validation ----------------------------------------------------------- */

interface Field {
  value?: string;
  error?: string;
}

function validateUsername(raw: unknown): Field {
  const value = cleanText(raw).trim();
  if (!value) return { error: "Enter a username." };
  if (value.length < 3) return { error: "Usernames need at least 3 characters." };
  if (value.length > 20) return { error: "Usernames are limited to 20 characters." };
  if (!USERNAME_PATTERN.test(value))
    return { error: "Use letters, numbers, dot, dash or underscore only." };
  return { value };
}

function validateDisplayName(raw: unknown, username: string): Field {
  const value = cleanText(raw).trim() || username;
  if (value.length > DISPLAY_NAME_MAX)
    return { error: `Display names are limited to ${DISPLAY_NAME_MAX} characters.` };
  return { value };
}

function validateBio(raw: unknown): Field {
  const value = cleanText(raw ?? "").trim();
  if (value.length > BIO_MAX) return { error: `Bios are limited to ${BIO_MAX} characters.` };
  return { value: value || undefined };
}

function validateAvatar(env: Env, raw: unknown): Field {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return { value: undefined };
  if (value.length > AVATAR_MAX_BYTES) return { error: "That image is larger than 512 KB." };
  if (value.startsWith("https://")) {
    // Only public Storage URLs inside this project count.
    const configured = String(env.SUPABASE_URL ?? "").replace(/\/+$/, "");
    const prefix = `${configured}/storage/v1/object/public/avatars/`;
    if (!value.startsWith(prefix))
      return { error: "That avatar URL is not part of this project's storage." };
    const path = value.slice(prefix.length).split(/[?#]/)[0];
    if (!/^[A-Za-z0-9/._-]+$/.test(path) || !/\.(?:png|jpe?g|webp|gif|avif)$/.test(path))
      return { error: "That avatar URL does not look like a supported image." };
    return { value };
  }
  if (!AVATAR_PATTERN.test(value))
    return { error: "Avatars must be a PNG, JPEG, WebP, GIF or AVIF image." };
  return { value };
}

function validateMessageBody(raw: unknown): Field {
  const value = cleanText(raw).trim();
  if (!value) return { error: "Messages cannot be empty." };
  if (value.length > MESSAGE_MAX) return { error: `Messages are limited to ${MESSAGE_MAX} characters.` };
  return { value };
}

/* ---- shared data access ---------------------------------------------------- */

/** The resolved project config, threaded through the route layer as a value. */
type SupabaseRest = NonNullable<ReturnType<typeof supabaseConfig>>;

export interface Session {
  config: SupabaseRest;
  token: string;
  userId: string;
  profile: ProfileRow;
}

export async function requireSession(
  request: Request,
  env: Env,
  _url: URL,
  setCookies: string[],
): Promise<Session | Response> {
  const config = supabaseConfig(env);
  if (!config) return fail(503, "NOT_CONFIGURED", "The backend is missing its Supabase key.");
  const auth = await authenticate(request, env);
  if (auth.ok) {
    setCookies.push(...auth.setCookies);
  } else if (auth.status === "unreachable") {
    return fail(503, "SERVER_UNREACHABLE", "The identity service did not answer. Try again.");
  } else {
    return fail(401, auth.status === "missing" ? "NO_SESSION" : "SESSION_EXPIRED", "Sign in to continue.");
  }

  const { data, status } = await postgrest(config, "profiles", {
    params: { id: `eq.${auth.user.id}`, select: "*" },
    token: auth.accessToken,
  });
  if (status === 200 && Array.isArray(data) && data.length > 0) {
    const row = data[0] as ProfileRow;
    return { config, token: auth.accessToken, userId: auth.user.id, profile: row };
  }
  return fail(404, "NO_LINKED_ACCOUNT", "This email has no CrystalOS account yet.");
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

async function bearerToken(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(header);
  return match ? match[1] : null;
}

async function fetchProfile(config: SupabaseRest, token: string, by: Record<string, string>): Promise<ProfileRow | null> {
  const { data } = await postgrest(config, "profiles", {
    params: { select: "*", ...by },
    token,
  });
  return Array.isArray(data) && data.length > 0 ? (data[0] as ProfileRow) : null;
}

/* ==========================================================================
   Routes
   ========================================================================== */

export async function handleAccounts(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const segments = url.pathname.slice("/api/accounts".length).split("/").filter(Boolean);
  const method = request.method.toUpperCase();
  const setCookies: string[] = [];

  // Same-origin: mirrored from the Node backend for every mutating method.
  if (crossOrigin(request, url)) {
    return fail(403, "CROSS_ORIGIN", "Requests must come from this site.");
  }

  /* The Yapin bot has no browser: it carries no cookies, so a session cannot
     be resolved for it. Its routes authenticate with a shared secret inside
     handleVerification and are dispatched here, before requireSession would
     otherwise answer every bot call with 401 NO_SESSION. */
  if (segments[0] === "verification" && segments[1] === "bot") {
    return handleVerification(request, env, url, null);
  }

  if (segments[0] === "community" && method === "GET" && (segments[1] === "apps" || segments[1] === "resolve")) {
    return handleCommunity(request, env, url, null);
  }

  /* Two reads answer *before* the session check, because of what the shell
     does with the answer:

       GET /me  — the boot probe. The Node backend answered 200 with
                  `user: null` when nobody was signed in; a 401 here is read
                  by src/state/auth.ts as "the account server is unreachable"
                  and the desktop labels itself offline for every visitor.
       GET /rarities — the sign-up screen shows the odds before an account
                  exists, so it has to work signed out.
  */
  if (method === "GET" || method === "HEAD") {
    if (segments.length === 1 && segments[0] === "rarities") return json(rarityGuide());
    if (segments.length === 1 && segments[0] === "me") {
      const auth = await authenticate(request, env);
      if (auth.ok) {
        setCookies.push(...auth.setCookies);
      } else if (auth.status === "unreachable") {
        return fail(503, "SERVER_UNREACHABLE", "The identity service did not answer. Try again.");
      } else {
        return json({ server: true, user: null });
      }
    }
  }

  const session = method === "POST" && (segments[0] === "register" || segments[0] === "login")
    ? await registerOrLogin(request, env, url, segments, setCookies)
    : await sessionFirst(request, env, url, segments, setCookies);

  if (session instanceof Response) return applyCookies(session, setCookies);
  return applyCookies(session, setCookies);
}

export function applyCookies(response: Response, setCookies: string[]): Response {
  for (const cookie of setCookies) response.headers.append("set-cookie", cookie);
  return response;
}

/** Non-auth routes: resolve the session first, then branch on path/method. */
async function sessionFirst(
  request: Request,
  env: Env,
  url: URL,
  segments: string[],
  setCookies: string[],
): Promise<Response> {
  const session = await requireSession(request, env, url, setCookies);
  if (session instanceof Response) return session;

  const [head, second, third, fourth] = segments;

  if (head === "me") return meRoute(request, url, session);
  if (head === "logout" && request.method.toUpperCase() === "POST") {
    return json({ ok: true }, { setCookies: [clearCookie(SESSION_COOKIE), clearCookie(REFRESH_COOKIE)] });
  }
  if (head === "rarities" && request.method.toUpperCase() === "GET") {
    return json(rarityGuide());
  }
  if (head === "sync" && request.method.toUpperCase() === "GET") return syncRoute(url, session);
  if (head === "verification") return handleVerification(request, env, url, session);
  if (head === "community") return handleCommunity(request, env, url, session);
  if (head === "notifications") return notificationsRoute(request, session);
  if (head === "friend-requests") return friendRequestsRoute(request, url, session, second, third);
  if (head === "friends" && third === undefined)
    return friendsRoute(request, session, second);
  if (head === "conversations" && third === "messages")
    return conversationsRoute(request, session, second, fourth);

  return fail(404, "ROUTE_NOT_FOUND", `There is no ${request.method} ${url.pathname} on this deployment.`);
}

/* ---- register / login ------------------------------------------------------ */

async function registerOrLogin(
  request: Request,
  env: Env,
  _url: URL,
  segments: string[],
  setCookies: string[],
): Promise<Response> {
  const mode = segments[0]; // "register" | "login"
  const config = supabaseConfig(env);
  if (!config) return fail(503, "NOT_CONFIGURED", "The backend is missing its Supabase key.");

  const body = await bodyAsJson(request);
  const bearer = await bearerToken(request);
  const presented = typeof body.supabaseToken === "string" ? body.supabaseToken : "";
  const token = presented || bearer || readCookie(request, SESSION_COOKIE) || "";
  if (!token) {
    return fail(401, "NO_SESSION", mode === "login"
      ? "Sign in with your email first."
      : "Sign up with your email first, then choose a username.");
  }

  const verified = await verifyAccessToken(config, token);
  if (!verified.ok) {
    if (verified.status === "unreachable")
      return fail(503, "SERVER_UNREACHABLE", "The identity service did not answer. Try again.");
    return fail(401, "INVALID_CREDENTIALS", "The sign-in could not be verified. Try again.");
  }
  if (mode === "login" && verified.ok && !verified.user.emailConfirmed) {
    return fail(403, "EMAIL_UNCONFIRMED", "Confirm your email first — the message is in your inbox.");
  }

  setCookies.push(sessionCookie(SESSION_COOKIE, token));
  if (typeof body.refreshToken === "string" && body.refreshToken) {
    setCookies.push(sessionCookie(REFRESH_COOKIE, body.refreshToken));
  }

  const existing = await fetchProfile(config, token, { id: `eq.${verified.user.id}` }).catch(() => null);
  if (existing) {
    // An identity that already has an OS account: both routes behave as sign-in.
    return json({ user: publicUser(existing) }, { status: 200 });
  }
  if (mode === "login") {
    return fail(404, "NO_LINKED_ACCOUNT", "This email has no CrystalOS account yet.");
  }

  // Register: username/display-name are validated, rarity + friend code are
  // drawn here, and the row is inserted under the user's own token — RLS
  // (id = auth.uid()) is what makes the insert safe to accept.
  const username = validateUsername(body.username);
  if (username.error) return fail(400, "INVALID_USERNAME", username.error);
  const displayName = validateDisplayName(body.displayName, username.value!);
  if (displayName.error) return fail(400, "INVALID_DISPLAY_NAME", displayName.error);

  for (let attempt = 0; attempt < FRIEND_CODE_ATTEMPTS; attempt += 1) {
    const { rarity, roll } = rollRarity();
    const friendCode = generateFriendCode();
    try {
      const { data } = await postgrest(config, "profiles", {
        method: "POST",
        token,
        body: {
          id: verified.user.id,
          username: username.value,
          display_name: displayName.value,
          friend_code: friendCode,
          rarity,
          rarity_roll: roll,
          role: "user",
        },
      });
      const row = Array.isArray(data) ? (data[0] as ProfileRow) : (data as ProfileRow);
      return json({ user: publicUser(row) }, { status: 201 });
    } catch (error) {
      if (constraintError(error, "profiles_friend_code_key")) continue;
      if (constraintError(error, "profiles_username_key")) {
        return fail(409, "USERNAME_TAKEN", "That username is already taken.");
      }
      if (constraintError(error, "profiles_id_fkey")) {
        return fail(400, "NO_SUPABASE_ACCOUNT", "Create the email account first.");
      }
      throw error;
    }
  }
  return fail(500, "CODE_EXHAUSTED", "Could not allocate a unique friend code.");
}

/* ---- /me ------------------------------------------------------------------- */

async function meRoute(
  request: Request,
  _url: URL,
  session: Session,
): Promise<Response> {
  const method = request.method.toUpperCase();

  if (method === "GET") {
    // Touch presence so friends see "online", same as the Node backend.
    try {
      await postgrest(session.config, "profiles", {
        method: "PATCH",
        token: session.token,
        params: { id: `eq.${session.userId}` },
        body: { last_seen_at: new Date().toISOString() },
        representation: false,
      });
    } catch {
      // Presence is advisory; never fail the session read for it.
    }
    return json({ server: true, user: publicUser(session.profile) });
  }

  if (method === "PATCH") {
    const body = await bodyAsJson(request);
    const patch: Record<string, unknown> = {};
    if (body.username !== undefined) {
      const username = validateUsername(body.username);
      if (username.error) return fail(400, "INVALID_USERNAME", username.error);
      patch.username = username.value;
    }
    if (body.displayName !== undefined) {
      const displayName = validateDisplayName(body.displayName, "");
      if (displayName.error) return fail(400, "INVALID_DISPLAY_NAME", displayName.error);
      patch.display_name = displayName.value;
    }
    if (body.bio !== undefined) {
      const bio = validateBio(body.bio);
      if (bio.error) return fail(400, "INVALID_BIO", bio.error);
      patch.bio = bio.value ?? null;
    }
    if (body.avatar !== undefined) {
      const avatar = validateAvatar({ SUPABASE_URL: session.config.url } as Env, body.avatar);
      if (avatar.error) return fail(400, "INVALID_AVATAR", avatar.error);
      patch.avatar_url = avatar.value ?? null;
    }
    if (body.privateAccount !== undefined) {
      patch.private_account = Boolean(body.privateAccount);
    }
    if (body.friendCode !== undefined || body.role !== undefined || body.tags !== undefined) {
      return fail(400, "READ_ONLY_FIELD", "That field cannot be sent to the server.");
    }
    if (Object.keys(patch).length === 0) return json({ user: publicUser(session.profile) });

    try {
      const { data } = await postgrest(session.config, "profiles", {
        method: "PATCH",
        token: session.token,
        params: { id: `eq.${session.userId}` },
        body: patch,
      });
      const row = Array.isArray(data) ? (data[0] as ProfileRow) : (data as ProfileRow);
      return json({ user: publicUser(row) });
    } catch (error) {
      if (constraintError(error, "profiles_username_key"))
        return fail(409, "USERNAME_TAKEN", "That username is already taken.");
      throw error;
    }
  }

  if (method === "DELETE") {
    // Account deletion needs the credential owner (Supabase) to remove the
    // auth user; without the service-role key that cannot happen here, so
    // the answer says exactly that instead of half-deleting data.
    return fail(409, "DELETE_OWNED_BY_SUPABASE",
      "Deletion happens with the email account owner — ask the project owner or add a service-role secret to enable it here.");
  }

  return fail(405, "METHOD_NOT_ALLOWED", `${method} is not supported on /me.`);
}

/* ---- /sync ------------------------------------------------------------------ */

async function syncRoute(url: URL, session: Session): Promise<Response> {
  const since = Math.max(0, Number(url.searchParams.get("since") ?? "0") || 0);
  const config = session.config;
  const token = session.token;
  const me = session.userId;

  const [{ data: friendships }, { data: requests }] = await Promise.all([
    postgrest(config, "friendships", {
      params: {
        select: "*",
        or: `(a_id.eq.${me},b_id.eq.${me})`,
      },
      token,
    }),
    postgrest(config, "friend_requests", {
      params: {
        select: "*",
        or: `(target_id.eq.${me},sender_id.eq.${me})`,
        status: "eq.pending",
      },
      token,
    }),
  ]);

  const pairs = (Array.isArray(friendships) ? friendships : []) as { a_id: string; b_id: string; created_at: string }[];
  const peerIds = pairs.map((pair) => (pair.a_id === me ? pair.b_id : pair.a_id));
  const friendRows = peerIds.length
    ? ((await postgrest(config, "profiles", {
        params: { select: "*", id: `in.(${peerIds.join(",")})` },
        token,
      })).data as ProfileRow[])
    : [];
  const summaryById = new Map(friendRows.map((row) => [row.id, row]));
  const friends = pairs
    .map((pair) => {
      const peer = summaryById.get(pair.a_id === me ? pair.b_id : pair.a_id);
      return peer ? friendSummary(peer, { friendsSince: pair.created_at }) : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const requestRows = (Array.isArray(requests) ? requests : []) as {
    id: string; sender_id: string; target_id: string; status: string; created_at: string;
  }[];
  const requestPeerIds = [...new Set(requestRows.map((row) => (row.sender_id === me ? row.target_id : row.sender_id)))];
  const requestProfileRows = requestPeerIds.length
    ? ((await postgrest(config, "profiles", {
        params: { select: "*", id: `in.(${requestPeerIds.join(",")})` },
        token,
      })).data as ProfileRow[])
    : [];
  const requestProfiles = new Map(requestProfileRows.map((row) => [row.id, row]));

  const incoming = requestRows
    .filter((row) => row.target_id === me)
    .map((row) => ({
      id: row.id,
      from: requestProfiles.get(row.sender_id) ? friendSummary(requestProfiles.get(row.sender_id)!) : null,
      createdAt: ms(row.created_at),
    }))
    .filter((entry) => entry.from !== null);

  const outgoing = requestRows
    .filter((row) => row.sender_id === me)
    .map((row) => ({
      id: row.id,
      to: requestProfiles.get(row.target_id) ? friendSummary(requestProfiles.get(row.target_id)!) : null,
      status: row.status === "accepted" ? ("accepted" as const) : row.status === "declined" ? ("declined" as const) : ("pending" as const),
      createdAt: ms(row.created_at),
    }))
    .filter((entry) => entry.to !== null);

  const { data: recentMessages } = await postgrest(config, "messages", {
    params: {
      select: "*",
      or: `(sender_id.eq.${me},recipient_id.eq.${me})`,
      "created_at": `gt.${new Date(since).toISOString()}`,
      order: "created_at.asc",
      limit: "100",
    },
    token,
  });

  const allRelevant = [
    ...new Set([
      ...peerIds,
      ...requestPeerIds,
      ...((Array.isArray(recentMessages) ? recentMessages : []) as { sender_id: string; recipient_id: string }[])
        .map((row) => (row.sender_id === me ? row.recipient_id : row.sender_id)),
    ]),
  ];
  const conversationPeers = allRelevant.length
    ? ((await postgrest(config, "profiles", {
        params: { select: "*", id: `in.(${allRelevant.join(",")})` },
        token,
      })).data as ProfileRow[])
    : [];
  const peerById = new Map(conversationPeers.map((row) => [row.id, row]));
  const friendSummariesById = new Map(friends.map((friend) => [friend.id, friend]));
  const peerSummary = (id: string) => friendSummariesById.get(id) ?? (peerById.get(id) ? friendSummary(peerById.get(id)!) : null);

  const messages = ((Array.isArray(recentMessages) ? recentMessages : []) as MsgRow[]).map((row) => ({
    conversationId: conversationIdFor(row.sender_id, row.recipient_id),
    peer: peerSummary(row.sender_id === me ? row.recipient_id : row.sender_id),
    message: messageShape(
      row,
      row.sender_id === me
        ? (session.profile.display_name ?? session.profile.username ?? "")
        : (peerSummary(row.sender_id)?.displayName ?? ""),
    ),
  }));

  return json({
    serverTime: Date.now(),
    user: {
      id: session.profile.id,
      username: session.profile.username,
      displayName: session.profile.display_name,
      friendCode: formatFriendCode(session.profile.friend_code ?? ""),
      online: true,
      lastSeenAt: ms(session.profile.last_seen_at),
    },
    friends,
    incoming,
    outgoing,
    messages,
  });
}

interface MsgRow {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
}

function messageShape(row: MsgRow, authorName = "") {
  return {
    id: row.id,
    authorId: row.sender_id,
    authorName,
    body: row.body,
    sentAt: ms(row.created_at),
  };
}

/* ---- friend requests -------------------------------------------------------- */

async function friendRequestsRoute(
  request: Request,
  url: URL,
  session: Session,
  second: string | undefined,
  third: string | undefined,
): Promise<Response> {
  const config = session.config;
  const token = session.token;
  const me = session.userId;
  const method = request.method.toUpperCase();

  // POST /friend-requests — ask someone by friend code.
  if (method === "POST" && second === undefined) {
    const body = await bodyAsJson(request);
    const canonical = normalizeFriendCode(body.code);
    if (!isWellFormedFriendCode(canonical)) {
      return fail(400, "INVALID_FRIEND_CODE", "Enter the friend code exactly as it reads, e.g. CR-7K4M-9Q2X.");
    }
    const target = await fetchProfile(config, token, { friend_code: `eq.${canonical}` });
    if (!target) return fail(404, "ACCOUNT_NOT_FOUND", "No account has that friend code.");
    if (target.id === me) return fail(400, "SELF_REQUEST", "You cannot add yourself.");
    if (await friendshipExists(config, token, me, target.id)) {
      return fail(409, "ALREADY_FRIENDS", `${target.display_name} is already on your friends list.`);
    }
    const existing = await postgrest(config, "friend_requests", {
      params: {
        select: "id",
        status: "eq.pending",
        or: orFilter([
          `and(sender_id.eq.${me},target_id.eq.${target.id})`,
          `and(sender_id.eq.${target.id},target_id.eq.${me})`,
        ]),
      },
      token,
    });
    if (Array.isArray(existing.data) && existing.data.length) {
      return fail(409, "REQUEST_EXISTS", "A pending request already sits between you.");
    }
    const { data } = await postgrest(config, "friend_requests", {
      method: "POST",
      token,
      body: { sender_id: me, target_id: target.id, status: "pending" },
    });
    const row = (Array.isArray(data) ? data[0] : data) as { id: string; created_at: string };
    return json(
      {
        request: {
          id: row.id,
          to: friendSummary(target),
          status: "pending",
          createdAt: ms(row.created_at),
        },
      },
      { status: 201 },
    );
  }

  // POST /friend-requests/:id/accept | /decline
  if (method === "POST" && second && (third === "accept" || third === "decline")) {
    const requestId = cleanText(second);
    const { data: found } = await postgrest(config, "friend_requests", {
      params: { select: "*", id: `eq.${requestId}` },
      token,
    });
    const row = (Array.isArray(found) ? found[0] : null) as
      | { id: string; sender_id: string; target_id: string; status: string; created_at: string }
      | null;
    if (!row || row.target_id !== me || row.status !== "pending") {
      return fail(404, "REQUEST_NOT_FOUND", "That request is not waiting for you.");
    }
    if (third === "decline") {
      await postgrest(config, "friend_requests", {
        method: "PATCH",
        token,
        params: { id: `eq.${requestId}` },
        body: { status: "declined" },
      });
      return json({ ok: true });
    }
    // Accept: mark it, then create the friendship row (canonical ordering).
    const [lower, upper] = me < row.sender_id ? [me, row.sender_id] : [row.sender_id, me];
    await postgrest(config, "friendships", {
      method: "POST",
      token,
      body: { a_id: lower, b_id: upper },
    }).catch((error) => {
      // A duplicate friendship is fine: accept twice.
      if (!/duplicate key/i.test(String(error))) throw error;
    });
    await postgrest(config, "friend_requests", {
      method: "PATCH",
      token,
      params: { id: `eq.${requestId}` },
      body: { status: "accepted" },
    });
    const sender = await fetchProfile(config, token, { id: `eq.${row.sender_id}` });
    return json({
      friend: sender ? friendSummary(sender) : null,
    });
  }

  // DELETE /friend-requests/:id — cancel (sender) or dispose (target).
  if (method === "DELETE" && second && third === undefined) {
    await postgrest(config, "friend_requests", {
      method: "DELETE",
      token,
      params: { id: `eq.${cleanText(second)}` },
      representation: false,
    });
    return json({ ok: true });
  }

  return fail(404, "ROUTE_NOT_FOUND", `There is no ${method} ${url.pathname} on this deployment.`);
}

async function friendshipExists(config: SupabaseRest, token: string, a: string, b: string): Promise<boolean> {
  const { data } = await postgrest(config, "friendships", {
    params: {
      select: "a_id",
      or: orFilter([`and(a_id.eq.${a},b_id.eq.${b})`, `and(a_id.eq.${b},b_id.eq.${a})`]),
    },
    token,
  });
  return Array.isArray(data) && data.length > 0;
}

/* ---- friends ----------------------------------------------------------------- */

async function friendsRoute(
  request: Request,
  session: Session,
  second: string | undefined,
): Promise<Response> {
  if (request.method.toUpperCase() !== "DELETE" || !second) {
    return fail(405, "METHOD_NOT_ALLOWED", "Only DELETE is supported on /friends/:id.");
  }
  const config = session.config;
  const token = session.token;
  const me = session.userId;
  const peer = cleanText(second);
  const existed = await friendshipExists(config, token, me, peer);
  if (!existed) {
    const other = await fetchProfile(config, token, { id: `eq.${peer}` });
    return fail(404, "NOT_FRIENDS", other ? `${other.display_name} is not on your friends list.` : "That account no longer exists.");
  }
  await postgrest(config, "friendships", {
    method: "DELETE",
    token,
    params: {
      or: orFilter([`and(a_id.eq.${me},b_id.eq.${peer})`, `and(a_id.eq.${peer},b_id.eq.${me})`]),
    },
    representation: false,
  });
  await postgrest(config, "friend_requests", {
    method: "DELETE",
    token,
    params: {
      or: orFilter([
        `and(sender_id.eq.${me},target_id.eq.${peer})`,
        `and(sender_id.eq.${peer},target_id.eq.${me})`,
      ]),
    },
    representation: false,
  });
  return json({ ok: true });
}

/* ---- direct messages ---------------------------------------------------------- */

async function conversationsRoute(
  request: Request,
  session: Session,
  peerId: string | undefined,
  fourth: string | undefined,
): Promise<Response> {
  if (fourth !== undefined) {
    return fail(404, "ROUTE_NOT_FOUND", "That conversation route does not exist.");
  }
  const config = session.config;
  const token = session.token;
  const me = session.userId;
  const peer = cleanText(peerId);
  const method = request.method.toUpperCase();

  const peerProfile = await fetchProfile(config, token, { id: `eq.${peer}` });
  if (!peerProfile) return fail(404, "ACCOUNT_NOT_FOUND", "That account no longer exists.");
  if (peer === me) return fail(400, "SELF_CONVERSATION", "You cannot message yourself.");
  if (!(await friendshipExists(config, token, me, peer))) {
    return fail(403, "NOT_FRIENDS", `${peerProfile.display_name} is not on your friends list.`);
  }

  if (method === "GET") {
    const limit = Math.min(500, Math.max(1, Number(request.url.split("limit=")[1]?.split("&")[0] ?? "100") || 100));
    const { data } = await postgrest(config, "messages", {
      params: {
        select: "*",
        or: orFilter([
          `and(sender_id.eq.${me},recipient_id.eq.${peer})`,
          `and(sender_id.eq.${peer},recipient_id.eq.${me})`,
        ]),
        order: "created_at.desc",
        limit: String(limit),
      },
      token,
    });
    const rows = (Array.isArray(data) ? data : []) as MsgRow[];
    rows.reverse();
    return json({
      conversationId: conversationIdFor(me, peer),
      peer: friendSummary(peerProfile),
      messages: rows.map((row) => ({
        ...messageShape(row, row.sender_id === me ? session.profile.display_name ?? "" : peerProfile.display_name ?? ""),
      })),
    });
  }

  if (method === "POST") {
    const body = await bodyAsJson(request);
    const message = validateMessageBody(body.body);
    if (message.error) return fail(400, "INVALID_MESSAGE_BODY", message.error);
    const clientId = cleanText(body.clientId).slice(0, 64) || undefined;
    const { data } = await postgrest(config, "messages", {
      method: "POST",
      token,
      body: { sender_id: me, recipient_id: peer, body: message.value, client_id: clientId },
    });
    const row = (Array.isArray(data) ? data[0] : data) as MsgRow;
    return json(
      {
        conversationId: conversationIdFor(me, peer),
        peer: friendSummary(peerProfile),
        message: { ...messageShape(row), authorName: peer === row.sender_id ? peerProfile.display_name : session.profile.display_name },
      },
      { status: 201 },
    );
  }

  return fail(405, "METHOD_NOT_ALLOWED", `${method} is not supported on conversation routes.`);
}

/* ---- notifications --------------------------------------------------------------- */

async function notificationsRoute(request: Request, session: Session): Promise<Response> {
  const method = request.method.toUpperCase();
  const config = session.config;
  const token = session.token;
  const me = session.userId;

  if (method === "GET") {
    const since = Math.max(0, Number(new URL(request.url).searchParams.get("since") ?? "0") || 0);
    const { data } = await postgrest(config, "notifications", {
      params: {
        select: "*",
        user_id: `eq.${me}`,
        "created_at": `gt.${new Date(since).toISOString()}`,
        order: "created_at.desc",
        limit: "100",
      },
      token,
    });
    const rows = (Array.isArray(data) ? data : []) as Record<string, string | null>[];
    const actors = [...new Set(rows.map((row) => row.actor_id).filter(Boolean))] as string[];
    const actorRows = actors.length
      ? ((await postgrest(config, "profiles", {
          params: { select: "id,username,display_name,avatar_url,tags", id: `in.(${actors.join(",")})` },
          token,
        })).data as ProfileRow[])
      : [];
    const actorById = new Map(actorRows.map((row) => [row.id, row]));
    return json({
      notifications: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        postId: row.post_id ?? null,
        body: row.body ?? null,
        createdAt: ms(row.created_at),
        readAt: row.read_at ? ms(row.read_at) : null,
        actor: actorById.get(row.actor_id ?? "")
          ? ((actor) => ({
              id: actor.id,
              username: actor.username,
              displayName: actor.display_name,
              avatar: actor.avatar_url ?? null,
              tags: actor.tags ?? [],
            }))(actorById.get(row.actor_id ?? "")!)
          : null,
      })),
    });
  }

  if (method === "POST") {
    // Mark everything read.
    await postgrest(config, "notifications", {
      method: "PATCH",
      token,
      params: { user_id: `eq.${me}`, read_at: "is.null" },
      body: { read_at: new Date().toISOString() },
      representation: false,
    });
    return json({ ok: true });
  }

  return fail(405, "METHOD_NOT_ALLOWED", `${method} is not supported on /notifications.`);
}
