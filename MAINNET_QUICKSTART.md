# Mainnet Deployment Quick Reference

## 🚀 Immediate Actions Required

### 1. Fix Hardcoded Values
```bash
# Currently WRONG in scripts/deploy-full.ts:220
mainnet: process.env.SOLANA_RPC_URL || 'https://devnet.helius-rpc.com/?api-key=',
# Should be:
mainnet: process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=YOUR_KEY',

# Remove hardcoded API key in scripts/reinit-staking.cjs:6
# Delete the file or update it properly
```

### 2. Generate Production Keys
```bash
# Create keys directory for mainnet
mkdir -p keys/mainnet

# Generate admin keypair (USE MULTI-SIG INSTEAD!)
solana-keygen new -o keys/mainnet/admin.json

# Generate program keypair
solana-keygen new -o target/deploy/memecoin_lending-keypair.json

# Get the program ID
solana address -k target/deploy/memecoin_lending-keypair.json
```

### 3. Update Anchor.toml
```toml
[programs.mainnet]
memecoin_lending = "YOUR_NEW_MAINNET_PROGRAM_ID"

[provider]
cluster = "mainnet"
wallet = "./keys/mainnet/deployer.json"
```

### 4. Critical Environment Variables
```bash
# Backend .env
SOLANA_NETWORK=mainnet-beta
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
PROGRAM_ID=YOUR_MAINNET_PROGRAM_ID
ADMIN_API_KEY=GENERATE_NEW_SECURE_KEY
DATABASE_URL=postgresql://prod_user:prod_pass@prod-db:5432/memecoin_mainnet

# Frontend .env
VITE_SOLANA_NETWORK=mainnet-beta
VITE_SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
VITE_PROGRAM_ID=YOUR_MAINNET_PROGRAM_ID
VITE_API_URL=https://api.your-domain.com
```

### 5. Deployment Commands
```bash
# 1. Build
anchor build

# 2. Deploy (with confirmation)
anchor deploy --provider.cluster mainnet-beta --provider.wallet ./keys/mainnet/deployer.json

# 3. Run full deployment script
pnpm --filter scripts deploy-full --network mainnet --confirm-mainnet

# 4. Verify deployment
solana program show YOUR_PROGRAM_ID --url mainnet-beta
```

## ⚠️ Do NOT Proceed Without:

1. **Professional Security Audit**
2. **Multi-sig Wallet Setup** (Squads/Realms)
3. **Production RPC Node** (Helius/QuickNode/Alchemy)
4. **Monitoring & Alerts** configured
5. **Legal Documents** ready
6. **Incident Response Plan** documented
7. **Team Training** completed

## 📞 Emergency Contacts Setup

- On-call engineer rotation
- Security team contacts
- Legal counsel
- PR/Communications team
- Exchange/DEX contacts (if listed)

## 🎯 First 48 Hours Plan

1. Deploy with minimal liquidity ($100k)
2. Whitelist only 3 tokens (BONK, WIF, POPCAT)
3. Set low limits ($1k max loan)
4. Monitor every transaction
5. Have pause button ready
6. Check all metrics hourly
7. Be ready to respond instantly

Good luck with your mainnet deployment! 🚀