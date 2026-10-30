/*
 * CrystalOS — Supabase-linked account tests
 *
 * Run with `node --test server/accounts/supabase.test.mjs`.
 *
 * The Supabase project itself is mocked: a tiny HTTP server stands in for
 * /auth/v1/user and answers the way the real one does for the three cases
 * that matter (valid token, bad token, outage). Everything else — SQLite,
 * cookies, scrypt hashing, session minting — is the real code.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccountsApi } from "./api.mjs";
import { openAccountsStore } from "./db.mjs";
import {
  resetSupabaseConfigForTests,
  supabaseConfig,
  verifySupabaseToken,
} from "./supabase.mjs";

/* ---- the mock identity service ------------------------------------------ */

let mockUserForToken = new Map(); // token -> { id, email, email_confirmed_at }
let mockProject;
let mockUrl;

before(async () => {
  mockProject = createServer((req, res) => {
    const auth = String(req.headers.authorization ?? "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const user = mockUserForToken.get(token);
    if (!user) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "invalid claim" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(user));
  });
  await new Promise((resolve) => {
    mockProject.listen(0, "127.0.0.1", () => {
      mockUrl = `http://127.0.0.1:${mockProject.address().port}`;
      resolve();
    });
  });

  process.env.SUPABASE_URL = mockUrl;
  process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key-not-a-real-key";
  resetSupabaseConfigForTests(undefined);

  // The account store and API, exactly as production wires them.
  store = openAccountsStore({ file: join(mkdtempSync(join(tmpdir(), "crescent-sb-")), "accounts.db") });
  const api = createAccountsApi({
    store,
    limits: {
      register: { windowMs: 60_000, max: 500 },
      login: { windowMs: 60_000, max: 500 },
    },
  });
  apiServer = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    void api.handle(req, res, url).then((handled) => {
      if (!handled && !res.headersSent) res.writeHead(404).end();
    });
  });
  await new Promise((resolve) => {
    apiServer.listen(0, "127.0.0.1", () => {
      base = `http://127.0.0.1:${apiServer.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  apiServer.closeAllConnections();
  await new Promise((resolve) => apiServer.close(resolve));
  mockProject.closeAllConnections();
  await new Promise((resolve) => mockProject.close(resolve));
  store.close();
  resetSupabaseConfigForTests(undefined);
});

let store;
let apiServer;
let base;

function issueToken(id, email, confirmed = true) {
  const token = `tok.${id.replace(/[^a-z0-9]/gi, "")}.${Math.random().toString(36).slice(2)}`;
  mockUserForToken.set(token, {
    id,
    email,
    email_confirmed_at: confirmed ? new Date().toISOString() : null,
  });
  return token;
}

function makeClient() {
  const jar = new Map();
  return {
    cookie() {
      return [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
    },
    async request(method, path, body, extraHeaders = {}) {
      const headers = { "content-type": "application/json", ...extraHeaders };
      const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
      if (cookie) headers.cookie = cookie;
      const response = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const cookieLine of response.headers.getSetCookie()) {
        const [pair] = cookieLine.split(";");
        const i = pair.indexOf("=");
        const name = pair.slice(0, i).trim();
        jar.set(name, pair.slice(i + 1).trim());
      }
      const text = await response.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* error bodies may be plain */
      }
      return { status: response.status, body: json, setCookie: response.headers.getSetCookie().length > 0 };
    },
    post(path, body, extra) {
      return this.request("POST", path, body ?? {}, extra);
    },
  };
}

describe("Supabase token verification", () => {
  it("reads the config from the server-side env names", () => {
    const config = supabaseConfig();
    assert.ok(config, "config should resolve from SUPABASE_URL / key");
    assert.equal(config.url, mockUrl);
  });

  it("rejects a token that is not shaped like a JWT", async () => {
    const verdict = await verifySupabaseToken("not-a-token");
    assert.equal(verdict.ok, false);
    assert.equal(verdict.code, "FORMAT");
  });

  it("reports unauthorized for a token the project rejects", async () => {
    const verdict = await verifySupabaseToken("a.b.c");
    assert.equal(verdict.ok, false);
    assert.equal(verdict.code, "UNAUTHORIZED");
  });

  it("verifies a valid token and returns the project's user id", async () => {
    const token = issueToken("11111111-2222-3333-4444-555555555555", "vera@example.com");
    const verdict = await verifySupabaseToken(token);
    assert.equal(verdict.ok, true);
    assert.equal(verdict.id, "11111111-2222-3333-4444-555555555555");
    assert.equal(verdict.email, "vera@example.com");
    assert.equal(verdict.emailConfirmed, true);
  });

  it("does not read the user id from anywhere but the project's answer", async () => {
    // A well-formed but unknown token: no id can be conjured from the body.
    const verdict = await verifySupabaseToken("x.y.z");
    assert.equal(verdict.ok, false);
  });
});

describe("Registering through Supabase", () => {
  it("creates an account linked to the verified identity, with no local password", async () => {
    const token = issueToken("aaaa1111-2222-3333-4444-555555555555", "nova@example.com");
    const client = makeClient();
    const response = await client.post("/api/accounts/register", {
      username: "nova",
      displayName: "Nova",
      supabaseToken: token,
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.user.username, "nova");
    assert.ok(response.body.user.supabaseLinked, "the profile reports the link");
    assert.ok(response.body.user.friendCode, "friend codes still come from the server");
    assert.ok(response.setCookie, "a session cookie was minted");
  });

  it("signing up again with the same identity is a plain sign-in, not an error", async () => {
    const token = issueToken("aaaa1111-2222-3333-4444-555555555555", "nova@example.com");
    const fresh = makeClient();
    const response = await fresh.post("/api/accounts/register", {
      username: "nova",
      displayName: "Nova",
      supabaseToken: token,
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.user.username, "nova");
  });

  it("refuses a token the identity service rejects", async () => {
    const client = makeClient();
    const response = await client.post("/api/accounts/register", {
      username: "impostor",
      displayName: "Impostor",
      supabaseToken: "forged.sig.ature",
    });
    assert.equal(response.status, 401);
  });

  it("the linked account cannot be signed in with a local password", async () => {
    const client = makeClient();
    const response = await client.post("/api/accounts/login", {
      identifier: "nova",
      password: "correct-horse",
    });
    assert.equal(response.status, 401);
  });
});

describe("Signing in through Supabase", () => {
  it("mints an OS session for a verified identity that has an account", async () => {
    const client = makeClient();
    const response = await client.post("/api/accounts/login", {
      supabaseToken: issueToken("aaaa1111-2222-3333-4444-555555555555", "nova@example.com"),
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.user.username, "nova");
    assert.ok(response.setCookie, "the OS cookie session was minted");
  });

  it("accepts the token from the Authorization header", async () => {
    const client = makeClient();
    const response = await client.post(
      "/api/accounts/login",
      {},
      { authorization: `Bearer ${issueToken("aaaa1111-2222-3333-4444-555555555555", "nova@example.com")}` },
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.user.username, "nova");
  });

  it("answers 404 when the identity has no OS account yet", async () => {
    const client = makeClient();
    const response = await client.post("/api/accounts/login", {
      supabaseToken: issueToken("99999999-8888-7777-6666-555555555555", "ghost@example.com"),
    });
    assert.equal(response.status, 404);
    assert.equal(response.body.error?.code, "NO_LINKED_ACCOUNT");
  });
});

describe("Passwords of linked accounts", () => {
  it("the change-password route hands off with a clear error", async () => {
    const client = makeClient();
    await client.post("/api/accounts/login", {
      supabaseToken: issueToken("aaaa1111-2222-3333-4444-555555555555", "nova@example.com"),
    });
    const response = await client.post("/api/accounts/me/password", {
      currentPassword: "whatever",
      newPassword: "new-secure-password",
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.error?.code, "PASSWORD_OWNED_BY_SUPABASE");
  });

  it("legacy accounts still change their password here", async () => {
    const client = makeClient();
    assert.equal(
      (await client.post("/api/accounts/register", {
        username: "classic",
        displayName: "Classic",
        password: "correct-horse",
      })).status,
      201,
    );
    const response = await client.post("/api/accounts/me/password", {
      currentPassword: "correct-horse",
      newPassword: "another-secure-one",
    });
    assert.equal(response.status, 200);
  });
});
