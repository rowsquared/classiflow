# Node 24 LTS. The digest pins the exact image so a rebuild (Coolify, CI smoke)
# gets the same OS packages and Node as the tested one; Dependabot bumps it.
FROM node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# All dependencies, exactly as recorded in package-lock.json. The Prisma schema
# and config are needed because postinstall runs `prisma generate` (into
# lib/generated/prisma).
FROM base AS deps
COPY package.json package-lock.json .npmrc prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# Runtime dependencies only: Next's standalone output plus what the start
# command needs outside it (Prisma CLI for `migrate deploy`; the pg adapter
# and Better Auth's password hashing for scripts/*.ts). No build or test tooling.
FROM base AS prod-deps
COPY package.json package-lock.json .npmrc prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM deps AS builder
COPY next.config.ts tsconfig.json postcss.config.js eslint.config.mjs proxy.ts instrumentation.ts ./
COPY app ./app
COPY components ./components
COPY lib ./lib
COPY styles ./styles
COPY public ./public
COPY scripts ./scripts
ENV NODE_ENV=production
# Next loads the route modules while collecting page data, and Better Auth
# refuses to start without a secret. This placeholder exists only in this build
# step; the server gets the real BETTER_AUTH_SECRET from its environment.
RUN BETTER_AUTH_SECRET=build-only-placeholder-not-used-at-runtime npm run build

FROM base AS runner

RUN apk add --no-cache wget

ENV NODE_ENV=production

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
# scripts/*.ts run with Node's type stripping and import these directly
# (tests/dockerfile.test.ts checks the list against their imports).
COPY --from=builder --chown=nextjs:nodejs /app/lib/generated ./lib/generated
COPY --from=builder --chown=nextjs:nodejs /app/lib/passwords.ts ./lib/passwords.ts
COPY --from=builder --chown=nextjs:nodejs /app/lib/account-links.ts ./lib/account-links.ts
COPY --from=builder --chown=nextjs:nodejs /app/lib/password-policy.ts ./lib/password-policy.ts
COPY --from=builder --chown=nextjs:nodejs /app/lib/ai-credentials.ts ./lib/ai-credentials.ts

USER nextjs

# Last, so a new commit does not invalidate the layers above.
ARG SOURCE_COMMIT=""
ENV SOURCE_COMMIT=${SOURCE_COMMIT}

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Start the application
CMD ["node", "server.js"]
