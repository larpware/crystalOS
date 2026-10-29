# CrystalOS backend — one image for a container host (Northflank first).
#
# Two stages on purpose:
#   build   has the toolchain (typescript, vite) and compiles the shell into
#           ./dist — the backend serves that directory when it exists, so the
#           container is a complete deployment on its own.
#   runtime has production dependencies only: no vite, no typescript, no
#           build sources. A NODE_ENV=production `npm ci` in a single-stage
#           image would silently drop the devDependencies the build needs —
#           which is why production is set here and not at the top.
#
# Node 22 is mandatory: the account store is node:sqlite, which older images
# lack.

FROM node:22 AS build

WORKDIR /app

# Dependencies first: this layer is reused until the lockfile changes.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Everything `npm run build` reads: tsc --noEmit (tsconfig, src), vite build
# (index.html, src, vite.config) and scripts/deploy-config.mjs (scripts).
# No backend origin is needed here — with neither CRESCENT_BACKEND_URL nor
# CRESCENT_API_ORIGIN the build keeps same-origin defaults, which is exactly
# right for a container that serves the shell itself.
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY scripts ./scripts
COPY src ./src
# The Games catalogue imports this file directly (src/apps/games/catalogue.ts),
# so the build dies without it. Only this directory: integrations/sndgames-
# remastered is tracked in the repo, while its sibling integrations/scramjet is
# a read-only submodule clone nothing imports — a host that clones without
# submodules still builds, because this COPY never touches it.
COPY integrations/sndgames-remastered ./integrations/sndgames-remastered
RUN npm run build

FROM node:22

# Runtime defaults:
#   CRESCENT_HOST=0.0.0.0      the default 127.0.0.1 is unreachable behind a
#                              platform proxy — Northflank routes to the
#                              container's interface, not its loopback.
#   /data                      every durable file lives here, so ONE volume
#                              mounted at /data covers them all: the account
#                              database and the Proton session/endpoint files.
#                              Without a volume they still work — and die with
#                              the container, taking every account with them.
ENV NODE_ENV=production \
    CRESCENT_HOST=0.0.0.0 \
    CRESCENT_ACCOUNTS_DB=/data/accounts.db \
    CRESCENT_VPN_SESSION_FILE=/data/proton-session.json \
    CRESCENT_VPN_ENDPOINT_FILE=/data/endpoint.json

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && mkdir -p /data

# The backend and the vendored proxy assets it serves; the shell comes from
# the build stage. Runtime data (server/accounts/data, server/vpn/data) and
# build sources are excluded by .dockerignore — they are either rebuilt here
# or belong on the volume.
COPY server ./server
COPY scramjet-assets ./scramjet-assets
COPY --from=build /app/dist ./dist

# CRESCENT_PORT, else the platform's PORT, else 8787 — the same precedence the
# server applies. Northflank detects this EXPOSE for the service's port; a
# different port only needs CRESCENT_PORT set alongside it.
EXPOSE 8787

# Same endpoint the platform health check should use (docs/DEPLOYMENT.md §7):
# honest liveness, no expensive work, no information revealed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.CRESCENT_PORT ?? process.env.PORT ?? 8787) + '/api/proxy-status').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# `node` directly rather than `npm start`: npm is PID 1 here and does not
# forward SIGTERM, while server/scramjet/index.js installs its own SIGTERM
# handler for a clean shutdown. Northflank's stop signal would never reach it
# through the npm wrapper.
CMD ["node", "server/scramjet/index.js"]
