# NOTE: This Dockerfile is not used in the current PM2 deployment.
# It's kept for reference or future Docker-based deployments.
# Current deployment uses: pnpm pm2:start (see ecosystem.config.cjs)

# Web Dockerfile for Memecoin Lending Protocol (SolidJS)
FROM node:20-alpine AS base

# Install Python and build tools for native node modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat \
    linux-headers \
    eudev-dev

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# ============ Dependencies Stage ============
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages packages
COPY apps/web/package.json apps/web/

# Install dependencies
RUN pnpm install --frozen-lockfile

# ============ Builder Stage ============
FROM base AS builder
WORKDIR /app

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules

# Copy source
COPY packages packages
COPY apps/web apps/web
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Build arguments for environment variables
ARG VITE_API_URL
ARG VITE_WS_URL
ARG VITE_SOLANA_RPC_URL
ARG VITE_PROGRAM_ID

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_SOLANA_RPC_URL=$VITE_SOLANA_RPC_URL
ENV VITE_PROGRAM_ID=$VITE_PROGRAM_ID

# Build
RUN pnpm --filter @memecoin-lending/web build

# ============ Production Stage ============
FROM nginx:alpine AS runner

# Copy built assets
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Copy nginx config if exists
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]