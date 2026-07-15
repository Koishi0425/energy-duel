# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

ENV NODE_OPTIONS=--max-old-space-size=1024

WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
RUN --mount=type=cache,id=energy-duel-npm,target=/root/.npm,sharing=locked \
    npm ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=2567

WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json

# Establish a dependency on the completed build stage before installing runtime
# packages. This prevents BuildKit from running two memory-heavy npm ci commands
# concurrently on small deployment servers.
COPY --from=build --chown=node:node /app/server/dist ./server/dist
COPY --from=build --chown=node:node /app/shared/dist ./shared/dist
COPY --from=build --chown=node:node /app/client/dist ./client/dist

RUN --mount=type=cache,id=energy-duel-npm,target=/root/.npm,sharing=locked \
    npm ci --omit=dev --workspace server --workspace shared --include-workspace-root

RUN mkdir -p /app/server/data && chown node:node /app/server/data

USER node

EXPOSE 2567
VOLUME ["/app/server/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 2567) + '/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/dist/index.js"]
