# ==============================================================================
# Server Dockerfile - Using pnpm deploy to create flat node_modules
# ==============================================================================

FROM node:20-alpine AS base

RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat \
    linux-headers \
    eudev-dev \
    openssl

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# ==============================================================================
# Dependencies stage
# ==============================================================================
FROM base AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/types/package.json packages/types/
COPY packages/sdk/package.json packages/sdk/
COPY packages/config/package.json packages/config/
COPY apps/server/package.json apps/server/

RUN pnpm install --frozen-lockfile

# ==============================================================================
# Builder stage
# ==============================================================================
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules

COPY packages packages
COPY apps/server apps/server
COPY deployments deployments
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Build types package first
RUN pnpm --filter @memecoin-lending/types build

# Build SDK
RUN pnpm --filter @memecoin-lending/sdk build

# Build config
RUN pnpm --filter @memecoin-lending/config build

# Generate Prisma
RUN pnpm --filter @memecoin-lending/server db:generate || true

# Build server
RUN pnpm --filter @memecoin-lending/server build

# ==============================================================================
# Production dependencies stage - use pnpm deploy
# ==============================================================================
FROM base AS prod-deps
WORKDIR /app

# Copy everything we need for pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages packages
COPY apps/server/package.json apps/server/
COPY deployments deployments

# Copy built packages from builder
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/types/package.json ./packages/types/
COPY --from=builder /app/packages/sdk/dist ./packages/sdk/dist  
COPY --from=builder /app/packages/sdk/package.json ./packages/sdk/
COPY --from=builder /app/packages/config/dist ./packages/config/dist
COPY --from=builder /app/packages/config/package.json ./packages/config/

# Install production dependencies
RUN pnpm install --prod --frozen-lockfile

# Use pnpm deploy to create a flat node_modules structure
RUN pnpm deploy --filter @memecoin-lending/server --prod /prod/server

# ==============================================================================
# Production stage
# ==============================================================================
FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 server

# Copy built application
COPY --from=builder --chown=server:nodejs /app/apps/server/dist ./dist
COPY --from=builder --chown=server:nodejs /app/apps/server/prisma ./prisma

# Copy flattened production dependencies from pnpm deploy
COPY --from=prod-deps --chown=server:nodejs /prod/server/package.json ./
COPY --from=prod-deps --chown=server:nodejs /prod/server/node_modules ./node_modules

# Generate Prisma client for Alpine platform
RUN npx prisma generate --schema=./prisma/schema.prisma || true

USER server

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

CMD ["node", "dist/index.js"]