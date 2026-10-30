#!/usr/bin/env python3
"""Serves Crystal AI's local Respan Gateway on loopback.

Crystal AI runs in the browser, so it cannot call the gateway in process the
way a Python program does; the shell speaks HTTP to it instead. This script
serves `gateway.toml` from `server/ai-gateway/` (or `--config`) and prints the
base URL with `/v1` on the end — the value Crystal AI's Settings → Routing asks
for:

    npm run ai:gateway                          # or:
    .venv/Scripts/python server/ai-gateway/serve.py

The gateway spends the provider keys in this process's environment
(`OPENAI_API_KEY` for the shipped configuration). It is the developer's own
key, not a Respan account, and nothing is traced, exported or stored beyond the
request list this process keeps in memory. Loopback only, by design.

Environment:
  CRESCENT_AI_GATEWAY_PORT   default port (8790); --port 0 picks a free one
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_CONFIG = HERE / "gateway.toml"
DEFAULT_PORT = int(os.environ.get("CRESCENT_AI_GATEWAY_PORT", "8790"))


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Serve the Respan Gateway that Crystal AI routes its chats through.",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=DEFAULT_CONFIG,
        help="gateway.toml to serve (default: %(default)s)",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="bind address (default: %(default)s — loopback on purpose)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help="port, 0 for any free one (default: %(default)s)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    try:
        import respan_gateway as rg
    except ImportError:
        print(
            "respan-gateway is not installed in this interpreter.\n"
            "Create the project environment and install it with:\n"
            "  python -m venv .venv\n"
            "  .venv/Scripts/python -m pip install --only-binary=:all:"
            " -r server/ai-gateway/requirements.txt",
            file=sys.stderr,
        )
        return 2

    if not args.config.is_file():
        print(f"no gateway configuration at {args.config}", file=sys.stderr)
        return 2

    try:
        gateway = rg.Gateway.from_file(args.config)
    except rg.ConfigError as error:
        # A configuration that cannot be served is said so plainly: a missing
        # provider key is the usual cause, and the message names the variable.
        print(f"the gateway configuration was refused:\n{error}", file=sys.stderr)
        return 2

    with gateway:
        server = gateway.serve(args.host, args.port)
        print(server.banner, flush=True)
        # The shell and the integration check both read this line; it is the
        # only output contract this script has.
        print(f"[crystal] gateway url {server.url}/v1", flush=True)
        try:
            server.wait()
        except KeyboardInterrupt:
            pass
        finally:
            server.stop()

    print("[crystal] gateway stopped", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
