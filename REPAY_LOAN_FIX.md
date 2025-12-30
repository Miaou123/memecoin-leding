# repayLoan Function Fix - Missing Accounts

## Problem
The `repay_loan` instruction was updated to include staking reward distribution, adding two new required accounts:
- `operationsWallet` - for fee distribution to operations wallet
- `stakingRewardVault` - for fee distribution to staking rewards

However, the SDK functions were not updated, causing ALL loan repayments to fail with "missing account" errors.

## Files Fixed

### 1. `packages/sdk/src/instructions/index.ts`

#### Fixed `repayLoan` function:
- Added `protocolStateAccount` fetch to get `operationsWallet`
- Added `stakingRewardVault` PDA derivation
- Updated `.accounts()` to include both new accounts

#### Fixed `buildRepayLoanTransaction` function:
- Applied the same fixes as `repayLoan`
- Ensures transaction building also works correctly

### 2. `tests/memecoin-lending.ts`

#### Fixed both repay loan tests:
- Updated "should repay loan successfully" test
- Updated "should fail to repay already repaid loan" test
- Added protocol state fetch and PDA derivation
- Fixed account names to match new instruction interface

## Technical Details

### New Required Accounts

```typescript
// Fetch protocol state to get operations wallet
const protocolStateAccount = await (program.account as any).protocolState.fetch(protocolState);
const operationsWallet = protocolStateAccount.operationsWallet;

// Derive staking reward vault PDA  
const [stakingRewardVault] = pda.getRewardVaultPDA(program.programId);
```

### Updated Account Structure

**Before:**
```typescript
.accounts({
  protocolState,
  tokenConfig,
  loan: loanPubkey,
  treasury,
  borrower,
  borrowerTokenAccount,
  vaultTokenAccount,
  tokenMint,
  tokenProgram: TOKEN_PROGRAM_ID,
  systemProgram: SystemProgram.programId,
})
```

**After:**
```typescript
.accounts({
  protocolState,
  tokenConfig,
  loan: loanPubkey,
  treasury,
  operationsWallet,           // NEW
  stakingRewardVault,         // NEW
  borrower,
  borrowerTokenAccount,
  vaultTokenAccount,
  tokenMint,
  tokenProgram: TOKEN_PROGRAM_ID,
  systemProgram: SystemProgram.programId,
})
```

## Why This Was Critical

Without these accounts:
1. All loan repayments would fail on-chain
2. Users couldn't close their loans
3. Protocol would be effectively broken for existing loans

With these fixes:
1. Loan repayments work correctly
2. Fee distribution to operations and staking works
3. Protocol operates as intended

## Verification

✅ SDK builds successfully with no TypeScript errors  
✅ Both `repayLoan` and `buildRepayLoanTransaction` functions updated  
✅ Test files updated to match new account structure  
✅ All required PDAs properly derived  

## Impact on Other Functions

This fix only affects loan repayment functions. Other functions like:
- `createLoan`
- `liquidate` functions
- Staking functions

These remain unchanged as they already had the correct account structure or don't require these specific accounts.