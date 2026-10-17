import { apiRequest } from "./api";
import { loadJSON, removeKey } from "./storage";
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
    createdAt: user.createdAt,
  };
}

export async function registerAccount(input: {
  username: string;
  displayName: string;
  password: string;
}): Promise<AuthResult> {
  const usernameError = validateUsername(input.username);
  if (usernameError) return { ok: false, error: usernameError };
  const passwordError = validatePassword(input.password);
  if (passwordError) return { ok: false, error: passwordError };
  const displayNameError = validateDisplayName(input.displayName);
  if (displayNameError) return { ok: false, error: displayNameError };

  const result = await apiRequest<{ user: ServerUser }>("/register", {
    method: "POST",
    body: {
      username: input.username.trim(),
      displayName: input.displayName.trim(),
      password: input.password,
    },
  });
  if (!result.ok) return { ok: false, error: result.error.message, code: result.error.code };
  return { ok: true, account: toProfile(result.data.user) };
}

/** `identifier` is the username, or the account's friend code as an alias. */
export async function authenticate(identifier: string, password: string): Promise<AuthResult> {
  if (!identifier.trim() || !password) {
    return { ok: false, error: "Enter your username and password." };
  }
  const result = await apiRequest<{ user: ServerUser }>("/login", {
    method: "POST",
    body: { identifier: identifier.trim(), password },
  });
  if (!result.ok) return { ok: false, error: result.error.message, code: result.error.code };
  return { ok: true, account: toProfile(result.data.user) };
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
  return { ok: true, account: toProfile(result.data.user) };
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<AuthResult> {
  const passwordError = validatePassword(newPassword);
  if (passwordError) return { ok: false, error: passwordError };
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
