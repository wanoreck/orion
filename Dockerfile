# Orion: single standalone Next.js image, built and run by Coolify (D10, D16).

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Install scripts are skipped: none are needed for the build, and Carbon's run telemetry.
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# Migrations are applied at server start (src/instrumentation.ts).
COPY --from=build --chown=node:node /app/drizzle ./drizzle
USER node
EXPOSE 3000
# The fetch gives up after 4s, well inside Docker's 10s timeout, so a slow check exits 1
# (unhealthy) on its own instead of being killed by Docker (exit 137).
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]
