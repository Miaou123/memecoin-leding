# Update Pool Address Guide

This guide will help you update the pool address for token `a3W4qutoEJA4232T2gwZUfgYJTetr96pU4SJMwppump` from the incorrect address to the correct PumpSwap pool address.

## Changes Made

1. **Updated `update_token_config` instruction** to accept `pool_address` and `pool_type` parameters
2. **Built the updated program** with the new functionality
3. **Created deployment and update scripts**

## Current vs Target State

- **Token**: `a3W4qutoEJA4232T2gwZUfgYJTetr96pU4SJMwppump`
- **Current pool address** (wrong): `6oD3jvsnkncMKt2cT1pwysfy5wuHtY8aEiXXmYVysEF`
- **Correct pool address**: `4qxSqMh6iEdbdvtMp8r5MK2psAGKNk57PfGeVo2VhczQ`

## Step-by-Step Execution

### 1. Deploy the Updated Program

Run the deployment script:
```bash
./scripts/deploy-and-update.sh
```

This script will:
- Check if the program needs to be extended (new size vs current size)
- Extend if necessary
- Create a buffer and upgrade the program
- Update the IDL on-chain

### 2. Update the Pool Address

After successful deployment, run:
```bash
npx tsx scripts/update-pool-address.ts
```

This will:
- Connect to mainnet
- Use the admin keypair from `keys/admin.json`
- Call `updateTokenConfig` to update only the pool address
- Verify the update was successful

### 3. Verify the Fix

The script will show:
- Current pool address
- Transaction signature
- Updated pool address
- Verification that the pool account exists

### 4. Test Loan Creation

After updating, restart the server and test:
```bash
cd apps/server && pnpm dev
```

Try creating a loan with token `a3W4qutoEJA4232T2gwZUfgYJTetr96pU4SJMwppump`.

You should see in the logs:
- `[PrepareLoan] Token config poolType: {"pumpSwap":{}}`
- `[PrepareLoan] Pool type key: pumpSwap isPumpSwap: true`
- `[PrepareLoan] PumpSwap token detected, vaults fetched`
- `[PrepareLoan] Using Token-2022 for a3W4quto...`

## Troubleshooting

### If deployment fails with "account data too small"
The program needs extension. The script handles this automatically, but if it fails:
```bash
# Manually extend by 20KB
solana program extend 2NVfyczy1rWMdb7Y9kGmHCZkM72wyYiN5ry8dntzBK2S 20480 -u m -k ./keys/admin.json
```

### If update-pool-address.ts fails
Check:
1. Admin key exists at `keys/admin.json`
2. Admin key has SOL for transaction fees
3. Program was successfully deployed

### To verify current token config
```bash
npx tsx scripts/check-pool-address.ts
```

## Expected Results

After successful update:
- Pool address will be: `4qxSqMh6iEdbdvtMp8r5MK2psAGKNk57PfGeVo2VhczQ`
- Pool account will exist with 301 bytes
- Loan creation will work with proper PumpSwap vault detection

## Notes

- The `poolType` remains as `pumpSwap` (no change needed)
- Only the `poolAddress` is being updated
- No other token config parameters are modified