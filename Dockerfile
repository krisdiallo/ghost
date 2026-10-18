FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY packages/shared/ packages/shared/
COPY apps/server/ apps/server/
COPY apps/web/ apps/web/
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends chromium && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production GHOST_HOST=0.0.0.0 PORT=3000 GHOST_BROWSER_PATH=/usr/bin/chromium
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:'+(process.env.GHOST_PORT||process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/dist/index.js", "--serve"]
