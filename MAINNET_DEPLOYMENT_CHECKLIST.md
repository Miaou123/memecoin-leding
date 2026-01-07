# Mainnet Deployment Checklist for Memecoin Lending Protocol

## 🚨 Critical Pre-Deployment Requirements

### 1. Smart Contract Security
- [ ] **Professional Audit Required**: Get full audit from reputable firm (Certik, Halborn, etc.)
- [ ] **Admin Keys**: Implement multi-sig wallet for admin controls (program/src/state.rs:69)
- [ ] **Timelock**: 48-hour admin transfer delay is implemented (good!)
- [ ] **Price Oracle**: Currently uses backend-signed prices - consider Pyth/Switchboard for mainnet
- [ ] **Liquidator Access**: Only authorized liquidator can liquidate - ensure this is properly managed

### 2. Environment Variables to Update

#### Backend (.env)
```bash
# Network Configuration
SOLANA_NETWORK=mainnet-beta  # Change from devnet
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_MAINNET_KEY  # Get mainnet RPC

# Program ID (will be generated during deployment)
PROGRAM_ID=YOUR_MAINNET_PROGRAM_ID

# Admin Keys (USE SECURE MULTISIG)
ADMIN_WALLET_PATH=./keys/mainnet-admin.json  # DO NOT use dev keys
ADMIN_KEYPAIR_PATH=./keys/mainnet-admin.json

# API URLs
API_URL=https://api.your-production-domain.com
WS_URL=wss://api.your-production-domain.com/ws

# Security Keys (GENERATE NEW ONES)
ADMIN_API_KEY=GENERATE_SECURE_KEY_FOR_MAINNET
JUPITER_API_KEY=YOUR_JUPITER_MAINNET_API_KEY

# Database (Production DB)
DATABASE_URL=postgresql://user:pass@production-db:5432/memecoin_lending_mainnet

# Telegram Bot (Production Bot)
TELEGRAM_BOT_TOKEN=YOUR_PRODUCTION_BOT_TOKEN
TELEGRAM_CHAT_ID=YOUR_PRODUCTION_CHAT_ID
TELEGRAM_WEBHOOK_SECRET=GENERATE_NEW_SECRET

# CORS (Production domains only)
CORS_ORIGIN=https://your-production-domain.com,https://app.your-domain.com

# Server URL
SERVER_URL=https://api.your-production-domain.com
WEB_APP_URL=https://app.your-production-domain.com
```

#### Frontend (.env)
```bash
VITE_API_URL=https://api.your-production-domain.com
VITE_WS_URL=wss://api.your-production-domain.com/ws
VITE_SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_MAINNET_KEY
VITE_PROGRAM_ID=YOUR_MAINNET_PROGRAM_ID
VITE_SOLANA_NETWORK=mainnet-beta
```

### 4. Infrastructure Requirements

#### Database
- [ ] Production PostgreSQL instance with:
  - Automated backups
  - High availability
  - Connection pooling
  - SSL connections

#### Redis
- [ ] Production Redis cluster with:
  - Persistence enabled
  - Master-slave replication
  - Automated backups

#### RPC Node
- [ ] Get production Helius/QuickNode/Alchemy subscription
- [ ] Configure rate limits appropriately
- [ ] Set up fallback RPC endpoints

























































































































































































































































































































































































































































solana-keygen new -o target/deploy/memecoin_lending-keypair.json

# 2. Update Anchor.toml with mainnet program ID
# Edit [programs.mainnet] section

# 3. Build program
anchor build

# 4. Deploy to mainnet
anchor deploy --provider.cluster mainnet-beta --provider.wallet ./keys/mainnet-deployer.json

# 5. Initialize protocol with multi-sig admin
npx tsx scripts/initialize-protocol.ts --network mainnet-beta \
  --admin-keypair ./keys/mainnet-admin.json \
  --admin <MULTISIG_WALLET_ADDRESS> \
  --buyback-wallet <BUYBACK_WALLET> \
  --operations-wallet <OPERATIONS_WALLET> \
  --liquidator <AUTHORIZED_LIQUIDATOR> \
  --price-authority <PRICE_SIGNER_PUBKEY>

# 6. Initialize fee receiver
npx tsx scripts/initialize-fee-receiver.ts --network mainnet-beta

# 7. Set protocol fees
npx tsx scripts/update-protocol-fees.ts --network mainnet-beta --protocol-fee 200

# 8. Initialize staking (if applicable)
npx tsx scripts/initialize-staking-epoch.ts --network mainnet-beta --token-mint <GOVERNANCE_TOKEN>

# 9. Fund treasury
npx tsx scripts/fund-treasury.ts --network mainnet-beta --amount <INITIAL_LIQUIDITY>

# 10. Whitelist tokens (carefully!)
npx tsx scripts/whitelist-token.ts --network mainnet-beta --token <TOKEN_MINT> --tier <TIER>
```

### 7. Testing Requirements

- [ ] Full test suite passes
- [ ] Stress testing completed
- [ ] Liquidation scenarios tested
- [ ] Emergency pause/resume tested
- [ ] Admin transfer tested
- [ ] Fee distribution tested

### 8. External Dependencies

#### Jupiter Integration
- [ ] Mainnet Jupiter API key
- [ ] Test swap routes thoroughly
- [ ] Implement fallback mechanisms

#### PumpFun Integration  
- [ ] Verify PumpFun mainnet addresses
- [ ] Test bonding curve calculations
- [ ] Ensure slippage protection works

### 9. Legal & Compliance

- [ ] Terms of Service
- [ ] Privacy Policy  
- [ ] Risk Disclaimers
- [ ] Jurisdiction restrictions
- [ ] KYC/AML requirements (if applicable)

### 10. Post-Deployment

- [ ] Verify all PDAs created correctly
- [ ] Test all user flows on mainnet
- [ ] Monitor first 24-48 hours closely
- [ ] Have emergency response plan ready
- [ ] Set up automated monitoring/alerting

## ⚠️ Critical Warnings

1. **NEVER use devnet keys on mainnet**
2. **ALWAYS use multi-sig for admin operations**
3. **TEST emergency procedures before going live**
4. **Have incident response plan ready**
5. **Start with limited liquidity and token whitelist**

## 📋 Final Checklist

- [ ] Audit completed and issues resolved
- [ ] All environment variables updated
- [ ] Multi-sig wallet configured
- [ ] Monitoring & alerts set up
- [ ] Emergency procedures tested
- [ ] Legal documents ready
- [ ] Team trained on procedures
- [ ] Incident response plan documented
- [ ] Initial liquidity secured
- [ ] Marketing/announcement ready


  📁 Created Documentation Files:

  1. MAINNET_DEPLOYMENT_CHECKLIST.md - Complete 10-section deployment
  checklist
  2. SECURITY_RECOMMENDATIONS.md - Detailed security improvements and
  monitoring
  3. MAINNET_QUICKSTART.md - Quick reference for immediate actions

  🚨 Critical Code Changes Required:

  1. Fix Mainnet RPC URL (scripts/deploy-full.ts:220):
    - Currently points to devnet even for mainnet deployment
    - Must update to use mainnet RPC endpoint
  2. Remove Hardcoded API Keys:
    - scripts/reinit-staking.cjs:6 contains hardcoded Helius API key
    - Must be removed or secured
  3. Update Network Defaults:
    - All "devnet" defaults should be configurable
    - Remove hardcoded localhost references
  4. Fix Explorer Links:
    - Remove ?cluster=devnet from transaction links

  🔐 Security Requirements:

  1. Multi-sig Admin - Single admin key is too risky
  2. Price Oracle - Add Pyth/Switchboard instead of only backend prices
  3. Professional Audit - Required before mainnet
  4. Monitoring System - 24/7 alerts for treasury, liquidations, anomalies

  💰 Infrastructure Needs:

  1. RPC Provider: Helius/QuickNode/Alchemy mainnet subscription
  2. Database: Production PostgreSQL with backups
  3. Redis: Clustered setup with persistence
  4. Domains: API and web app domains with SSL

  ⚡ Deployment Strategy:

  1. Start with limited liquidity ($100k)
  2. Whitelist only 3 established tokens initially
  3. Set conservative limits ($1k max loan)
  4. Gradually increase based on performance
  5. Have emergency pause ready

  The protocol architecture is solid with good safety mechanisms (exposure
   limits, pause functionality, liquidation system). Main concerns are
  operational security and the need for decentralized price feeds. Follow
  the checklists I've created for a safe mainnet launch.