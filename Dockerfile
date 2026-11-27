# The image of the three Node services of compose.yaml: setup, crm and circuit (ADR-0020 D1).
# Exact version and digest, like the database's: every clone builds on the same Node (CLAUDE.md,
# Reproducible). 24.20.0 is the version verified on this machine and in CI (CLAUDE.md §5); the
# digest was read with `docker image inspect` on 2026-11-27.
FROM node:24.20.0-trixie-slim@sha256:50c3b2f6988dfc307b86e5301d69611af31f4789bdf232863b07d3b02fe55ae0

WORKDIR /app
# The services run as the image's own user, node (uid and gid 1000), never as root.
RUN chown node:node /app
USER node

# The manifests first: npm ci runs again only when they change, not on every edit of the code.
COPY --chown=node:node package.json package-lock.json .npmrc ./
COPY --chown=node:node apps/crm/package.json apps/crm/
COPY --chown=node:node apps/circuit/package.json apps/circuit/
COPY --chown=node:node apps/board/package.json apps/board/
# With the dev dependencies: setup runs drizzle-kit, and the board is built here with Vite.
RUN npm ci --no-audit --no-fund

COPY --chown=node:node . .
# The board ships inside the image, so the host needs nothing but Docker. .secrets is created here,
# owned by node, so the agent-key volume that Compose mounts on it starts with that owner (D5).
RUN npm run board:build && mkdir -m 0700 .secrets

# Fills the passwords the environment leaves empty from the secrets volume, then runs the command.
ENTRYPOINT ["sh", "/app/docker/with-secrets.sh"]
