# --- Stage 1: build TypeScript ---
FROM node:20-bookworm-slim AS node-build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Stage 2: build Isolate from source ---
# Isolate (sio2project) is a tiny C program (~5k lines). We build it from a
# pinned commit/tag for reproducibility, then carry only the binary forward.
FROM debian:bookworm-slim AS isolate-build

ARG ISOLATE_REF=v2.0
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      libcap-dev \
      libsystemd-dev \
      pkg-config \
      asciidoc-base \
      git \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 --branch ${ISOLATE_REF} https://github.com/ioi/isolate.git . \
 && make isolate

# --- Stage 3: runtime ---
FROM node:20-bookworm-slim

# Runtime deps:
#   - libcap2, libsystemd0 : needed by isolate
#   - docker.io (cli only) : still required when SANDBOX_ENGINE=docker
#   - curl                 : healthcheck convenience
RUN apt-get update && apt-get install -y --no-install-recommends \
      libcap2 \
      libsystemd0 \
      docker.io \
      curl \
 && rm -rf /var/lib/apt/lists/*

# Isolate ships as a setuid-root binary; the systemd-style config file under
# /etc/isolate.conf is auto-generated at first run if missing.
COPY --from=isolate-build /src/isolate /usr/local/bin/isolate
RUN chmod 4755 /usr/local/bin/isolate \
 && mkdir -p /var/local/lib/isolate /etc/oct

WORKDIR /app
ENV NODE_ENV=production \
    SECCOMP_POLICY_PATH=/etc/oct/seccomp.policy

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=node-build /app/dist ./dist
COPY sandbox/languages.yaml ./sandbox/languages.yaml
COPY sandbox/isolate-seccomp.policy /etc/oct/seccomp.policy

CMD ["node", "dist/index.js"]
