/*
 * CrystalOS — Proton session storage
 *
 * CrystalOS never asks for a Proton password and never implements Proton's SRP
 * login. Doing either would mean re-implementing an authentication protocol
 * (Proton's password proof needs bcrypt with a Proton-specific base64 alphabet)
 * from scratch, which is exactly the kind of invented crypto this integration
 * must not contain.
 *
 * What it stores instead is a Proton **session**: the `uid` and
 * `accessToken`/`refreshToken` pair that Proton's own clients — including the
 * extension shipped in this repository — use for every authenticated call.
 * The user obtains it from their own Proton account and pastes it into CrystalOS
 * once; from then on CrystalOS refreshes it through `auth/refresh`, the same
 * call the extension makes.
 *
 * The file lives under server/vpn/data/, is written with owner-only mode where
 * the platform honours it, is never served by the HTTP layer, and is never
 * included in a log line or an API response. Only `hasSession()` and the token
 * *expiry* are ever surfaced.
 */

import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

/** Where the session lives. Overridable so tests never touch the real file. */
export function defaultSessionFile() {
  return resolve(process.env.CRESCENT_VPN_SESSION_FILE ?? join(here, "data", "proton-session.json"));
}

/**
 * Keeps only the fields Proton's own Session type uses.
 *
 * A uid and a refresh token are both mandatory. Proton rotates the refresh
 * token on every use and the access token is short-lived, so a session without
 * one would be unusable within the hour with no way to recover — accepting it
 * would mean offering a sign-in that fails a few requests later. An access
 * token on its own is optional: the controller refreshes it on first use.
 */
function normalise(value) {
  if (!value || typeof value !== "object") return null;
  const uid = typeof value.uid === "string" ? value.uid.trim() : "";
  const accessToken = typeof value.accessToken === "string" ? value.accessToken.trim() : "";
  const refreshToken = typeof value.refreshToken === "string" ? value.refreshToken.trim() : "";
  if (!uid || !refreshToken) return null;
  return {
    uid,
    accessToken,
    refreshToken,
    redirectURI: typeof value.redirectURI === "string" ? value.redirectURI : "https://protonvpn.com",
    updatedAt: Number(value.updatedAt) || Date.now(),
  };
}

export function createSessionStore({ file = defaultSessionFile() } = {}) {
  let cached = null;
  let loaded = false;

  async function load() {
    if (loaded) return cached;
    loaded = true;
    try {
      cached = normalise(JSON.parse(await readFile(file, "utf8")));
    } catch {
      // Missing, unreadable or corrupt: "no session" is the honest answer, and
      // it must never be a crash that stops the backend from starting.
      cached = null;
    }
    return cached;
  }

  /** Writes atomically and drops group/other permissions where supported. */
  async function save(session) {
    const next = normalise(session);
    if (!next) {
      // Named precisely: this message is shown to whoever is signing in, and
      // "missing a token" would send them looking for the wrong one.
      const uid = typeof session?.uid === "string" ? session.uid.trim() : "";
      throw new Error(
        uid
          ? "That session has no refresh token. Proton rotates it on every use, so it is required."
          : "That session has no uid.",
      );
    }
    next.updatedAt = Date.now();
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    await rename(temporary, file);
    // Windows ignores mode on create; chmod is best-effort there and exact on
    // POSIX, where this file would otherwise be world-readable.
    await chmod(file, 0o600).catch(() => undefined);
    cached = next;
    loaded = true;
    return next;
  }

  async function clear() {
    cached = null;
    loaded = true;
    await rm(file, { force: true }).catch(() => undefined);
  }

  return {
    file,
    load,
    save,
    clear,
    /** The session, or null. Never returns anything a caller should log. */
    current: () => cached,
    /** Non-secret facts about the session, safe for an API response. */
    async describe() {
      const session = await load();
      if (!session) return { signedIn: false, uid: null, updatedAt: null };
      return { signedIn: true, uid: session.uid, updatedAt: session.updatedAt };
    },
  };
}
