# PumpFun Creator Fee Claiming & Distribution System

This system automatically claims creator fees from PumpFun and distributes them through the protocol's fee distribution mechanism (40% Treasury, 40% Staking, 20% Operations).

## Overview

The admin wallet (same as program deployer) is registered as the token creator on PumpFun. Creator fees accumulate in PumpFun's vault and need to be periodically claimed and distributed.

## Components

### 1. `claim-creator-fees.ts` - Main Script
Complete end-to-end claiming and distribution:
- Checks PumpFun creator fee balance
- Claims fees to admin wallet (using PumpFun SDKs)  
- Transfers SOL to protocol's FeeReceiver PDA
- Calls `distribute_creator_fees` instruction (40/40/20 split)

### 2. `distribute-accumulated-fees.ts` - Distribution Only
Distributes fees already accumulated in FeeReceiver PDA without claiming from PumpFun.

### 3. `cron/fee-claimer.sh` - Automation
Shell script for automated claiming via cron job.

### 4. `fee-claimer.service.ts` - Backend Integration
TypeScript service for integrating into your existing server/backend.

## Installation

The required dependencies are already installed:
```bash
pnpm add -w @pump-fun/pump-sdk @pump-fun/pump-swap-sdk
```

## Usage

### Manual Claiming

**Full claim and distribution:**
```bash
npx tsx scripts/claim-creator-fees.ts --network devnet
```

**Check balances only (no claiming):**
```bash
npx tsx scripts/claim-creator-fees.ts --network devnet --check
```

**Silent mode (for automation):**
```bash
npx tsx scripts/claim-creator-fees.ts --network mainnet-beta --silent
```

### Distribution Only

If you have fees already in FeeReceiver PDA and just want to distribute:
```bash
npx tsx scripts/distribute-accumulated-fees.ts --network devnet
```

### Automation Setup

#### Option 1: Cron Job

1. Edit the cron script paths:
```bash
nano scripts/cron/fee-claimer.sh
# Update: cd /path/to/memecoin-lending
```

2. Add to crontab:
```bash
crontab -e

# Add this line (runs every hour):
0 * * * * /path/to/memecoin-lending/scripts/cron/fee-claimer.sh
```

3. Check logs:
```bash
tail -f /var/log/memecoin-lending/fee-claims.log
```

#### Option 2: Backend Integration

Import the service in your server:
```typescript
import { FeeClaimerService } from './services/fee-claimer.service.js';

// Initialize with your connection, admin keypair, and program
const feeClaimerService = new FeeClaimerService(
  connection,
  adminKeypair, 
  program
);

// Start auto-claiming every hour
feeClaimerService.startAutoClaim(60 * 60 * 1000);
```

Add API endpoints:
```typescript
// Manual trigger
app.post('/admin/claim-fees', async (req, res) => {
  const result = await feeClaimerService.manualClaim();
  res.json(result);
});

// Check balances
app.get('/admin/fee-balances', async (req, res) => {
  const balances = await feeClaimerService.getBalances();
  res.json(balances);
});
```

## Configuration

### Environment Variables
- `SOLANA_NETWORK` - Network to use (devnet/mainnet-beta)
- `SOLANA_RPC_URL` - Custom RPC endpoint (optional)

### Thresholds
- **Min claim threshold:** 0.01 SOL (configurable in script)
- **Reserve for fees:** 0.005 SOL kept in admin wallet

### Fee Distribution
- **40%** → Protocol Treasury PDA  
- **40%** → Staking Reward Vault PDA
- **20%** → Operations Wallet

## Monitoring

### Check Balances
```bash
# Quick balance check
npx tsx scripts/claim-creator-fees.ts --network mainnet-beta --check

# Sample output:
# Creator fee balance: 0.045000 SOL
# Admin wallet balance: 0.123000 SOL  
# FeeReceiver PDA balance: 0.000000 SOL
# Treasury balance: 2.456000 SOL
# Staking reward vault: 1.234000 SOL
```

### Log Monitoring
```bash
# Watch cron logs
tail -f /var/log/memecoin-lending/fee-claims.log

# Sample successful run:
# 2025-12-30 15:00:01 - Starting fee claim...
# OK: claimed=0.0450 distributed=0.0445
# 2025-12-30 15:00:05 - Completed
```

## Troubleshooting

### Common Issues

**"No fee collection instructions generated"**
- No creator fees available to claim
- PumpFun SDK connection issue
- Check network and RPC endpoint

**"Fee collection failed"** 
- Admin wallet insufficient SOL for transaction fees
- Network connectivity issues
- PumpFun program unavailable

**"Transfer failed"**
- Admin wallet lacks sufficient balance after collection
- FeeReceiver PDA derivation mismatch
- Program not properly initialized

**"Distribution failed"**
- `distribute_creator_fees` instruction missing
- Incorrect PDA derivations
- Protocol not properly initialized

### Debug Steps

1. **Check balances first:**
```bash
npx tsx scripts/claim-creator-fees.ts --check
```

2. **Verify admin keypair:**
```bash
solana address -k keys/admin.json
```

3. **Check program deployment:**
```bash
solana program show <PROGRAM_ID>
```

4. **Test with devnet first:**
```bash
npx tsx scripts/claim-creator-fees.ts --network devnet
```

### Manual Recovery

If the automated system fails, you can manually:

1. **Claim PumpFun fees:**
   - Use PumpFun's official interface
   - Or use their SDK directly

2. **Transfer to FeeReceiver:**
```bash
solana transfer <FEE_RECEIVER_PDA> <AMOUNT> --from keys/admin.json
```

3. **Distribute accumulated fees:**
```bash
npx tsx scripts/distribute-accumulated-fees.ts
```

## Security Notes

- Admin keypair has spending authority - secure it properly
- Review transaction signatures before mainnet deployment
- Monitor for unusual fee accumulation patterns
- Set up alerting for failed cron jobs

## Development

### Testing

Test on devnet first:
```bash
# Deploy your program to devnet
anchor deploy --provider.cluster devnet

# Initialize protocol
npx tsx scripts/initialize-protocol.ts --network devnet

# Initialize fee receiver  
npx tsx scripts/initialize-fee-receiver.ts --network devnet

# Test fee claiming (will likely show 0 balance)
npx tsx scripts/claim-creator-fees.ts --network devnet --check
```

### Customization

- Modify claim thresholds in `claim-creator-fees.ts`
- Adjust cron frequency in `fee-claimer.sh` 
- Change fee distribution percentages (requires program changes)
- Add monitoring/alerting integrations

## API Integration

Example webhook notification on successful claim:
```typescript
// Add to claim-creator-fees.ts after successful distribution
if (result.success && result.distributed > 0) {
  await fetch('https://your-webhook-url.com/fee-claimed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: result.distributed,
      timestamp: Date.now(),
      signatures: {
        collect: result.collectSignature,
        transfer: result.transferSignature,
        distribute: result.distributeSignature
      }
    })
  });
}
```