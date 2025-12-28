FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
RUN apk add --no-cache libc6-compat

FROM base AS builder
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages packages
COPY apps/server apps/server

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build packages
RUN pnpm --filter @memecoin-lending/types build
RUN pnpm --filter @memecoin-lending/config build
RUN pnpm --filter @memecoin-lending/sdk build

# Build server
RUN pnpm --filter @memecoin-lending/server build

FROM base AS runner
WORKDIR /app

# Create app user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 --ingroup nodejs app

# Copy built application
COPY --from=builder --chown=app:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=app:nodejs /app/packages ./packages
COPY --from=builder --chown=app:nodejs /app/apps/server/dist ./apps/server/dist
COPY --from=builder --chown=app:nodejs /app/apps/server/package.json ./apps/server/
COPY --from=builder --chown=app:nodejs /app/apps/server/prisma ./apps/server/prisma

# Set working directory for the server
WORKDIR /app/apps/server

# Generate Prisma client
RUN npx prisma generate

# Switch to app user
USER app

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/health').then(() => process.exit(0)).catch(() => process.exit(1))"

EXPOSE 3001

CMD ["node", "dist/index.js"]