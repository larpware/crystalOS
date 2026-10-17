/*
 * CrystalOS — accounts API tests
 *
 * Run with `npm run test:accounts` (or `node --test server/accounts/api.test.mjs`).
 *
 * These exercise the real HTTP API against a throwaway SQLite file, through the
 * same code path the browser uses. Nothing is mocked: sessions are real
 * cookies, hashes are real scrypt digests, and the uniqueness guarantees come
 * from the database constraints.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccountsApi } from "./api.mjs";
import { openAccountsStore } from "./db.mjs";

let tempDir;
let dbFile;
let store;
let server;
let base;

function startServer(api) {
  const httpServer = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    void api.handle(req, res, url).then((handled) => {
      if (!handled && !res.headersSent) {
        res.writeHead(404).end();
      }
    });
  });
  return new Promise((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => {
      const { port } = httpServer.address();
      resolve({ httpServer, url: `http://127.0.0.1:${port}` });
    });
  });
}

/** `close()` alone waits for keep-alive sockets; drop them first. */
function stopServer(httpServer) {
  httpServer.closeAllConnections();
  return new Promise((resolve) => httpServer.close(resolve));
}

/** A tiny cookie-jar HTTP client, one per simulated browser. */
function makeClient(beginAt) {
  const jar = new Map();
  const client = {
    cookie() {
      return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    },
    async request(method, path, body) {
      const headers = { "content-type": "application/json" };
      if (jar.size) headers.cookie = client.cookie();
      const response = await fetch(beginAt + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(";");
        const index = pair.indexOf("=");
        const name = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        if (value === "") jar.delete(name);
        else jar.set(name, value);
      }
      const text = await response.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      return { status: response.status, body: json, text };
    },
    get(path) {
      return client.request("GET", path);
    },
    post(path, body) {
      return client.request("POST", path, body ?? {});
    },
    patch(path, body) {
      return client.request("PATCH", path, body ?? {});
    },
    del(path, body) {
      return client.request("DELETE", path, body);
    },
  };
  return client;
}

const CODE_PATTERN = /^CR-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

async function register(client, username, password = "correct-horse") {
  return client.post("/api/accounts/register", {
    username,
    displayName: `${username[0].toUpperCase()}${username.slice(1)}`,
    password,
  });
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "crescent-accounts-"));
  dbFile = join(tempDir, "accounts.db");
  store = openAccountsStore({ file: dbFile });
  // Every simulated client shares the loopback address, so the per-address
  // limits are widened here. The dedicated rate-limit test below starts its own
  // server with realistic limits.
  const api = createAccountsApi({
    store,
    limits: {
      register: { windowMs: 60_000, max: 500 },
      login: { windowMs: 60_000, max: 500 },
      friendRequest: { windowMs: 60_000, max: 500 },
      message: { windowMs: 60_000, max: 5000 },
    },
  });
  ({ httpServer: server, url: base } = await startServer(api));
});

after(async () => {
  await stopServer(server);
  store.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("accounts API", () => {
  it("registers two accounts and gives each a different server-generated friend code", async () => {
    const alice = makeClient(base);
    const bob = makeClient(base);

    const first = await register(alice, "alice");
    const second = await register(bob, "bob");

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.match(first.body.user.friendCode, CODE_PATTERN, "code format");
    assert.match(second.body.user.friendCode, CODE_PATTERN, "code format");
    assert.notEqual(first.body.user.friendCode, second.body.user.friendCode);
    // The code is not derived from anything the user picked.
    assert.ok(!first.body.user.friendCode.includes("ALICE"));
    // No secrets ever leave the server.
    assert.equal(first.body.user.passwordHash, undefined);
    assert.equal(first.body.user.password_salt, undefined);
  });

  it("rejects duplicate usernames", async () => {
    const client = makeClient(base);
    const response = await register(client, "alice");
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, "USERNAME_TAKEN");
  });

  it("validates usernames and passwords", async () => {
    const client = makeClient(base);
    const short = await register(client, "ab");
    assert.equal(short.status, 400);
    assert.equal(short.body.error.code, "INVALID_USERNAME");

    const weak = await client.post("/api/accounts/register", {
      username: "weakpass",
      password: "1234",
    });
    assert.equal(weak.status, 400);
    assert.equal(weak.body.error.code, "INVALID_PASSWORD");
  });

  it("refuses to let a client choose a friend code, on registration and on update", async () => {
    const client = makeClient(base);
    const forged = "CR-ZZZZ-ZZZZ";

    const onRegister = await client.post("/api/accounts/register", {
      username: "forger",
      displayName: "Forger",
      password: "correct-horse",
      friendCode: forged,
    });
    assert.equal(onRegister.status, 400);
    assert.equal(onRegister.body.error.code, "FRIEND_CODE_IMMUTABLE");

    const created = await register(client, "forger");
    assert.equal(created.status, 201);
    const original = created.body.user.friendCode;
    assert.match(original, CODE_PATTERN);

    for (const attempt of [
      await client.patch("/api/accounts/me", { friendCode: forged }),
      await client.patch("/api/accounts/me", { friendCode: original }),
      await client.patch("/api/accounts/me", { friendCode: "" }),
      await client.post("/api/accounts/me/password", { currentPassword: "correct-horse", newPassword: "another-good-one", friendCode: forged }),
    ]) {
      assert.equal(attempt.status, 400, `${attempt.status} ${attempt.text}`);
      assert.equal(attempt.body.error.code, "FRIEND_CODE_IMMUTABLE");
    }

    const after = await client.get("/api/accounts/me");
    assert.equal(after.body.user.friendCode, original, "friend code is unchanged");
    // The only way to look one up is by code; there is no write path at all.
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM users WHERE friend_code = ?").get(forged).n, 0);
  });

  it("signs in, signs out and signs back in", async () => {
    const client = makeClient(base);
    await register(client, "session_user", "pass-phrase-1");

    const wrong = await client.post("/api/accounts/login", { username: "session_user", password: "nope" });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error.code, "INVALID_CREDENTIALS");

    const out = await client.post("/api/accounts/logout");
    assert.equal(out.status, 200);
    const afterSignOut = await client.get("/api/accounts/me");
    assert.equal(afterSignOut.status, 200);
    assert.equal(afterSignOut.body.user, null);

    const backIn = await client.post("/api/accounts/login", { username: "session_user", password: "pass-phrase-1" });
    assert.equal(backIn.status, 200);
    assert.match(backIn.body.user.friendCode, CODE_PATTERN);

    // Case-insensitive username, and the friend code works as an alias.
    const other = makeClient(base);
    const byCode = await other.post("/api/accounts/login", {
      username: backIn.body.user.friendCode.toLowerCase(),
      password: "pass-phrase-1",
    });
    assert.equal(byCode.status, 200);
    assert.equal(byCode.body.user.id, backIn.body.user.id);
  });

  it("requires a session for every protected endpoint", async () => {
    const anon = makeClient(base);
    for (const [method, path] of [
      ["GET", "/api/accounts/sync"],
      ["PATCH", "/api/accounts/me"],
      ["DELETE", "/api/accounts/me"],
      ["POST", "/api/accounts/me/password"],
      ["POST", "/api/accounts/friend-requests"],
      ["POST", "/api/accounts/friend-requests/whatever/accept"],
      ["DELETE", "/api/accounts/friends/usr_1"],
      ["GET", "/api/accounts/conversations/usr_1/messages"],
      ["POST", "/api/accounts/conversations/usr_1/messages"],
    ]) {
      const response = await anon.request(method, path, method === "GET" ? undefined : {});
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.equal(response.body.error.code, "NOT_SIGNED_IN");
    }
  });

  it("rejects malformed, unknown and self-addressed friend codes", async () => {
    const client = makeClient(base);
    const me = await register(client, "codehunter");

    const garbage = await client.post("/api/accounts/friend-requests", { code: "hello there" });
    assert.equal(garbage.status, 400);
    assert.equal(garbage.body.error.code, "FRIEND_CODE_INVALID");

    const missing = await client.post("/api/accounts/friend-requests", { code: "CR-2222-2222" });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, "FRIEND_CODE_NOT_FOUND");

    const self = await client.post("/api/accounts/friend-requests", { code: me.body.user.friendCode });
    assert.equal(self.status, 400);
    assert.equal(self.body.error.code, "SELF_REQUEST");

    // A wrong-looking code never leaks whether an account exists.
    assert.equal(missing.body.error.message.includes("alice"), false);
  });

  it("accepts a friend code with different spacing and letter case", async () => {
    const alice = makeClient(base);
    const bob = makeClient(base);
    const a = await register(alice, "casey");
    const b = await register(bob, "dana");

    const messy = `  ${b.body.user.friendCode.toLowerCase().replace(/-/g, " ")}  `;
    const response = await alice.post("/api/accounts/friend-requests", { code: messy });
    assert.equal(response.status, 201, response.text);
    assert.equal(response.body.request.to.id, b.body.user.id);
    assert.equal(response.body.request.to.friendCode, b.body.user.friendCode, "display form is canonical");
    // The stored code itself is untouched by the messy lookup.
    const stored = await bob.get("/api/accounts/me");
    assert.equal(stored.body.user.friendCode, b.body.user.friendCode);
    // A different separator style resolves to the same account, and the
    // duplicate rules still apply.
    const dashed = `cr${b.body.user.friendCode.slice(2).split("-").join(".")}`;
    const duplicate = await alice.post("/api/accounts/friend-requests", { code: dashed });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, "REQUEST_ALREADY_SENT");
    // Bob can still be found by Alice's canonical code the other way round.
    const accepted = await bob.post(`/api/accounts/friend-requests/${response.body.request.id}/accept`);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.friend.id, a.body.user.id);
  });

  it("runs the full request/accept/friendship flow and blocks the duplicates", async () => {
    const alice = makeClient(base);
    const bob = makeClient(base);
    const a = await register(alice, "pat");
    const b = await register(bob, "quinn");
    const aliceCode = a.body.user.friendCode;
    const bobCode = b.body.user.friendCode;

    const sent = await alice.post("/api/accounts/friend-requests", { code: bobCode });
    assert.equal(sent.status, 201);
    const requestId = sent.body.request.id;

    const duplicate = await alice.post("/api/accounts/friend-requests", { code: bobCode });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, "REQUEST_ALREADY_SENT");

    const reverse = await bob.post("/api/accounts/friend-requests", { code: aliceCode });
    assert.equal(reverse.status, 409);
    assert.equal(reverse.body.error.code, "REQUEST_ALREADY_RECEIVED");

    const snapshot = await bob.get("/api/accounts/sync?since=0");
    assert.equal(snapshot.body.incoming.length, 1);
    assert.equal(snapshot.body.incoming[0].from.id, a.body.user.id);
    assert.equal(snapshot.body.incoming[0].from.friendCode, aliceCode);
    // Searching by code must not leak anything private.
    assert.equal(snapshot.body.incoming[0].from.passwordHash, undefined);
    assert.equal(snapshot.body.incoming[0].from.password_salt, undefined);

    const accepted = await bob.post(`/api/accounts/friend-requests/${requestId}/accept`);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.friend.id, a.body.user.id);

    const aliceSnapshot = await alice.get("/api/accounts/sync?since=0");
    const bobSnapshot = await bob.get("/api/accounts/sync?since=0");
    assert.deepEqual(aliceSnapshot.body.friends.map((f) => f.id), [b.body.user.id]);
    assert.deepEqual(bobSnapshot.body.friends.map((f) => f.id), [a.body.user.id]);
    assert.equal(aliceSnapshot.body.incoming.length, 0);
    assert.equal(aliceSnapshot.body.outgoing.length, 0);

    const again = await alice.post("/api/accounts/friend-requests", { code: bobCode });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, "ALREADY_FRIENDS");
  });

  it("stops people answering, cancelling or deleting other people's requests", async () => {
    const alice = makeClient(base);
    const bob = makeClient(base);
    const mallory = makeClient(base);
    const a = await register(alice, "rita");
    const b = await register(bob, "sam");
    await register(mallory, "trudy");

    const sent = await alice.post("/api/accounts/friend-requests", { code: b.body.user.friendCode });
    const requestId = sent.body.request.id;

    // Mallory cannot accept or decline a request that is not addressed to her.
    const stolen = await mallory.post(`/api/accounts/friend-requests/${requestId}/accept`);
    assert.equal(stolen.status, 403);
    assert.equal(stolen.body.error.code, "NOT_YOUR_REQUEST");
    const declinedByStranger = await mallory.post(`/api/accounts/friend-requests/${requestId}/decline`);
    assert.equal(declinedByStranger.status, 403);
    // Nor can she cancel someone else's outgoing request.
    const cancelledByStranger = await mallory.del(`/api/accounts/friend-requests/${requestId}`);
    assert.equal(cancelledByStranger.status, 403);

    // The recipient may decline; a declined request can be sent again.
    const declined = await bob.post(`/api/accounts/friend-requests/${requestId}/decline`);
    assert.equal(declined.status, 200);
    const resent = await alice.post("/api/accounts/friend-requests", { code: b.body.user.friendCode });
    assert.equal(resent.status, 201);

    // The sender may cancel their own outgoing request.
    const cancelled = await alice.del(`/api/accounts/friend-requests/${resent.body.request.id}`);
    assert.equal(cancelled.status, 200);
    const afterCancel = await bob.get("/api/accounts/sync?since=0");
    assert.equal(afterCancel.body.incoming.length, 0);

    // And nobody can remove a friendship they are not part of.
    const friendless = await mallory.del(`/api/accounts/friends/${a.body.user.id}`);
    assert.equal(friendless.status, 404);
    assert.equal(friendless.body.error.code, "NOT_FRIENDS");
  });

  it("only lets a user change their own profile, never the friend code or someone else's account", async () => {
    const alice = makeClient(base);
    const bob = makeClient(base);
    const a = await register(alice, "uma");
    const b = await register(bob, "vic");

    const patched = await alice.patch("/api/accounts/me", { displayName: "Uma N.", bio: "hello", id: b.body.user.id });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.user.id, a.body.user.id, "the session user is patched, not the id in the body");
    assert.equal(patched.body.user.displayName, "Uma N.");
    assert.equal(patched.body.user.friendCode, a.body.user.friendCode);

    const bobStill = await bob.get("/api/accounts/me");
    assert.equal(bobStill.body.user.displayName, "Vic");
    assert.equal(bobStill.body.user.bio, undefined);

    const takenUsername = await alice.patch("/api/accounts/me", { username: "vic" });
    assert.equal(takenUsername.status, 409);
    assert.equal(takenUsername.body.error.code, "USERNAME_TAKEN");

    const wrongPassword = await alice.post("/api/accounts/me/password", {
      currentPassword: "not-it",
      newPassword: "a-fresh-secret",
    });
    assert.equal(wrongPassword.status, 403);
    const changed = await alice.post("/api/accounts/me/password", {
      currentPassword: "correct-horse",
      newPassword: "a-fresh-secret",
    });
    assert.equal(changed.status, 200);
    const relogin = await alice.post("/api/accounts/login", { username: "uma", password: "a-fresh-secret" });
    assert.equal(relogin.status, 200);
  });

  it("delivers direct messages between friends and keeps conversations private", async () => {
    const alice = makeClient(base);
    const bob = makeClient(base);
    const mallory = makeClient(base);
    const a = await register(alice, "wendy");
    const b = await register(bob, "xander");
    const m = await register(mallory, "yolanda");

    const notFriends = await alice.post(`/api/accounts/conversations/${b.body.user.id}/messages`, { body: "hi" });
    assert.equal(notFriends.status, 403);
    assert.equal(notFriends.body.error.code, "NOT_FRIENDS");

    const self = await alice.post(`/api/accounts/conversations/${a.body.user.id}/messages`, { body: "hi me" });
    assert.equal(self.status, 400);
    assert.equal(self.body.error.code, "SELF_CONVERSATION");

    const request = await alice.post("/api/accounts/friend-requests", { code: b.body.user.friendCode });
    await bob.post(`/api/accounts/friend-requests/${request.body.request.id}/accept`);

    const since = Date.now() - 1000;
    const sent = await alice.post(`/api/accounts/conversations/${b.body.user.id}/messages`, {
      body: "  hello Bob  ",
      clientId: "msg_testclientid_0001",
    });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.message.body, "hello Bob", "bodies are trimmed");
    assert.equal(sent.body.conversationId, `dm_${[a.body.user.id, b.body.user.id].sort().join("__")}`);

    // A retried send with the same client id must not duplicate.
    await alice.post(`/api/accounts/conversations/${b.body.user.id}/messages`, {
      body: "  hello Bob  ",
      clientId: "msg_testclientid_0001",
    });

    const bobSync = await bob.get(`/api/accounts/sync?since=${since}`);
    assert.equal(bobSync.body.messages.length, 1, "one delivery, no duplicate");
    assert.equal(bobSync.body.messages[0].message.body, "hello Bob");
    assert.equal(bobSync.body.messages[0].peer.id, a.body.user.id);

    const history = await bob.get(`/api/accounts/conversations/${a.body.user.id}/messages`);
    assert.equal(history.body.messages.length, 1);
    assert.equal(history.body.messages[0].authorId, a.body.user.id);

    // Mallory is not in the thread: she cannot see it, and her own lookup finds
    // no conversation with Alice at all.
    const malloryHistory = await mallory.get(`/api/accounts/conversations/${a.body.user.id}/messages`);
    assert.equal(malloryHistory.status, 200);
    assert.deepEqual(malloryHistory.body.messages, []);
    const mallorySend = await mallory.post(`/api/accounts/conversations/${a.body.user.id}/messages`, { body: "let me in" });
    assert.equal(mallorySend.status, 403);

    // Removing a friend closes the channel in both directions.
    await alice.del(`/api/accounts/friends/${b.body.user.id}`);
    const afterRemoval = await alice.post(`/api/accounts/conversations/${b.body.user.id}/messages`, { body: "still there?" });
    assert.equal(afterRemoval.status, 403);
    const gone = await bob.get("/api/accounts/sync?since=0");
    assert.equal(gone.body.friends.length, 0);
  });

  it("survives a restart: accounts, codes and friendships persist in SQLite", async () => {
    const alice = makeClient(base);
    const bob = makeClient(base);
    const a = await register(alice, "zoe");
    const b = await register(bob, "abe");
    const request = await alice.post("/api/accounts/friend-requests", { code: b.body.user.friendCode });
    await bob.post(`/api/accounts/friend-requests/${request.body.request.id}/accept`);

    // Reopen the database from the same file and serve from that connection,
    // exactly as a server restart would.
    const reopenedDb = openAccountsStore({ file: dbFile });
    const restarted = createAccountsApi({ store: reopenedDb });
    const { httpServer, url } = await startServer(restarted);

    try {
      const freshClient = makeClient(url);
      const login = await freshClient.post("/api/accounts/login", { username: "zoe", password: "correct-horse" });
      assert.equal(login.status, 200);
      assert.equal(login.body.user.friendCode, a.body.user.friendCode, "friend code is stable across restarts");

      const snapshot = await freshClient.get("/api/accounts/sync?since=0");
      assert.deepEqual(snapshot.body.friends.map((f) => f.id), [b.body.user.id], "friendship survived");

      const otherWindow = makeClient(url);
      const otherLogin = await otherWindow.post("/api/accounts/login", { username: "abe", password: "correct-horse" });
      assert.equal(otherLogin.status, 200);
      assert.equal(otherLogin.body.user.friendCode, b.body.user.friendCode);
    } finally {
      await stopServer(httpServer);
      reopenedDb.close();
    }
  });

  it("rejects an expired session and forgets it", async () => {
    const alice = makeClient(base);
    await register(alice, "expiring");
    assert.equal((await alice.get("/api/accounts/me")).body.user.username, "expiring");

    // Age this account's session past its expiry, exactly as a 30-day-old
    // cookie would be. Only this account is touched.
    const sessionCount = () =>
      Number(
        store.db
          .prepare(
            "SELECT COUNT(*) AS n FROM sessions WHERE user_id = (SELECT id FROM users WHERE username_lower = 'expiring')",
          )
          .get().n,
      );
    assert.equal(sessionCount(), 1);
    store.db
      .prepare(
        "UPDATE sessions SET expires_at = ? WHERE user_id = (SELECT id FROM users WHERE username_lower = 'expiring')",
      )
      .run(Date.now() - 1000);

    const after = await alice.get("/api/accounts/me");
    assert.equal(after.status, 200);
    assert.equal(after.body.user, null, "an expired cookie is not a session");
    assert.equal(sessionCount(), 0, "the expired row is dropped when it is presented");

    // And the account itself is untouched: the password still works.
    const backIn = await alice.post("/api/accounts/login", { username: "expiring", password: "correct-horse" });
    assert.equal(backIn.status, 200);
    assert.equal(sessionCount(), 1);
  });

  it("rate limits repeated registration attempts", async () => {
    const smallDir = mkdtempSync(join(tmpdir(), "crescent-accounts-rl-"));
    const smallStore = openAccountsStore({ file: join(smallDir, "rl.db") });
    const api = createAccountsApi({
      store: smallStore,
      limits: {
        register: { windowMs: 60_000, max: 3 },
        login: { windowMs: 60_000, max: 500 },
        friendRequest: { windowMs: 60_000, max: 500 },
        message: { windowMs: 60_000, max: 500 },
      },
    });
    const { httpServer, url } = await startServer(api);
    try {
      const statuses = [];
      for (let index = 0; index < 5; index += 1) {
        const client = makeClient(url);
        const response = await register(client, `burst${index}`);
        statuses.push(response.status);
      }
      assert.deepEqual(statuses.slice(0, 3), [201, 201, 201]);
      assert.deepEqual(statuses.slice(3), [429, 429]);
    } finally {
      await stopServer(httpServer);
      smallStore.close();
      rmSync(smallDir, { recursive: true, force: true });
    }
  });

  it("deletes an account with its password and cascades its data away", async () => {
    const alice = makeClient(base);
    const bob = makeClient(base);
    await register(alice, "deleter");
    const b = await register(bob, "keeper");
    const request = await alice.post("/api/accounts/friend-requests", { code: b.body.user.friendCode });
    await bob.post(`/api/accounts/friend-requests/${request.body.request.id}/accept`);

    const wrong = await alice.del("/api/accounts/me", { password: "nope" });
    assert.equal(wrong.status, 403);
    const deleted = await alice.del("/api/accounts/me", { password: "correct-horse" });
    assert.equal(deleted.status, 200);
    assert.equal(await alice.get("/api/accounts/me").then((r) => r.body.user), null);

    const bobSnapshot = await bob.get("/api/accounts/sync?since=0");
    assert.equal(bobSnapshot.body.friends.length, 0);
    assert.equal(bobSnapshot.body.incoming.length, 0);
  });
});
