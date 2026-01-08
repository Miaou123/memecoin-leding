# Liquidation Service Update Notes

## Current State
The liquidation service in `loan.service.ts` uses the SDK functions `liquidateWithJupiter` and `liquidateWithPumpfun` from `@memecoin-lending/sdk`.

## Required SDK Updates

### 1. Update `liquidateWithJupiter` function in SDK:
- Add Token-2022 detection similar to `loan-prepare.service.ts`
- Add PumpSwap vault detection when pool type is PumpSwap
- Pass vault accounts to the liquidation instruction

### 2. Update the SDK types/interfaces:
- Add optional `pumpswapBaseVault` and `pumpswapQuoteVault` parameters
- Add `tokenProgram` parameter that can be TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID

### 3. Example SDK implementation pattern:

```typescript
// In SDK's liquidateWithJupiter function:
async function liquidateWithJupiter(
  program: Program,
  loanPubkey: PublicKey,
  connection: Connection,
  jupiterSwapData: Buffer,
  minSolOutput: BN,
  remainingAccounts: AccountMeta[]
): Promise<string> {
  // ... existing code ...
  
  // Detect token program
  const tokenProgramId = await getTokenProgramForMint(connection, loan.tokenMint);
  
  // Check if PumpSwap and fetch vaults
  const isPumpSwap = tokenConfig.poolType === 3;
  let pumpswapBaseVault: PublicKey | null = null;
  let pumpswapQuoteVault: PublicKey | null = null;
  
  if (isPumpSwap) {
    const vaults = await getPumpSwapVaults(connection, tokenConfig.poolAddress);
    if (!vaults) {
      throw new Error('Failed to fetch PumpSwap vault accounts');
    }
    pumpswapBaseVault = vaults.baseVault;
    pumpswapQuoteVault = vaults.quoteVault;
  }
  
  // Build transaction with new accounts
  const tx = await program.methods
    .liquidate(minSolOutput, jupiterSwapData)
    .accounts({
      // ... existing accounts ...
      poolAccount: tokenConfig.poolAddress,
      pumpswapBaseVault,
      pumpswapQuoteVault,
      tokenProgram: tokenProgramId,
      // ... other accounts ...
    })
    .remainingAccounts(remainingAccounts)
    .transaction();
    
  // ... sign and send ...
}
```

## Testing Requirements

1. Test with PumpSwap token: `a3W4qutoEJA4232T2gwZUfgYJTetr96pU4SJMwppump`
2. Test with regular SPL Token
3. Test with Token-2022 token
4. Verify vault accounts are correctly fetched and passed
5. Verify liquidation works with all pool types

## Notes
- The helper functions `getTokenProgramForMint` and `getPumpSwapVaults` are already implemented in `loan-prepare.service.ts` and can be copied to the SDK
- The Anchor program already supports the optional vault accounts and TokenInterface