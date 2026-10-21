# syntax=docker/dockerfile:1
# Production image for Routed: Next.js standalone output, non-root, with a healthcheck.
# Build:  docker build -t routed .
# Run:    docker run -p 3000:3000 routed            (mock mode, no keys needed)
#         docker run -p 3000:3000 -e QLOO_API_KEY=... -e LLM_API_KEY=... routed
# Keys are read at request time (src/lib/config.ts). Never pass them as build args: they would end up in image layers.

ARG NODE_VERSION=22

# 1) Install dependencies from the lockfile only.
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 2) Build. No secrets in this stage.
FROM node:${NODE_VERSION}-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# public/ is empty and git does not track empty folders, so a fresh clone may not have it.
RUN mkdir -p public && npm run build

# 3) Minimal runtime: only the traced standalone server, static assets and public/.
FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
# The official node image ships an unprivileged "node" user (uid 1000).
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
# Render and Railway use their own HTTP health checks (render.yaml / railway.json) and set PORT themselves;
# this one covers plain `docker run` and other Docker hosts. Node 22 has global fetch, so no curl is needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
