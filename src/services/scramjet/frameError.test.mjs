/*
 * CrystalOS — Scramjet frame error tests
 *
 * Run with `npm test` (or `node --test src/services/scramjet/frameError.test.mjs`).
 *
 * frameError.ts imports nothing at runtime, so the Node test runner loads it
 * directly with its types stripped. The frames below are stubs: every decision
 * under test reads only `contentDocument`, `documentElement` and
 * `getElementById`, which is all a fake needs to provide.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  SHELL_ROOT_ID,
  describeRequestFailure,
  describeTransportError,
  readShellRecapture,
} from "./frameError.ts";

/* ------------------------------------------------------------- fake pieces */

/** A document stub shaped like the shell's own markup. */
function shellDoc() {
  return {
    documentElement: {},
    getElementById: (id) => (id === SHELL_ROOT_ID ? {} : null),
  };
}

/** A document stub for an ordinary proxied page. */
function pageDoc() {
  return {
    documentElement: {},
    getElementById: () => null,
  };
}

/** An iframe stub whose document can be swapped or made unreadable. */
function fakeFrame(getDocument) {
  return {
    get contentDocument() {
      return getDocument();
    },
  };
}

/* ------------------------------------------------------------------ tests */

describe("describeTransportError", () => {
  test("names the SSL failure in words a person can act on", () => {
    const message = describeTransportError("Internal Service Worker Error: SSL connect error #1234");
    assert.match(message, /secure connection/);
    assert.match(message, /#1234/);
  });

  test("keeps an unknown code in a plain sentence", () => {
    const message = describeTransportError("Internal Service Worker Error: something odd #9");
    assert.match(message, /something odd #9/);
  });

  test("a page that merely mentions the phrase is not the error page", () => {
    assert.equal(describeTransportError("Notes about Internal Service Worker Error: lore"), null);
    assert.equal(describeTransportError("Real content"), null);
    assert.equal(describeTransportError(""), null);
  });
});

describe("describeRequestFailure", () => {
  /*
   * The same sentence has to serve the failure the frame *reports*, which is raw
   * transport text with no error page around it. These pin the causes that turn
   * up on the proxied path, because the wording is what the person acts on.
   */
  test("names an exit that carried nothing back", () => {
    const message = describeRequestFailure(
      "The proxy carried a secure session but no answer to a request over it.",
    );
    assert.match(message, /carried nothing back/);
    assert.match(message, /no answer to a request/);
  });

  test("names a corrupted stream", () => {
    const message = describeRequestFailure(
      "error:0A000119:SSL routines:tls_get_more_records:decryption failed or bad record mac",
    );
    assert.match(message, /corrupted/);
  });

  test("names a site no exit could carry", () => {
    assert.match(
      describeRequestFailure("No exit could carry www.example.com:443."),
      /No exit in the pool could carry this site/,
    );
  });

  test("says only what it can support when the code is unknown", () => {
    const message = describeRequestFailure("mystery #42");
    assert.match(message, /could not be loaded through the proxy/);
    assert.match(message, /mystery #42/);
  });

  test("an empty detail still reads as a sentence", () => {
    assert.equal(describeRequestFailure("   "), "This page could not be loaded through the proxy.");
  });

  test("a long detail is clipped rather than dumped", () => {
    const message = describeRequestFailure("x".repeat(400));
    assert.ok(message.length < 200);
    assert.match(message, /…/);
  });
});

describe("readShellRecapture", () => {
  test("recognises the shell by its mount node", () => {
    const message = readShellRecapture(fakeFrame(() => shellDoc()));
    assert.match(message, /CrystalOS itself/);
  });

  test("an ordinary proxied page is not a recapture", () => {
    assert.equal(readShellRecapture(fakeFrame(() => pageDoc())), null);
  });

  test("an empty or mid-navigation document is not a recapture", () => {
    assert.equal(readShellRecapture(fakeFrame(() => null)), null);
    assert.equal(
      readShellRecapture(fakeFrame(() => ({ documentElement: null, getElementById: () => null }))),
      null,
    );
  });

  test("a cross-origin frame cannot be inspected and is never blamed", () => {
    const throwing = fakeFrame(() => {
      throw new Error("cross-origin");
    });
    assert.equal(readShellRecapture(throwing), null);
  });
});
