FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

FROM base AS builder
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages packages
COPY apps/telegram-bot apps/telegram-bot

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build packages
RUN pnpm --filter @memecoin-lending/types build
RUN pnpm --filter @memecoin-lending/config build

# Build telegram bot
RUN pnpm --filter @memecoin-lending/telegram-bot build

FROM base AS runner
WORKDIR /app

# Create app user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 --ingroup nodejs app

# Copy built application
COPY --from=builder --chown=app:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=app:nodejs /app/packages ./packages
COPY --from=builder --chown=app:nodejs /app/apps/telegram-bot/dist ./apps/telegram-bot/dist
COPY --from=builder --chown=app:nodejs /app/apps/telegram-bot/package.json ./apps/telegram-bot/

# Set working directory for the bot
WORKDIR /app/apps/telegram-bot

# Switch to app user
USER app

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD ps aux | grep "[n]ode dist/index.js" || exit 1

CMD ["node", "dist/index.js"]