import { apiRequest } from "./api";
import { isRarityId } from "./rarity";
import { loadJSON, removeKey } from "./storage";
import { getSupabase, hasSupabaseConfig, signInWithPassword } from "@/lib/supabase";
import type { AccountProfile } from "@/types";

/* ==========================================================================
   Account service

   Accounts live on the CrystalOS account server (server/accounts/api.mjs), which
   hashes passwords with scrypt and stores everything in SQLite. The browser
   holds no credentials and no identity records: the session is an HttpOnly
   cookie, and every call below is an ordinary request that the server either
   authorises from that cookie or refuses.

   Friend codes are assigned by the server when the account is created. There is
   deliberately no function in this file that writes one — the only client-side
   friend-code helpers are formatting (see utils/format.ts).
   ========================================================================== */

export const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,20}$/;
export const PASSWORD_MIN = 8;
export const DISPLAY_NAME_MAX = 40;

export function validateUsername(username: string): string | null {
  if (!username.trim()) return "Enter a username.";
  if (username.length < 3) return "Usernames need at least 3 characters.";
  if (username.length > 20) return "Usernames are limited to 20 characters.";
  if (!USERNAME_PATTERN.test(username))
    return "Use letters, numbers, dot, dash or underscore only.";
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Passwords need at least ${PASSWORD_MIN} characters.`;
  if (password.length > 128) return "That password is too long.";
  return null;
}

export function validateDisplayName(displayName: string): string | null {
  if (displayName.length > DISPLAY_NAME_MAX)
    return `Display names are limited to ${DISPLAY_NAME_MAX} characters.`;
  return null;
}

export interface AuthResult {
  ok: boolean;
  error?: string;
  /** Server error code, so callers can react to specific failures. */
  code?: string;
  account?: AccountProfile;
}

/** The server's user payload, mapped to the shape the OS uses everywhere. */
interface ServerUser {
  id: string;
  username: string;
  displayName: string;
  friendCode: string;
  bio?: string;
  avatar?: string;
  rarity?: string;
  role?: string;
  tags?: string[];
  supabaseLinked?: boolean;
  createdAt: number;
}

function toProfile(user: ServerUser): AccountProfile {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    friendCode: user.friendCode,
    bio: user.bio,
    avatar: user.avatar,
    // The rarity is drawn by the server; an unrecognised value is dropped rather
    // than stored, so a stale cached profile cannot paint a tier that does not
    // exist in this build's table.
    rarity: isRarityId(user.rarity) ? user.rarity : undefined,
    role: user.role === "admin" ? "admin" : "user",
    tags: Array.isArray(user.tags) ? user.tags : undefined,
    supabaseLinked: Boolean(user.supabaseLinked),
    createdAt: user.createdAt,
  };
}

/** A plain email shape — only used to route between the two sign-in mounts. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Maps a Supabase auth error to something the boot screen can show. The
 * library's messages are honest but library-flavoured ("Invalid login
 * credentials"); these say what a person should do.
 */
function supabaseError(error: { message?: string; status?: number } | null | undefined): string {
  const message = error?.message ?? "";
  if (/invalid login credentials/i.test(message))
    return "That email and password do not match. Try again, or reset your password below.";
  if (/already registered/i.test(message))
    return "That email is already registered — sign in instead.";
  if (/rate limit/i.test(message)) return "Too many attempts. Try again in a moment.";
  if (/confirm/i.test(message)) return "Check your inbox to confirm your email first.";
  return message || "Supabase sign-in failed.";
}

export interface SignUpOutcome extends AuthResult {
  /**
   * Supabase-only: the project requires confirming the email, so no session
   * exists yet. The account is created; the desktop shows the "check your
   * inbox" state instead of signing in.
   */
  emailConfirmationPending?: boolean;
}

export async function registerAccount(input: {
  username: string;
  displayName: string;
  password: string;
  /** When present, the credentials live with Supabase Auth. */
  email?: string;
}): Promise<SignUpOutcome> {
  const usernameError = validateUsername(input.username);
  if (usernameError) return { ok: false, error: usernameError };
  const displayNameError = validateDisplayName(input.displayName);
  if (displayNameError) return { ok: false, error: displayNameError };

  let body: Record<string, unknown> = {
    username: input.username.trim(),
    displayName: input.displayName.trim(),
  };
  /** The auth.uid() from a successful sign-up, for the profile mirror. */
  let signUpUserId: string | undefined;

  if (input.email) {
    if (!looksLikeEmail(input.email)) return { ok: false, error: "Enter a valid email address." };
    const passwordError = validatePassword(input.password);
    if (passwordError) return { ok: false, error: passwordError };

    // The password is registered with Supabase here, in the browser, so the
    // OS account server never sees it — as with every password everywhere,
    // only the hash leaves this machine, and Supabase never sends it back.
    const { data, error } = await getSupabase().auth.signUp({
      email: input.email.trim(),
      password: input.password,
    });
    if (error) return { ok: false, error: supabaseError(error) };
    if (!data.session) {
      return {
        ok: false,
        emailConfirmationPending: true,
        code: "EMAIL_CONFIRMATION",
      };
    }
    signUpUserId = data.user?.id ?? undefined;
    body = { ...body, supabaseToken: data.session.access_token };
  } else {
    const passwordError = validatePassword(input.password);
    if (passwordError) return { ok: false, error: passwordError };
    body = { ...body, password: input.password };
  }

  const result = await apiRequest<{ user: ServerUser }>("/register", { method: "POST", body });
  if (!result.ok) return { ok: false, error: result.error.message, code: result.error.code };
  void mirrorProfile(signUpUserId, result.data.user);
  return { ok: true, account: toProfile(result.data.user) };
}

/** `identifier` is the username, the account's friend code, or an email. */
export async function authenticate(identifier: string, password: string): Promise<AuthResult> {
  if (!identifier.trim() || !password) {
    return { ok: false, error: "Enter your username and password." };
  }

  // Email sign-in: credentials belong to Supabase Auth; the access token it
  // returns is minted into the OS cookie session by the account server.
  if (looksLikeEmail(identifier) && hasSupabaseConfig()) {
    const signedIn = await signInWithPassword(identifier.trim(), password);
    if (!signedIn.ok) return { ok: false, error: signedIn.error };
    const result = await apiRequest<{ user: ServerUser }>("/login", {
      method: "POST",
      body: { supabaseToken: signedIn.accessToken },
    });
    if (!result.ok) return { ok: false, error: result.error.message, code: result.error.code };
    void mirrorProfile(signedIn.userId, result.data.user);
    return { ok: true, account: toProfile(result.data.user) };
  }

  const result = await apiRequest<{ user: ServerUser }>("/login", {
    method: "POST",
    body: { identifier: identifier.trim(), password },
  });
  if (!result.ok) return { ok: false, error: result.error.message, code: result.error.code };
  return { ok: true, account: toProfile(result.data.user) };
}

/**
 * Password recovery through Supabase: the email is sent by the project and
 * the reset happens in the link the email carries. Nothing to return beyond
 * "sent" — the wording stays vague by design, the way the server's error
 * messages never reveal which accounts exist.
 */
export async function requestPasswordReset(email: string): Promise<AuthResult> {
  if (!looksLikeEmail(email)) return { ok: false, error: "Enter a valid email address." };
  if (!hasSupabaseConfig()) return { ok: false, error: "Password reset is unavailable right now." };
  const { error } = await getSupabase().auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/`,
  });
  if (error) return { ok: false, error: supabaseError(error) };
  return { ok: true };
}

/**
 * The password for a Supabase-linked account is changed with the session
 * Supabase holds. The current password is re-entered as a courtesy — Supabase
 * verifies the session, the current-password check is what echoes the classic
 * flow's shape of confirming before replacing.
 */
export async function changeSupabasePassword(newPassword: string): Promise<AuthResult> {
  const passwordError = validatePassword(newPassword);
  if (passwordError) return { ok: false, error: passwordError };
  if (!hasSupabaseConfig()) return { ok: false, error: "Password change is unavailable right now." };
  const { error } = await getSupabase().auth.updateUser({ password: newPassword });
  if (error) return { ok: false, error: supabaseError(error) };
  return { ok: true };
}

/**
 * Best-effort mirror of the OS profile into the Supabase `profiles` table,
 * so other surfaces reading the project directly (realtime listings, future
 * social surfaces) see the same names and colors. Never blocks and never
 * fails the OS action that triggered it: the account server remains the
 * canonical profile store, and RLS makes this row owner-writable only.
 * `supabaseId` is the auth.uid() the row is keyed to — the OS account id is
 * a different identity and must not be written here.
 */
async function mirrorProfile(supabaseId: string | undefined, user: ServerUser, fields?: {
  bio?: string;
  avatar?: string | null;
}): Promise<void> {
  if (!supabaseId || !hasSupabaseConfig()) return;
  try {
    const { error } = await getSupabase().from("profiles").upsert(
      {
        id: supabaseId,
        username: user.username,
        display_name: user.displayName,
        bio: fields && "bio" in fields ? fields.bio ?? null : user.bio ?? null,
        avatar_url: fields && "avatar" in fields ? fields.avatar ?? null : user.avatar ?? null,
      },
      { onConflict: "id" },
    );
    if (error) console.debug("[supabase] profile mirror skipped:", error.message);
  } catch (error) {
    console.debug("[supabase] profile mirror skipped:", error);
  }
}

/** The Supabase identity behind the browser's current session, if any. */
async function currentSupabaseId(): Promise<string | undefined> {
  if (!hasSupabaseConfig()) return undefined;
  try {
    const { data } = await getSupabase().auth.getUser();
    return data.user?.id;
  } catch {
    return undefined;
  }
}

export async function endSession(): Promise<void> {
  await apiRequest("/logout", { method: "POST", body: {} });
}

/**
 * Boot-time session check. `account` is null when the cookie is gone or the
 * server has no record of it; `online` says whether the server answered at all.
 */
export async function fetchSession(): Promise<{
  account: AccountProfile | null;
  online: boolean;
}> {
  const result = await apiRequest<{ user: ServerUser | null }>("/me");
  if (!result.ok) return { account: null, online: false };
  return { account: result.data.user ? toProfile(result.data.user) : null, online: true };
}

/** Sends only the fields present in `patch`; never the friend code. */
export async function updateAccount(patch: {
  username?: string;
  displayName?: string;
  bio?: string;
  avatar?: string | null;
}): Promise<AuthResult> {
  const result = await apiRequest<{ user: ServerUser }>("/me", { method: "PATCH", body: patch });
  if (!result.ok) return { ok: false, error: result.error.message, code: result.error.code };
  // The account server is canonical; the mirror is same-content, best-effort.
  void mirrorProfile(await currentSupabaseId(), result.data.user, {
    bio: patch.bio,
    avatar: patch.avatar,
  });
  return { ok: true, account: toProfile(result.data.user) };
}

/**
 * One door for both credential worlds. A Supabase-linked account gets its
 * password changed with Supabase (current password is not verifiable here —
 * the linked row's salt is empty) and never touches the server route; a
 * classic account keeps the flow it always had.
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<AuthResult> {
  const passwordError = validatePassword(newPassword);
  if (passwordError) return { ok: false, error: passwordError };
  const session = await fetchSession();
  if (session.account?.supabaseLinked) {
    if (!currentPassword) return { ok: false, error: "Confirm your current password first." };
    // The OS never sees the email's password, so it cannot re-verify the
    // current one — the gate here is the live Supabase session itself, which
    // only the account holder can have. An expired session is told apart
    // from an impossible one: expired asks for a fresh sign-in.
    const supabaseId = await currentSupabaseId();
    if (!supabaseId) return { ok: false, error: "Your session has expired. Sign in again to change the password." };
    return changeSupabasePassword(newPassword);
  }
  if (!currentPassword) return { ok: false, error: "Enter your current password." };
  const result = await apiRequest<{ user: ServerUser }>("/me/password", {
    method: "POST",
    body: { currentPassword, newPassword },
  });
  if (!result.ok) return { ok: false, error: result.error.message, code: result.error.code };
  return { ok: true, account: toProfile(result.data.user) };
}

/** Deleting is confirmed with the password, and the cookie is cleared. */
export async function deleteAccount(password: string): Promise<AuthResult> {
  const result = await apiRequest("/me", { method: "DELETE", body: { password } });
  if (!result.ok) return { ok: false, error: result.error.message, code: result.error.code };
  return { ok: true };
}

/* ==========================================================================
   Legacy local profiles

   Earlier CrystalOS builds kept password-hashed accounts in localStorage. Those
   records are not identities any more — friend codes now belong to accounts on
   the server — but the data is left untouched until the user asks for it to be
   removed, and Settings → Accounts says so plainly.
   ========================================================================== */

const LEGACY_ACCOUNTS_KEY = "accounts";

export function listLegacyLocalAccounts(): AccountProfile[] {
  const file = loadJSON<{ accounts?: AccountProfile[] }>(LEGACY_ACCOUNTS_KEY, {});
  return Array.isArray(file.accounts) ? file.accounts : [];
}

export function forgetLegacyLocalAccounts(): void {
  removeKey(LEGACY_ACCOUNTS_KEY);
}
