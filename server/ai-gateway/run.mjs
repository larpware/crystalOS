#!/usr/bin/env node
/*
 * CrystalOS — `npm run ai:gateway`
 *
 * Starts the local Respan Gateway (server/ai-gateway/serve.py) with the
 * project's own Python environment. The gateway is a Python package, so the
 * shell cannot start it in process; this wrapper exists so the one command
 * people remember is an npm script, and so a missing environment is a
 * sentence with the fix in it rather than `ENOENT`.
 *
 * Windows and POSIX name the interpreter differently inside a venv, so both
 * are tried. `CRESCENT_PYTHON` overrides the search — useful when the gateway
 * lives in some other environment.
 *
 * Ctrl+C stops the gateway; its port is released. Arguments are passed
 * through (`npm run ai:gateway -- --port 8791`).
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(HERE, "..", "..");

const CANDIDATES = [
  process.env.CRESCENT_PYTHON,
  join(PROJECT_ROOT, ".venv", "Scripts", "python.exe"),
  join(PROJECT_ROOT, ".venv", "bin", "python"),
].filter(Boolean);

const python = CANDIDATES.find((candidate) => existsSync(candidate));

if (!python) {
  process.stderr.write(
    [
      "",
      "[crystal] no Python environment for the gateway was found.",
      "",
      "  create it once:",
      "    python -m venv .venv",
      "    .venv/Scripts/python -m pip install --only-binary=:all: -r server/ai-gateway/requirements.txt",
      "    (on macOS or Linux: .venv/bin/python -m pip install --only-binary=:all: -r server/ai-gateway/requirements.txt)",
      "",
      "  or point CRESCENT_PYTHON at another interpreter that has respan-gateway installed.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const child = spawn(python, [join(HERE, "serve.py"), ...process.argv.slice(2)], {
  stdio: "inherit",
  // The gateway reads provider keys such as OPENAI_API_KEY from the
  // environment it is started in, exactly as the configuration says.
  env: process.env,
});

child.on("error", (error) => {
  process.stderr.write(`[crystal] could not start ${python}: ${error.message}\n`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(0);
  process.exit(code ?? 0);
});
