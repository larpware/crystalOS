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
import { tagsOf } from "./tags.mjs";
import { RARITY_TOTAL_WEIGHT } from "./rarity.mjs";

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
    put(path, body) {
      return client.request("PUT", path, body ?? {});
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
  // Named moderation authority, so tests that need an administrator do not
  // depend on registration order. Read by createAccountsApi per instance.
  process.env.CRESCENT_ADMINS = "moderator";
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
      socialPost: { windowMs: 60_000, max: 500 },
      socialComment: { windowMs: 60_000, max: 500 },
      socialAction: { windowMs: 60_000, max: 2000 },
    },
  });
  ({ httpServer: server, url: base } = await startServer(api));
});

after(async () => {
  await stopServer(server);
  store.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Crystal Social", () => {
  it("a post is created, edited, liked, commented on and deleted — by the right people only", async () => {
    const cara = makeClient(base);
    const dan = makeClient(base);
    assert.equal((await register(cara, "cara")).status, 201);
    assert.equal((await register(dan, "dan")).status, 201);

    const created = await cara.post("/api/accounts/posts", { body: "first post" });
    assert.equal(created.status, 201);
    const postId = created.body.post.id;
    assert.equal(created.body.post.body, "first post");
    assert.equal(created.body.post.likes, 0);

    // Dan can see it in his feed and like it.
    const feed = await dan.get("/api/accounts/feed");
    assert.equal(feed.status, 200);
    assert.ok(feed.body.feed.posts.some((p) => p.id === postId));
    const like = await dan.post(`/api/accounts/posts/${postId}/like`);
    assert.equal(like.body.liked, true);
    const again = await dan.post(`/api/accounts/posts/${postId}/like`);
    assert.equal(again.body.liked, false, "a second like is refused, not double-counted");
    await dan.post(`/api/accounts/posts/${postId}/like`);

    // A comment notifies the author and is counted.
    const comment = await dan.post(`/api/accounts/posts/${postId}/comments`, { body: "nice post" });
    assert.equal(comment.status, 201);
    const caraNotifications = await cara.get("/api/accounts/notifications");
    assert.ok(caraNotifications.body.notifications.some((n) => n.kind === "comment"));
    assert.ok(caraNotifications.body.notifications.some((n) => n.kind === "like"));

    // Only the author may edit; everyone else gets a refusal, not silence.
    const foreignEdit = await dan.patch(`/api/accounts/posts/${postId}`, { body: "hijacked" });
    assert.equal(foreignEdit.status, 403);
    const edit = await cara.patch(`/api/accounts/posts/${postId}`, { body: "first post, edited" });
    assert.equal(edit.status, 200);
    assert.equal(edit.body.post.body, "first post, edited");
    assert.ok(edit.body.post.editedAt, "an edit records that it was edited");

    // Only the author may delete; a deleted post disappears from feeds.
    assert.equal((await dan.del(`/api/accounts/posts/${postId}`)).status, 403);
    assert.equal((await cara.del(`/api/accounts/posts/${postId}`)).status, 200);
    const afterDelete = await dan.get(`/api/accounts/posts/${postId}`);
    assert.equal(afterDelete.status, 404);
  });

  it("enforces empty bodies, oversized images and unknown posts", async () => {
    const erin = makeClient(base);
    assert.equal((await register(erin, "erin")).status, 201);

    assert.equal((await erin.post("/api/accounts/posts", { body: "   " })).status, 400);
    assert.equal(
      (await erin.post("/api/accounts/posts", { body: "x", image: "data:text/html;base64,PHNjcmlwdD4=" })).status,
      400,
      "non-image data URLs are refused",
    );
    assert.equal((await erin.get("/api/accounts/posts/pst_missing")).status, 404);
  });

  it("a private account's posts stay hidden until a follow is accepted", async () => {
    const fay = makeClient(base);
    const gus = makeClient(base);
    assert.equal((await register(fay, "fay")).status, 201);
    assert.equal((await register(gus, "gus")).status, 201);

    // Fay turns her account private.
    assert.equal((await fay.patch("/api/accounts/me", { privateAccount: true })).status, 200);
    const secret = await fay.post("/api/accounts/posts", { body: "followers only" });
    assert.equal(secret.status, 201);

    // Gus cannot see it — not in the feed, not by id, not on the profile.
    const gusFeed = await gus.get("/api/accounts/feed");
    assert.ok(!gusFeed.body.feed.posts.some((p) => p.body === "followers only"));
    assert.equal((await gus.get(`/api/accounts/posts/${secret.body.post.id}`)).status, 403);
    const gusProfilePosts = await gus.get("/api/accounts/users/fay/posts");
    assert.deepEqual(gusProfilePosts.body.posts, [], "a private profile shows no posts to strangers");

    // Following is a request, not a done deal.
    const follow = await gus.post("/api/accounts/users/fay/follow");
    assert.equal(follow.body.pending, true);
    assert.equal(follow.body.following, false);
    const pending = await fay.get("/api/accounts/follow-requests");
    const gusRow = pending.body.requests.find((r) => r.username === "gus");
    assert.ok(gusRow, "the follow request reaches the account owner");
    // Requests are addressed by the follower's id, which is what the list returns.
    assert.equal(gusRow.id, (await gus.get("/api/accounts/me")).body.user.id);

    // Declining removes the request and still grants nothing.
    const declined = await fay.post(`/api/accounts/follow-requests/${gusRow.id}/decline`);
    assert.equal(declined.status, 200);
    assert.equal((await gus.get(`/api/accounts/posts/${secret.body.post.id}`)).status, 403);
    assert.equal((await fay.get("/api/accounts/follow-requests")).body.requests.length, 0);

    // Asking again, then accepting, grants visibility.
    const second = await gus.post("/api/accounts/users/fay/follow");
    assert.equal(second.body.pending, true);
    const accepted = await fay.post(`/api/accounts/follow-requests/${gusRow.id}/accept`);
    assert.equal(accepted.status, 200);
    const nowVisible = await gus.get(`/api/accounts/posts/${secret.body.post.id}`);
    assert.equal(nowVisible.status, 200, "an accepted follow makes private posts visible");
  });

  it("a public account's follow is immediate and its posts are public", async () => {
    const hal = makeClient(base);
    const iris = makeClient(base);
    assert.equal((await register(hal, "hal")).status, 201);
    assert.equal((await register(iris, "iris")).status, 201);

    const post = await hal.post("/api/accounts/posts", { body: "hello world" });
    const follow = await iris.post("/api/accounts/users/hal/follow");
    assert.equal(follow.body.following, true, "following a public account is immediate");
    assert.equal(follow.body.pending, false);

    const profile = await iris.get("/api/accounts/users/hal");
    assert.equal(profile.body.profile.counts.followers, 1);
    assert.equal(profile.body.profile.relationship.following, "accepted");

    // Unfollow removes the follow.
    assert.equal((await iris.del("/api/accounts/users/hal/follow")).body.following, false);
    assert.equal((await iris.get("/api/accounts/users/hal")).body.profile.counts.followers, 0);
    assert.ok(post.status === 201);
  });

  it("blocking hides both directions and cannot target yourself", async () => {
    const jud = makeClient(base);
    const kim = makeClient(base);
    assert.equal((await register(jud, "jud")).status, 201);
    assert.equal((await register(kim, "kim")).status, 201);

    await jud.post("/api/accounts/posts", { body: "jud was here" });
    assert.equal((await jud.post("/api/accounts/users/kim/block")).body.blocked, true);

    // Neither can interact with the other's content now.
    const kimSeesJud = await kim.get("/api/accounts/users/jud");
    assert.equal(kimSeesJud.status, 403);
    const judFeed = await jud.get("/api/accounts/feed");
    assert.ok(judFeed.body.feed.posts.some((p) => p.body === "jud was here"), "own posts still visible to self");
    assert.equal((await kim.post("/api/accounts/users/jud/follow")).status, 403);
    assert.equal((await jud.post("/api/accounts/users/jud/block")).status, 400, "cannot block yourself");

    assert.equal((await jud.del("/api/accounts/users/kim/block")).body.blocked, false);
  });

  it("bookmarks are personal: one account's saved list is invisible to another", async () => {
    const lee = makeClient(base);
    const moe = makeClient(base);
    assert.equal((await register(lee, "lee")).status, 201);
    assert.equal((await register(moe, "moe")).status, 201);

    const post = await lee.post("/api/accounts/posts", { body: "worth saving" });
    assert.equal((await moe.post(`/api/accounts/posts/${post.body.post.id}/bookmark`)).body.bookmarked, true);
    const mine = await moe.get("/api/accounts/bookmarks");
    assert.ok(mine.body.posts.some((p) => p.id === post.body.post.id));
    const theirs = await lee.get("/api/accounts/bookmarks");
    assert.ok(!theirs.body.posts.some((p) => p.id === post.body.post.id));
  });

  it("reports reach the administrator and only the administrator", async () => {
    const ned = makeClient(base);
    const opa = makeClient(base);
    assert.equal((await register(ned, "ned")).status, 201);
    // "moderator" is named in CRESCENT_ADMINS by the test harness, so this
    // test does not depend on which account happened to register first.
    assert.equal((await register(opa, "moderator")).status, 201);

    const post = await ned.post("/api/accounts/posts", { body: "objectionable" });
    assert.equal(
      (await opa.post(`/api/accounts/posts/${post.body.post.id}/report`, { reason: "spam" })).status,
      201,
    );
    assert.equal(
      (await opa.post(`/api/accounts/posts/${post.body.post.id}/report`, { reason: "  " })).status,
      400,
      "a report without a reason is refused",
    );

    const reports = await opa.get("/api/accounts/reports");
    assert.equal(reports.status, 200);
    const report = reports.body.reports.find((r) => r.post_id === post.body.post.id);
    assert.ok(report, "the admin sees the open report");

    // An ordinary account does not.
    assert.equal((await ned.get("/api/accounts/reports")).status, 403);

    // Resolving with removal takes the post down.
    const resolve = await opa.post(`/api/accounts/reports/${report.id}/resolve`, {
      postId: post.body.post.id,
      removePost: true,
      resolution: "removed",
    });
    assert.equal(resolve.status, 200);
    assert.equal((await ned.get(`/api/accounts/posts/${post.body.post.id}`)).status, 404);
  });

  it("notifications stop reporting themselves once read", async () => {
    const nan = makeClient(base);
    const ola = makeClient(base);
    assert.equal((await register(nan, "nan")).status, 201);
    assert.equal((await register(ola, "ola")).status, 201);

    const post = await nan.post("/api/accounts/posts", { body: "notify me" });
    await ola.post(`/api/accounts/posts/${post.body.post.id}/like`);

    const unread = await nan.get("/api/accounts/notifications");
    assert.ok(unread.body.notifications.some((n) => n.kind === "like" && !n.readAt));
    assert.equal((await nan.post("/api/accounts/notifications")).status, 200);
    const read = await nan.get("/api/accounts/notifications");
    assert.ok(read.body.notifications.every((n) => n.readAt), "marking read sticks");
  });
});

describe("Crystal Chat servers", () => {
  it("a created server comes with an owner, a general channel, and its creator as owner", async () => {
    const rae = makeClient(base);
    const sam = makeClient(base);
    assert.equal((await register(rae, "srvrae")).status, 201);
    assert.equal((await register(sam, "srvsam")).status, 201);

    const created = await rae.post("/api/accounts/servers", {
      name: "Crystal HQ",
      description: "The main hall",
    });
    assert.equal(created.status, 201);
    const serverId = created.body.server.id;
    assert.equal(created.body.server.owner.username, "srvrae");
    assert.equal(created.body.server.isMember, true);
    assert.ok((created.body.server.myPermissions & 1) === 1, "owner holds MANAGE_SERVER");

    const detail = await rae.get(`/api/accounts/servers/${serverId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.channels.length, 1, "one general channel ships with the server");
    assert.equal(detail.body.channels[0].name, "general");
    assert.ok(detail.body.roles.some((r) => r.isOwner));
    assert.ok(detail.body.roles.some((r) => r.isDefault));

    // A stranger cannot read the server at all.
    assert.equal((await sam.get(`/api/accounts/servers/${serverId}`)).status, 403);
  });

  it("invites carry people in, and expiry/revocation/exhaustion carry them back out", async () => {
    const tam = makeClient(base);
    const uma = makeClient(base);
    assert.equal((await register(tam, "srvtam")).status, 201);
    assert.equal((await register(uma, "srvuma")).status, 201);

    const server = await tam.post("/api/accounts/servers", { name: "Invite Land" });
    const serverId = server.body.server.id;

    // Tam (owner) creates an invite with one use.
    const invite = await tam.post(`/api/accounts/servers/${serverId}/invites`, { maxUses: 1 });
    assert.equal(invite.status, 201);
    const code = invite.body.invite.code;

    // Uma joins with it.
    const joined = await uma.post(`/api/accounts/invites/${code}/join`);
    assert.equal(joined.status, 201);
    assert.equal(joined.body.alreadyMember, false);
    // Joining again is a no-op, not a duplicate membership.
    assert.equal((await uma.post(`/api/accounts/invites/${code}/join`)).body.alreadyMember, true);

    // A fresh account is refused: the one-use invite is spent.
    const vic = makeClient(base);
    assert.equal((await register(vic, "srvvic")).status, 201);
    const exhausted = await vic.post(`/api/accounts/invites/${code}/join`);
    assert.equal(exhausted.status, 410);

    // A revoked invite stops working.
    const second = await tam.post(`/api/accounts/servers/${serverId}/invites`, {});
    assert.equal((await tam.del(`/api/accounts/invites/${second.body.invite.code}`)).status, 200);
    assert.equal((await vic.post(`/api/accounts/invites/${second.body.invite.code}/join`)).status, 404);

    // Unknown codes are refused the same way.
    assert.equal((await vic.post(`/api/accounts/invites/DEADBEEF0000/join`)).status, 404);
  });

  it("permissions are enforced on the server: no send right means no message", async () => {
    const wren = makeClient(base);
    const xan = makeClient(base);
    assert.equal((await register(wren, "srvwren")).status, 201);
    assert.equal((await register(xan, "srvxan")).status, 201);

    const server = await wren.post("/api/accounts/servers", { name: "Read Only Club" });
    const serverId = server.body.server.id;
    const general = (await wren.get(`/api/accounts/servers/${serverId}`)).body.channels[0];

    // Wren makes a "Muted" role with no SEND_MESSAGES and gives it to Xan.
    const role = await wren.post(`/api/accounts/servers/${serverId}/roles`, { name: "Muted", permissions: 0 });
    assert.equal(role.status, 201);
    const xanId = (await xan.get("/api/accounts/me")).body.user.id;
    const invite = await wren.post(`/api/accounts/servers/${serverId}/invites`, {});
    await xan.post(`/api/accounts/invites/${invite.body.invite.code}/join`);
    assert.equal((await wren.put(`/api/accounts/servers/${serverId}/members/${xanId}/role`, { roleId: role.body.role.id })).status, 200);

    // Xan can read the channel but cannot post into it.
    assert.equal((await xan.get(`/api/accounts/channels/${general.id}/messages`)).status, 200);
    const refused = await xan.post(`/api/accounts/channels/${general.id}/messages`, { body: "let me in" });
    assert.equal(refused.status, 403);

    // Wren can.
    assert.equal((await wren.post(`/api/accounts/channels/${general.id}/messages`, { body: "welcome" })).status, 201);
  });

  it("nobody escalates: a member cannot grant what they lack or rank above themselves", async () => {
    const yuri = makeClient(base);
    const zoe = makeClient(base);
    assert.equal((await register(yuri, "srvyuri")).status, 201);
    assert.equal((await register(zoe, "srvzoe")).status, 201);

    const server = await yuri.post("/api/accounts/servers", { name: "Escalation Test" });
    const serverId = server.body.server.id;
    const zoeId = (await zoe.get("/api/accounts/me")).body.user.id;
    const invite = await yuri.post(`/api/accounts/servers/${serverId}/invites`, {});
    await zoe.post(`/api/accounts/invites/${invite.body.invite.code}/join`);

    // Zoe (plain member) cannot create roles, assign roles, or post settings.
    assert.equal((await zoe.post(`/api/accounts/servers/${serverId}/roles`, { name: "Admin" })).status, 403);
    assert.equal((await zoe.put(`/api/accounts/servers/${serverId}/members/${zoeId}/role`, { roleId: null })).status, 403);
    assert.equal((await zoe.patch(`/api/accounts/servers/${serverId}`, { name: "mine now" })).status, 403);
    assert.equal((await zoe.del(`/api/accounts/servers/${serverId}`)).status, 403);

    // Yuri cannot assign the owner role to anyone, not even as owner.
    const ownerRole = (await yuri.get(`/api/accounts/servers/${serverId}`)).body.roles.find((r) => r.isOwner);
    assert.equal(
      (await yuri.put(`/api/accounts/servers/${serverId}/members/${zoeId}/role`, { roleId: ownerRole.id })).status,
      403,
      "the owner role is never assignable",
    );
    // The owner cannot be kicked, and ownership only moves by the owner's own act.
    assert.equal((await zoe.del(`/api/accounts/servers/${serverId}/members/${(await yuri.get('/api/accounts/me')).body.user.id}`)).status, 403);
    assert.equal((await zoe.post(`/api/accounts/servers/${serverId}/transfer`, { username: "srvzoe" })).status, 403);
  });

  it("a private channel is invisible to roles without its permission", async () => {
    const ada = makeClient(base);
    const beau = makeClient(base);
    assert.equal((await register(ada, "srvada")).status, 201);
    assert.equal((await register(beau, "srvbeau")).status, 201);

    const server = await ada.post("/api/accounts/servers", { name: "Secret Room" });
    const serverId = server.body.server.id;
    const invite = await ada.post(`/api/accounts/servers/${serverId}/invites`, {});
    await beau.post(`/api/accounts/invites/${invite.body.invite.code}/join`);

    // MANAGE_MESSAGES (bit 4 = 16) gates the staff channel.
    const staff = await ada.post(`/api/accounts/servers/${serverId}/channels`, {
      name: "staff",
      requiresPermission: 16,
    });
    assert.equal(staff.status, 201);

    const beauView = await beau.get(`/api/accounts/servers/${serverId}`);
    assert.ok(!beauView.body.channels.some((c) => c.name === "staff"), "the channel is absent from listings");
    assert.equal((await beau.get(`/api/accounts/channels/${staff.body.channel.id}/messages`)).status, 403);
    assert.equal(
      (await beau.post(`/api/accounts/channels/${staff.body.channel.id}/messages`, { body: "peek" })).status,
      403,
      "reading and writing are both refused",
    );
  });

  it("the audit log is written by activity and read only by managers", async () => {
    const cai = makeClient(base);
    const dev = makeClient(base);
    assert.equal((await register(cai, "srvcai")).status, 201);
    assert.equal((await register(dev, "srvdev")).status, 201);

    const server = await cai.post("/api/accounts/servers", { name: "Audited" });
    const serverId = server.body.server.id;
    const invite = await cai.post(`/api/accounts/servers/${serverId}/invites`, {});
    await dev.post(`/api/accounts/invites/${invite.body.invite.code}/join`);
    await cai.post(`/api/accounts/servers/${serverId}/channels`, { name: "announcements" });

    const log = await cai.get(`/api/accounts/servers/${serverId}/audit`);
    assert.equal(log.status, 200);
    const actions = log.body.audit.map((entry) => entry.action);
    assert.ok(actions.includes("server.create"));
    assert.ok(actions.includes("member.join"));
    assert.ok(actions.includes("channel.create"));

    // A plain member cannot read it.
    assert.equal((await dev.get(`/api/accounts/servers/${serverId}/audit`)).status, 403);
  });

  it("ownership transfers, and the old owner keeps nothing but membership", async () => {
    const finn = makeClient(base);
    const gale = makeClient(base);
    assert.equal((await register(finn, "srvfinn")).status, 201);
    assert.equal((await register(gale, "srvgale")).status, 201);

    const server = await finn.post("/api/accounts/servers", { name: "Handover" });
    const serverId = server.body.server.id;
    const galeId = (await gale.get("/api/accounts/me")).body.user.id;
    const invite = await finn.post(`/api/accounts/servers/${serverId}/invites`, {});
    await gale.post(`/api/accounts/invites/${invite.body.invite.code}/join`);

    assert.equal((await finn.post(`/api/accounts/servers/${serverId}/transfer`, { username: "srvgale" })).status, 200);
    const after = await gale.get(`/api/accounts/servers/${serverId}`);
    assert.equal(after.body.server.owner.username, "srvgale");
    // The old owner is now an ordinary member and cannot delete the server.
    assert.equal((await finn.del(`/api/accounts/servers/${serverId}`)).status, 403);
    // The new owner can.
    assert.equal((await gale.del(`/api/accounts/servers/${serverId}`)).status, 200);
    assert.ok(galeId);
  });
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

describe("Store submissions", () => {
  it("queues a submission privately until a moderator approves it", async () => {
    const buyer = makeClient(base);
    const mod = makeClient(base);
    await register(buyer, "stbuyer1");
    // "moderator" was registered by the moderation test above with the
    // default password; log that client in to act as the reviewer.
    await mod.post("/api/accounts/login", { username: "moderator", password: "correct-horse" });

    const submitted = await buyer.post("/api/accounts/store/submit", {
      name: "Crystal Paint",
      description: "A tiny pixel-art studio that saves to Drive.",
      category: "productivity",
      url: "https://example.com/paint",
    });
    assert.equal(submitted.status, 201);
    assert.equal(submitted.body.submission.status, "pending");

    // Pending is not public.
    const approved = await buyer.get("/api/accounts/store/approved");
    assert.equal(
      approved.body.submissions.some((s) => s.name === "Crystal Paint"),
      false,
    );

    // The queue shows it to a moderator, and refuses everyone else.
    const queue = await mod.get("/api/accounts/store/admin?status=pending");
    assert.equal(queue.status, 200);
    assert.ok(queue.body.submissions.some((s) => s.name === "Crystal Paint"));
    assert.ok(queue.body.pendingCount >= 1);
    const refused = await buyer.get("/api/accounts/store/admin");
    assert.equal(refused.status, 403);
  });

  it("publishes an approved submission and keeps a rejected one private", async () => {
    const buyer = makeClient(base);
    const other = makeClient(base);
    const mod = makeClient(base);
    await register(buyer, "stbuyer2");
    await register(other, "stbuyer3");
    await mod.post("/api/accounts/login", { username: "moderator", password: "correct-horse" });

    const good = await buyer.post("/api/accounts/store/submit", {
      name: "Nebula Radio",
      description: "Ambient space radio for the media shelf.",
      category: "media",
      url: "https://example.com/nebula",
    });
    const bad = await other.post("/api/accounts/store/submit", {
      name: "Definitely Legit Tool",
      description: "This one is not going to pass review, by design.",
      category: "utilities",
      url: "https://example.com/legit",
    });

    const approved = await mod.post(
      `/api/accounts/store/admin/${good.body.submission.id}/review`,
      { action: "approve", note: "Works in the Browser." },
    );
    assert.equal(approved.status, 200);
    assert.equal(approved.body.submission.status, "approved");
    assert.equal(approved.body.submission.reviewNote, "Works in the Browser.");

    const rejected = await mod.post(
      `/api/accounts/store/admin/${bad.body.submission.id}/review`,
      { action: "reject", note: "Name is misleading." },
    );
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.submission.status, "rejected");

    // The public catalogue now carries the approved app, with its submitter.
    const catalogue = await buyer.get("/api/accounts/store/approved");
    const entry = catalogue.body.submissions.find((s) => s.id === good.body.submission.id);
    assert.ok(entry);
    assert.equal(entry.submitter.username, "stbuyer2");
    assert.equal(catalogue.body.submissions.some((s) => s.id === bad.body.submission.id), false);

    // The submitter sees both decisions and the moderator's reasoning.
    const mine = await other.get("/api/accounts/store/mine");
    const seen = mine.body.submissions.find((s) => s.id === bad.body.submission.id);
    assert.equal(seen.status, "rejected");
    assert.equal(seen.reviewNote, "Name is misleading.");

    // Moderation authority is enforced on the review route too.
    const hijack = await other.post(`/api/accounts/store/admin/${good.body.submission.id}/review`, {
      action: "reject",
    });
    assert.equal(hijack.status, 403);

    const missing = await mod.post("/api/accounts/store/admin/sub_missing/review", {
      action: "approve",
    });
    assert.equal(missing.status, 404);
  });

  it("refuses malformed submissions and signed-out authors", async () => {
    const author = makeClient(base);
    await register(author, "stbuyer4");

    const stranger = makeClient(base);
    const anonymous = await stranger.post("/api/accounts/store/submit", {
      name: "Ghost App",
      description: "Submitted with no account at all.",
      category: "utilities",
      url: "https://example.com/ghost",
    });
    assert.equal(anonymous.status, 401);

    const badUrl = await author.post("/api/accounts/store/submit", {
      name: "Script App",
      description: "Tries to run a script instead of a web page.",
      category: "utilities",
      url: "javascript:alert(1)",
    });
    assert.equal(badUrl.status, 400);

    const thin = await author.post("/api/accounts/store/submit", {
      name: "X",
      description: "short",
      category: "utilities",
      url: "https://example.com/x",
    });
    assert.equal(thin.status, 400);
  });
});

describe("Reserved names, the owner identity, and account tags", () => {
  it("holds the owner's name for both usernames and display names — at sign-up and after", async () => {
    const spoofer = makeClient(base);

    // The username itself is refused outright.
    const taken = await spoofer.post("/api/accounts/register", {
      username: "kiyaan",
      displayName: "kiyaan",
      password: "correct-horse",
    });
    assert.equal(taken.status, 400);
    assert.equal(taken.body.error.code, "INVALID_USERNAME");

    // And as a display name under any casing or padding.
    for (const [username, displayName] of [
      ["spooferone", "Kiyaan"],
      ["spoofertwo", "KIYAAN"],
      ["spooferthree", "  kIyAaN  "],
    ]) {
      const attempt = await spoofer.post("/api/accounts/register", {
        username,
        displayName,
        password: "correct-horse",
      });
      assert.equal(attempt.status, 400, `${displayName} must be refused`);
      assert.equal(attempt.body.error.code, "INVALID_DISPLAY_NAME");
    }

    // A registered account cannot rename into the name either.
    const outsider = makeClient(base);
    const created = await register(outsider, "outsider1");
    assert.equal(created.status, 201);
    const renameUsername = await outsider.patch("/api/accounts/me", { username: "kiyaan" });
    assert.equal(renameUsername.status, 400);
    assert.equal(renameUsername.body.error.code, "INVALID_USERNAME");
    const renameDisplay = await outsider.patch("/api/accounts/me", { displayName: "Kiyaan" });
    assert.equal(renameDisplay.status, 400);
    assert.equal(renameDisplay.body.error.code, "INVALID_DISPLAY_NAME");

    // Display names may otherwise be shared freely — duplicates are allowed.
    const twin = makeClient(base);
    assert.equal((await register(twin, "twinuser")).status, 201);
    const shared = await twin.patch("/api/accounts/me", {
      displayName: created.body.user.displayName,
    });
    assert.equal(shared.status, 200, "two accounts may wear the same display name");
    assert.equal(shared.body.user.displayName, created.body.user.displayName);
  });

  it("upgrades an account named kiyaan to the full owner identity when the store opens", () => {
    const ownerDir = mkdtempSync(join(tmpdir(), "crescent-owner-"));
    try {
      const file = join(ownerDir, "owner.db");
      const first = openAccountsStore({ file });
      const created = first.createUser({
        username: "kiyaan",
        displayName: "kiyaan",
        passwordSalt: "salt",
        passwordHash: "hash",
        createdAt: Date.now(),
      });
      assert.equal(created.role, "user", "creation alone grants nothing");
      const bystander = first.createUser({
        username: "bystander",
        displayName: "Bystander",
        passwordSalt: "salt",
        passwordHash: "hash",
        createdAt: Date.now(),
      });
      first.close();

      // The next open — the same moment the tags column would be migrated —
      // carries the account to the owner identity.
      const reopened = openAccountsStore({ file });
      try {
        const row = reopened.userByUsername("kiyaan");
        assert.equal(row.role, "admin", "the owner holds moderation authority");
        assert.equal(row.rarity, "transcendent", "the rarest tier the generator can produce");
        assert.equal(
          row.rarity_roll,
          RARITY_TOTAL_WEIGHT - 1,
          "the stored roll matches the stored tier",
        );
        assert.deepEqual(tagsOf(row), ["owner"], "the owner tag rides the name");
        const untouched = reopened.userByUsername("bystander");
        assert.equal(untouched.role, "user", "no other account is promoted");
        assert.deepEqual(tagsOf(untouched), [], "no other account is tagged");
        assert.ok(bystander.id);
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(ownerDir, { recursive: true, force: true });
    }
  });

  it("sets tags by admin request only, and the tags ride every name they label", async () => {
    const mod = makeClient(base);
    await mod.post("/api/accounts/login", { username: "moderator", password: "correct-horse" });
    const star = makeClient(base);
    const viewer = makeClient(base);
    assert.equal((await register(star, "tagstar")).status, 201);
    assert.equal((await register(viewer, "tagviewer")).status, 201);

    // Only administrators may set tags.
    const refused = await viewer.post("/api/accounts/admin/users/tagstar/tags", { tags: ["staff"] });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error.code, "NOT_ADMIN");

    // Shapes are validated before anything is written.
    const notList = await mod.post("/api/accounts/admin/users/tagstar/tags", { tags: "staff" });
    assert.equal(notList.status, 400);
    assert.equal(notList.body.error.code, "INVALID_TAGS");
    assert.equal(
      (await mod.post("/api/accounts/admin/users/tagstar/tags", { tags: ["Not Valid!"] })).status,
      400,
    );
    assert.equal(
      (await mod.post("/api/accounts/admin/users/tagstar/tags", { tags: ["a", "b", "c", "d"] })).status,
      400,
      "at most three tags at once",
    );
    assert.equal((await mod.post("/api/accounts/admin/users/nobody-here/tags", { tags: ["staff"] })).status, 404);

    // Setting works, normalises to lowercase, and replaces the previous list.
    const set = await mod.post("/api/accounts/admin/users/tagstar/tags", { tags: ["Staff", "mod"] });
    assert.equal(set.status, 200);
    assert.deepEqual(set.body.user.tags, ["staff", "mod"]);
    const cleared = await mod.post("/api/accounts/admin/users/tagstar/tags", { tags: [] });
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.body.user.tags, []);
    await mod.post("/api/accounts/admin/users/tagstar/tags", { tags: ["staff", "mod"] });

    // The wearer sees the tags on their own account.
    const mine = await star.get("/api/accounts/me");
    assert.deepEqual(mine.body.user.tags, ["staff", "mod"]);

    // A stranger sees them on the profile…
    const profile = await viewer.get("/api/accounts/users/tagstar");
    assert.deepEqual(profile.body.profile.tags, ["staff", "mod"]);

    // …beside the name on a feed post…
    const post = await star.post("/api/accounts/posts", { body: "tagged post" });
    const feed = await viewer.get("/api/accounts/feed");
    const entry = feed.body.feed.posts.find((candidate) => candidate.id === post.body.post.id);
    assert.ok(entry, "the post reaches the feed");
    assert.deepEqual(entry.author.tags, ["staff", "mod"]);

    // …and on the friends list, which is where the chat app reads them from.
    const request = await star.post("/api/accounts/friend-requests", {
      code: (await viewer.get("/api/accounts/me")).body.user.friendCode,
    });
    assert.equal(request.status, 201);

    // …and on the pending-request rows both sides read before accepting…
    const waiting = await viewer.get("/api/accounts/sync?since=0");
    assert.deepEqual(waiting.body.incoming[0].from.tags, ["staff", "mod"]);
    await mod.post("/api/accounts/admin/users/tagviewer/tags", { tags: ["newcomer"] });
    const sent = await star.get("/api/accounts/sync?since=0");
    assert.deepEqual(sent.body.outgoing[0].to.tags, ["newcomer"]);

    assert.equal(
      (await viewer.post(`/api/accounts/friend-requests/${request.body.request.id}/accept`)).status,
      200,
    );
    const snapshot = await viewer.get("/api/accounts/sync?since=0");
    assert.deepEqual(snapshot.body.friends[0].tags, ["staff", "mod"]);
  });
});
