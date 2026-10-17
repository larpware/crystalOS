/*
 * CrystalOS — Proton session store tests
 *
 * The store is the only place a secret is written to disk. These check that it
 * round-trips, that it refuses anything that is not a usable Proton session,
 * that `describe()` never leaks a token, and that a corrupt file degrades to
 * "no session" rather than stopping the backend from starting.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionStore } from "./session.mjs";

let directory;
let file;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "crescent-vpn-"));
  file = join(directory, "session.json");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const SESSION = {
  uid: "uid-1234",
  accessToken: "access-token-value",
  refreshToken: "refresh-token-value",
};

describe("createSessionStore", () => {
  test("there is no session until one is saved", async () => {
    const store = createSessionStore({ file });
    assert.equal(await store.load(), null);
    assert.deepEqual(await store.describe(), { signedIn: false, uid: null, updatedAt: null });
  });

  test("a saved session survives a reload", async () => {
    await createSessionStore({ file }).save(SESSION);
    const reloaded = await createSessionStore({ file }).load();
    assert.equal(reloaded.uid, SESSION.uid);
    assert.equal(reloaded.accessToken, SESSION.accessToken);
    assert.equal(reloaded.refreshToken, SESSION.refreshToken);
  });

  test("describe() reports the account, never the tokens", async () => {
    const store = createSessionStore({ file });
    await store.save(SESSION);
    const described = await store.describe();
    assert.deepEqual(Object.keys(described).sort(), ["signedIn", "uid", "updatedAt"]);
    assert.equal(described.signedIn, true);
    assert.equal(described.uid, SESSION.uid);
    assert.equal(JSON.stringify(described).includes("token"), false);
  });

  test("a session without a refresh token is refused", async () => {
    const store = createSessionStore({ file });
    await assert.rejects(() => store.save({ uid: "x", accessToken: "y" }), /refresh token/i);
  });

  test("a session without a uid is refused", async () => {
    const store = createSessionStore({ file });
    await assert.rejects(() => store.save({ uid: "", refreshToken: "r" }), /uid/i);
  });

  test("clearing removes the file", async () => {
    const store = createSessionStore({ file });
    await store.save(SESSION);
    await store.clear();
    assert.equal(await store.load(), null);
    await assert.rejects(() => readFile(file, "utf8"));
  });

  test("a corrupt file reads as no session instead of throwing", async () => {
    await writeFile(file, "{not json", "utf8");
    const store = createSessionStore({ file });
    assert.equal(await store.load(), null);
    assert.equal((await store.describe()).signedIn, false);
  });

  test("the written file contains only the session fields", async () => {
    await createSessionStore({ file }).save({ ...SESSION, extra: "should not persist" });
    const written = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(Object.keys(written).sort(), ["accessToken", "redirectURI", "refreshToken", "uid", "updatedAt"]);
  });

  test("a non-POSIX path is not required for the store to work", async () => {
    // On Windows mode is ignored; the store must still write the file.
    const store = createSessionStore({ file });
    await store.save(SESSION);
    assert.ok(await store.load());
  });
});
