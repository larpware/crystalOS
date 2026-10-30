/*
 * CrystalOS — Crystal AI gateway client tests
 *
 * Crystal AI's gateway transport is the app path a chat takes when Settings →
 * Routing says "Local gateway": one POST to an OpenAI-compatible
 * `/chat/completions`, read as SSE while the answer streams in. These tests
 * pin down what the shell promises about it — a bare host gets `/v1`, a chunk
 * split across two reads still renders, `[DONE]` ends the stream, and a
 * gateway that is down or refuses says so in words a person can act on — with
 * a real HTTP server standing in for the gateway on loopback.
 *
 * Node resolves neither Vite's `@/` alias nor extensionless relative imports,
 * so the hook below maps them the way the bundler does.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const SRC_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "../..");

function resolveWithExtensions(base) {
  for (const suffix of ["", ".ts", ".tsx", ".mjs", ".js"]) {
    const candidate = base + suffix;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const target = resolveWithExtensions(resolvePath(SRC_ROOT, specifier.slice(2)));
      if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
      const target = resolveWithExtensions(base);
      if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const {
  DEFAULT_GATEWAY_URL,
  chatThroughGateway,
  describeGatewayError,
  normaliseGatewayBase,
  readGatewayEvent,
  readGatewayPayload,
} = await import("./gateway.ts");

/** A stand-in gateway: every request is answered by `handle`. */
async function fakeGateway(handle) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let parsed = null;
      try {
        parsed = body ? JSON.parse(body) : null;
      } catch {
        parsed = null;
      }
      handle(req, res, parsed);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function frame(delta, extra = {}) {
  return `data: ${JSON.stringify({
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta, finish_reason: null }],
    ...extra,
  })}\n\n`;
}

/** Collects a whole gateway answer, the way the app's turn buffer does. */
async function readAnswer(options) {
  let text = "";
  for await (const delta of chatThroughGateway(options)) text += delta;
  return text;
}

describe("gateway base URL", () => {
  test("a bare host gains the /v1 the chat API lives under", () => {
    assert.equal(normaliseGatewayBase("http://127.0.0.1:8790"), "http://127.0.0.1:8790/v1");
    assert.equal(normaliseGatewayBase("http://127.0.0.1:8790/"), "http://127.0.0.1:8790/v1");
    assert.equal(normaliseGatewayBase("  http://127.0.0.1:8790/v1/  "), "http://127.0.0.1:8790/v1");
  });

  test("an empty setting is the gateway the npm script starts", () => {
    assert.equal(normaliseGatewayBase(""), DEFAULT_GATEWAY_URL);
    assert.equal(normaliseGatewayBase(null), DEFAULT_GATEWAY_URL);
    assert.match(DEFAULT_GATEWAY_URL, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
  });
});

describe("streamed events", () => {
  test("a delta chunk yields its text", () => {
    assert.deepEqual(readGatewayEvent(frame({ content: "hello" }).trim()), { text: "hello" });
  });

  test("[DONE] ends the stream", () => {
    assert.deepEqual(readGatewayEvent("data: [DONE]"), { done: true });
  });

  test("keep-alives and unparseable frames are ignored, not rendered", () => {
    assert.equal(readGatewayEvent(": ping"), null);
    assert.equal(readGatewayEvent("event: message"), null);
    assert.equal(readGatewayEvent("data: {not json"), null);
  });

  test("an error frame carries the gateway's own message", () => {
    const block = `data: ${JSON.stringify({ error: { message: "provider exploded" } })}`;
    assert.deepEqual(readGatewayEvent(block), { error: "provider exploded" });
  });

  test("a whole answer reads from message.content", () => {
    const payload = { choices: [{ index: 0, message: { role: "assistant", content: "pong" } }] };
    assert.deepEqual(readGatewayPayload(payload), { text: "pong" });
  });

  test("an answer with no content is not text", () => {
    assert.equal(readGatewayPayload({ choices: [{ index: 0, delta: {} }] }), null);
    assert.equal(readGatewayPayload({ object: "list" }), null);
    assert.equal(readGatewayPayload("not an object"), null);
  });
});

describe("chatThroughGateway against a real socket", () => {
  let gateway;

  before(async () => {
    gateway = await fakeGateway((req, res, body) => {
      if (new URL(req.url, "http://fixture").pathname !== "/v1/chat/completions") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "no such route" } }));
        return;
      }
      if (body?.model === "broken") {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "upstream provider exploded" } }));
        return;
      }
      if (body?.messages?.[0]?.content === "stream please") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        // Two reads: the first frame is deliberately cut in half, so a parser
        // that assumes one event per chunk would drop the answer.
        const whole = frame({ content: "po" }) + frame({ content: "ng" });
        res.write(whole.slice(0, 12));
        setTimeout(() => {
          res.write(whole.slice(12) + "data: [DONE]\n\n");
          res.end();
        }, 10);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ index: 0, message: { role: "assistant", content: "whole answer" } }],
        }),
      );
    });
  });

  after(async () => {
    await gateway.close();
  });

  test("a streamed answer arrives whole, across a split chunk", async () => {
    const text = await readAnswer({
      baseUrl: gateway.baseUrl,
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "stream please" }],
      stream: true,
    });
    assert.equal(text, "pong");
  });

  test("streaming off takes the whole answer in one piece", async () => {
    const text = await readAnswer({
      baseUrl: gateway.baseUrl,
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "once" }],
      stream: false,
    });
    assert.equal(text, "whole answer");
  });

  test("a refused request reports what the gateway said", async () => {
    await assert.rejects(
      readAnswer({
        baseUrl: gateway.baseUrl,
        model: "broken",
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      }),
      /upstream provider exploded/,
    );
  });

  test("an unrouted path reports the gateway's explanation", async () => {
    await assert.rejects(
      readAnswer({
        baseUrl: `${gateway.baseUrl}/nowhere`,
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
      /no such route/,
    );
  });

  test("a gateway that is not running names the command that starts it", async () => {
    const closed = await fakeGateway((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    const baseUrl = closed.baseUrl;
    await closed.close();

    await assert.rejects(
      readAnswer({
        baseUrl,
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
      /npm run ai:gateway/,
    );
    assert.match(describeGatewayError(new Error("Failed to fetch")), /npm run ai:gateway/);
  });

  test("Stop is not an error the person sees", async () => {
    const controller = new AbortController();
    controller.abort();
    const text = await readAnswer({
      baseUrl: gateway.baseUrl,
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
      signal: controller.signal,
    });
    assert.equal(text, "");
  });
});
