# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — deps
# Install production + dev dependencies so the build stage has everything it
# needs.  Keeping deps in a separate stage means Docker can cache this layer
# independently from the source code.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --frozen-lockfile


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — builder
# Build the Next.js application in standalone mode.  The standalone output
# bundles only the server code needed to run the app — no node_modules bloat.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Copy installed dependencies from the deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Build-time environment variables.
# NEXT_PUBLIC_* vars are inlined into the JS bundle at build time by Next.js,
# so they must be available here, not at runtime.
# Override via docker-compose `build.args` or a .env file passed at build.
ARG NEXT_PUBLIC_API_URL=https://localhost
ARG NEXT_PUBLIC_WS_URL=wss://localhost

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

# Disable Next.js telemetry in CI/container builds
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build


# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 — runner  (final image)
# Minimal production image — only the standalone server output, public assets,
# and static files.  No node_modules, no source code, no dev tools.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create a non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# Copy only what the standalone server needs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static    ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public          ./public

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Next.js standalone entrypoint
CMD ["node", "server.js"]
