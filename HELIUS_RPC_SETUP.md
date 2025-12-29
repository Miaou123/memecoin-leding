# Helius RPC Setup Guide

All Solana RPC URLs have been updated to use Helius. You need to add your Helius API key to the following .env files:

## 1. Root .env file
```bash
SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_HELIUS_API_KEY
```

## 2. Server .env file (apps/server/.env)
```bash
SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_HELIUS_API_KEY
```

## 3. Web App .env file (apps/web/.env.local)
```bash
VITE_SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_HELIUS_API_KEY
VITE_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_HELIUS_API_KEY
```

## Getting a Helius API Key

1. Visit https://helius.dev
2. Sign up for a free account
3. Go to your dashboard and copy your API key
4. Replace `YOUR_HELIUS_API_KEY` with your actual API key in all .env files

## Updated Files

The following files have been updated to use Helius RPC:

- `/packages/config/src/networks.ts` - Main network configuration
- `/apps/web/src/routes/repay/[id].tsx` - Repay loan page
- `/apps/web/src/routes/borrow.tsx` - Borrow page
- `/apps/web/src/hooks/useTokenBalance.ts` - Token balance hook
- `/scripts/check-protocol.Ts` - Protocol check script
- `/scripts/deploy-full.ts` - Full deployment script
- `/scripts/setup-dev.ts` - Development setup script
- `/Anchor.toml` - Anchor configuration
- `/docker-compose.yml` - Docker configuration
- `/README.md` - Main documentation
- `/programs/memecoin-lending/README.md` - Program documentation

Note: The fallback URLs are now set to Helius, but will use environment variables if available.