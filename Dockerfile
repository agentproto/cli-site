# syntax=docker/dockerfile:1.7
#
# Multi-stage Dockerfile for cli.agentproto.sh
# - Builder: pnpm install + content sync (git clone agentproto/ts)
#   + next build. Synced docs land in content/docs/ via the rename
#   .md → .mdx + frontmatter synthesis in scripts/sync-content.mjs.
# - Runner: minimal Node image, copies the built output, runs
#   `next start`.

ARG NODE_VERSION=22.11.0

# ── Builder ─────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app

# git is required by scripts/sync-content.mjs to clone the public
# ts repo. python3/make/g++ keep node-gyp happy if any transitive dep
# needs to compile native bindings.
RUN apk add --no-cache git python3 make g++ libc6-compat

# corepack signature verification has been brittle on recent Node
# releases (npm/cli#7902). Install pnpm directly via npm.
RUN npm install -g pnpm@10.4.1

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --no-frozen-lockfile

COPY . .
ENV NODE_ENV=production
RUN pnpm build

# ── Runner ──────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app

RUN apk add --no-cache curl ca-certificates && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=8080

COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.mjs ./next.config.mjs

USER nextjs
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD curl -f http://localhost:${PORT}/ || exit 1

CMD ["sh", "-c", "PORT=${PORT:-8080} npx next start -p ${PORT:-8080}"]
