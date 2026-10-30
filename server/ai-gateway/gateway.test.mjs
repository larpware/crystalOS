/*
 * CrystalOS — the local Respan Gateway, end to end
 *
 * Crystal AI's gateway mode is only useful if the process the npm script
 * starts really serves the HTTP API the app calls. This test starts that
 * process (`server/ai-gateway/serve.py`) with a configuration whose provider
 * is a stand-in endpoint on loopback, then asks it what the browser asks it:
 * a chat completion on /v1/chat/completions and the catalogue on /v1/models.
 * Nothing leaves this machine and no provider key is needed — the fixture is
 * the provider, and it records what it was sent, so a request that never
 * reached it cannot pass.
 *
 * The check is skipped, not failed, on a machine without the project's Python
 * environment: `respan-gateway` is a Python package, and `npm test` should
 * still work for a checkout that only builds the shell.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(HERE, "..", "..");
const SHELL_ORIGIN = "http://127.0.0.1:5273";

/** The interpreter `npm run ai:gateway` would use, when it exists. */
function findPython() {
  const candidates = [
    process.env.CRESCENT_PYTHON,
    join(PROJECT_ROOT, ".venv", "Scripts", "python.exe"),
    join(PROJECT_ROOT, ".venv", "bin", "python"),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function skipReason() {
  const python = findPython();
  if (!python) return "no Python environment (.venv) for the gateway in this checkout";
  const probe = spawnSync(python, ["-c", "import respan_gateway"], { stdio: "ignore" });
  if (probe.status !== 0) {
    return "respan-gateway is not installed in .venv (pip install -r server/ai-gateway/requirements.txt)";
  }
  return false;
}

/** Waits for the line serve.py prints once the gateway is listening. */
function waitForUrl(child, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`the gateway did not print its URL within ${timeoutMs}ms`));
    }, timeoutMs);

    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      const match = /\[crystal\] gateway url (\S+)/.exec(line);
      if (match) {
        clearTimeout(timer);
        lines.close();
        resolve(match[1]);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`the gateway exited before it was ready (code ${code})`));
    });
  });
}

describe("the local gateway the shell talks to", { skip: skipReason() }, () => {
  let upstream;
  let gateway;
  let scratch;
  const seen = [];

  before(async () => {
    // The provider stand-in: it answers the OpenAI shapes the gateway proxies
    // and remembers the bodies it was sent.
    upstream = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        if (req.method === "GET" && req.url === "/v1/models") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ object: "list", data: [{ id: "fixture-chat", object: "model" }] }));
          return;
        }
        const parsed = body ? JSON.parse(body) : null;
        seen.push({ url: req.url, body: parsed });

        // Crystal AI streams by default, so the fixture can too: the gateway
        // has to pass SSE frames through untouched.
        if (parsed?.stream) {
          res.writeHead(200, { "content-type": "text/event-stream" });
          for (const piece of ["po", "ng"]) {
            res.write(
              `data: ${JSON.stringify({
                object: "chat.completion.chunk",
                choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
              })}\n\n`,
            );
          }
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl-fixture",
            object: "chat.completion",
            created: 0,
            model: "fixture-chat",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "pong from the fixture" },
                finish_reason: "stop",
              },
            ],
          }),
        );
      });
    });
    await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamBase = `http://127.0.0.1:${upstream.address().port}/v1`;

    // The same shape as server/ai-gateway/gateway.toml, with the fixture as
    // the provider so no provider key is needed to check the wiring.
    scratch = mkdtempSync(join(tmpdir(), "crystal-gateway-"));
    const configPath = join(scratch, "gateway.toml");
    writeFileSync(
      configPath,
      [
        "[providers.fixture]",
        'vendor = "openai"',
        'formats = "openai-chat"',
        `base_url = "${upstreamBase}"`,
        'key = "fixture-key"',
        "",
        "[cors]",
        `origins = ["${SHELL_ORIGIN}"]`,
        "",
      ].join("\n"),
      "utf8",
    );

    gateway = spawn(findPython(), [join(HERE, "serve.py"), "--config", configPath, "--port", "0"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    let stderr = "";
    gateway.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    gateway.once("exit", (code) => {
      if (code !== 0 && code !== null) process.stderr.write(`[gateway] ${stderr}\n`);
    });

    const url = await waitForUrl(gateway);
    // A gateway on anything but loopback would spend these keys for anyone who
    // can reach the port; serve.py defaults to loopback and this pins it.
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/v1$/, `unexpected gateway URL ${url}`);
    gateway.url = url;
  });

  after(async () => {
    if (gateway) {
      const exited = new Promise((resolve) => gateway.once("exit", resolve));
      gateway.kill();
      await exited;
    }
    if (upstream) await new Promise((resolve) => upstream.close(resolve));
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  test("a chat completion from the shell is routed and answered", async () => {
    const response = await fetch(`${gateway.url}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: SHELL_ORIGIN },
      body: JSON.stringify({
        model: "fixture-chat",
        messages: [{ role: "user", content: "ping" }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.choices?.[0]?.message?.content, "pong from the fixture");

    // The browser is another origin, so the stream would be unreadable without
    // this header — the request above carries the dev server's origin.
    assert.equal(response.headers.get("access-control-allow-origin"), SHELL_ORIGIN);

    const routed = seen.at(-1);
    assert.equal(routed?.body?.model, "fixture-chat");
    assert.deepEqual(routed?.body?.messages, [{ role: "user", content: "ping" }]);
  });

  test("a streamed answer comes back as server-sent events", async () => {
    const response = await fetch(`${gateway.url}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: SHELL_ORIGIN },
      body: JSON.stringify({
        model: "fixture-chat",
        messages: [{ role: "user", content: "ping" }],
        stream: true,
      }),
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);

    const body = await response.text();
    assert.match(body, /data: \[DONE\]/);
    // The same reading the shell does: every delta in order is the answer.
    const answer = body
      .split(/\r?\n\r?\n/)
      .filter((block) => block.startsWith("data:") && !block.includes("[DONE]"))
      .map((block) => JSON.parse(block.slice(5).trim()))
      .map((chunk) => chunk.choices?.[0]?.delta?.content ?? "")
      .join("");
    assert.equal(answer, "pong");
  });

  test("the model picker's catalogue comes from the gateway's providers", async () => {
    const response = await fetch(`${gateway.url}/models`, { headers: { accept: "application/json" } });
    assert.equal(response.status, 200);
    const body = await response.json();
    const ids = (body.data ?? []).map((model) => model.id);
    assert.ok(ids.includes("fixture-chat"), `catalogue was ${JSON.stringify(ids)}`);
  });
});
