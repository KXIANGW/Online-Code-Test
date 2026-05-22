# --- Stage 1: build TypeScript ---
FROM --platform=$BUILDPLATFORM node:20-bookworm-slim AS node-build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Stage 2: runtime ---
# skopeo + umoci are the OCI tools that do the heavy lifting. Both ship with
# Debian bookworm via the `golang-github-containers-image` (skopeo) and
# `umoci` packages.
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      skopeo \
      umoci \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=node-build /app/dist ./dist

EXPOSE 8081
CMD ["node", "dist/index.js"]
