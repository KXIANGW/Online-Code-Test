# syntax=docker/dockerfile:1.7

# ---- Stage 1: build ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
# package-lock.json may not exist on a fresh checkout — fall back to npm install.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Strip dev deps for the runtime image.
RUN npm prune --omit=dev

# ---- Stage 2: runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# wget is used by the compose healthcheck.
RUN apk add --no-cache wget

# Run as non-root (the node user is preinstalled in node:20-alpine, uid 1000).
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./package.json
USER node

EXPOSE 3000

# Run migrations, then start the API. If migration fails the container exits and compose retries.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
