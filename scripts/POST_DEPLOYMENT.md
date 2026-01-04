# Post-Deployment Initialization Guide

After running the main deployment script, you need to initialize the new staking and fee distribution systems.

## Prerequisites

- Protocol must be deployed with `pnpm --filter scripts deploy-full --network devnet`
- You need a governance token mint address for staking
- Admin keypair must be available at `../keys/admin.json`

## Required Initialization Steps

### 1. Initialize Staking Pool (CRITICAL)

**This MUST be run before any loan repayments can work!** The `repay_loan` instruction now requires the `staking_reward_vault` PDA to exist.

```bash
npx tsx scripts/initialize-staking.ts \
  --network devnet \
  --token-mint <YOUR_GOVERNANCE_TOKEN_MINT> \
  --target-balance 50 \
  --base-rate 1000000 \
  --max-rate 10000000 \
  --min-rate 100000
```

Parameters:
- `--token-mint`: Your governance token mint address (required)
- `--target-balance`: Target pool balance in SOL for optimal APR (default: 50)
- `--base-rate`: Base emission rate in lamports/second (default: 1000000)
- `--max-rate`: Max emission rate in lamports/second (default: 10000000)
- `--min-rate`: Min emission rate in lamports/second (default: 100000)

### 2. Initialize Fee Receiver

Set up the fee receiver for PumpFun creator fee distribution (40/40/20 split).

```bash
npx tsx scripts/initialize-fee-receiver.ts --network devnet
```

This will output the `fee_receiver` PDA address. **IMPORTANT**: Save this address and set it as the creator fee recipient when launching on PumpFun.

Default fee splits:
- 40% → Treasury
- 40% → Staking Rewards (for token holders!)
- 20% → Operations

### 3. Update Protocol Fee to 2%

Update the protocol fee from the default 1% to 2%.

```bash
npx tsx scripts/update-protocol-fees.ts --network devnet --protocol-fee 200
```

Fee distribution for the 2% loan fee:
- 1.0% → Treasury
- 0.5% → Staking Rewards
- 0.5% → Operations

### 4. Whitelist Tokens (Optional)

If not done already, whitelist the tokens you want to support:

```bash
pnpm --filter scripts whitelist-token --all --network devnet
```

### 5. Fund Treasury (Optional)

Add initial SOL to the treasury:

```bash
pnpm --filter scripts fund-treasury --network devnet --amount 1
```

## Using the All-in-One Deploy Script

The `deploy-full.ts` script can now handle all initialization automatically if you provide a staking token:

```bash
pnpm --filter scripts deploy-full \
  --network devnet \
  --staking-token <YOUR_GOVERNANCE_TOKEN_MINT>
```

This will:
1. Deploy the program
2. Initialize the protocol
3. Initialize staking (if token mint provided)
4. Initialize fee receiver
5. Set protocol fee to 2%
6. Fund treasury (if --fund specified)

## PDA Addresses

After initialization, these PDAs will be created:

### Staking System PDAs
- **Staking Pool**: `[seeds: ["staking_pool"]]`
- **Staking Vault Authority**: `[seeds: ["staking_vault"]]`
- **Reward Vault**: `[seeds: ["reward_vault"]]`
- **Staking Vault**: Associated token account for governance token

### Fee System PDA
- **Fee Receiver**: `[seeds: ["fee_receiver"]]`

## Integration with PumpFun

1. Run `initialize-fee-receiver.ts` and note the fee receiver PDA address
2. When launching your token on PumpFun:
   - Set the creator fee percentage (e.g., 1-5%)
   - Set the fee recipient to the `fee_receiver` PDA address
3. All creator fees will automatically be distributed:
   - 40% to treasury
   - 40% to staking rewards
   - 20% to operations

## Troubleshooting

### "Staking pool already initialized"
This is fine - the staking pool only needs to be initialized once.

### "Account does not exist" errors during loan operations
Make sure you've run `initialize-staking.ts`. The staking reward vault must exist for loans to work.

### "Insufficient SOL" errors
1. Fund your admin wallet with SOL
2. Fund the treasury using the fund-treasury script

## Next Steps

1. Test creating and repaying a loan to ensure staking integration works
2. Test staking some governance tokens
3. Add SOL to the reward vault to enable emissions
4. Monitor fee distribution from PumpFun creator fees