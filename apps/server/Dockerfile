# Build: glibc for Vite+'s native binaries; bundles apps/server with core/model and blocks.
FROM node:22.22.3-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@12.16.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile --filter composed-server...
RUN pnpm --filter composed-server run bundle
RUN pnpm --filter composed-server deploy --prod --legacy /prod

# Runtime: the bundle plus production dependencies (loro-crdt) only; no build toolchain.
FROM node:22.22.3-alpine
WORKDIR /app
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /prod/node_modules ./node_modules
COPY --from=build /prod/package.json ./package.json
ENV COMPOSED_STORAGE=/data PORT=4849
RUN mkdir -p /data && chown node:node /data
VOLUME /data
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4849/healthz || exit 1
EXPOSE 4849
USER node
CMD ["node", "dist/main.mjs"]
