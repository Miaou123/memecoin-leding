# Complete Post-Deployment Guide for Staking v2

## 🚨 CRITICAL: Fix SDK Before Deployment

Your SDK's `repayLoan` function is missing the new required accounts. **This MUST be fixed or loan repayments will fail.**

---

## Part 1: Fix SDK `repayLoan` Function (CRITICAL)

Update `packages/sdk/src/instructions/index.ts`:

```typescript
export async function repayLoan(
  program: Program,
  loanPubkey: PublicKey
): Promise<TransactionSignature> {
  // Fetch actual loan data from chain
  const loanAccount = await (program.account as any).loan.fetch(loanPubkey);
  if (!loanAccount) {
    throw new Error('Loan not found');
  }

  const tokenMint = loanAccount.tokenMint;
  const borrower = loanAccount.borrower;

  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  const [tokenConfig] = pda.getTokenConfigPDA(tokenMint, program.programId);
  const [treasury] = pda.getTreasuryPDA(program.programId);
  
  // Vault uses loan PDA as authority
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), loanPubkey.toBuffer()],
    program.programId
  );
  
  const borrowerTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    borrower
  );

  // === NEW: Fetch protocol state to get operations wallet ===
  const protocolStateAccount = await (program.account as any).protocolState.fetch(protocolState);
  const operationsWallet = protocolStateAccount.operationsWallet;

  // === NEW: Derive staking reward vault PDA ===
  const [stakingRewardVault] = pda.getRewardVaultPDA(program.programId);

  return program.methods
    .repayLoan()
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
    .rpc();
}

// Also update buildRepayLoanTransaction:
export async function buildRepayLoanTransaction(
  program: Program,
  loanPubkey: PublicKey,
  borrower: PublicKey
): Promise<Transaction> {
  const loanAccount = await (program.account as any).loan.fetch(loanPubkey);
  if (!loanAccount) {
    throw new Error('Loan not found');
  }

  const tokenMint = loanAccount.tokenMint;

  const [protocolState] = pda.getProtocolStatePDA(program.programId);
  const [tokenConfig] = pda.getTokenConfigPDA(tokenMint, program.programId);
  const [treasury] = pda.getTreasuryPDA(program.programId);
  
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), loanPubkey.toBuffer()],
    program.programId
  );
  
  const borrowerTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    borrower
  );

  // === NEW ===
  const protocolStateAccount = await (program.account as any).protocolState.fetch(protocolState);
  const operationsWallet = protocolStateAccount.operationsWallet;
  const [stakingRewardVault] = pda.getRewardVaultPDA(program.programId);

  const tx = await program.methods
    .repayLoan()
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
    .transaction();

  return tx;
}
```

---

## Part 2: Ensure PDA Functions Exist

Verify these exist in `packages/sdk/src/pda.ts`:

```typescript
export function getRewardVaultPDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('reward_vault')],
    programId
  );
}

export function getStakingPoolPDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('staking_pool')],
    programId
  );
}

export function getStakingVaultAuthorityPDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('staking_vault')],
    programId
  );
}

export function getUserStakePDA(
  stakingPool: PublicKey,
  user: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_stake'), stakingPool.toBuffer(), user.toBuffer()],
    programId
  );
}

export function getFeeReceiverPDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('fee_receiver')],
    programId
  );
}
```

---

## Part 3: Update Tests

Update `tests/memecoin-lending.ts` to include the new accounts in repay test:

```typescript
it("should repay loan successfully", async () => {
  // Get protocol state for operations wallet
  const protocolStateAccount = await program.account.protocolState.fetch(protocolStatePda);
  
  // Derive staking reward vault
  const [stakingRewardVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("reward_vault")],
    program.programId
  );

  const tx = await program.methods
    .repayLoan()
    .accounts({
      protocolState: protocolStatePda,
      tokenConfig: goldTokenConfigPda,
      loan: loan1Pda,
      treasury: treasuryPda,
      operationsWallet: protocolStateAccount.operationsWallet,  // NEW
      stakingRewardVault,                                       // NEW
      borrower: borrower.publicKey,
      borrowerTokenAccount: borrowerGoldTokenAccount,
      vaultTokenAccount: loan1VaultPda,
      tokenMint: goldTokenMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([borrower])
    .rpc();

  console.log(`✅ Repay loan transaction: ${tx}`);
});
```

---

## Part 4: Deployment Steps

### Step 1: Run deploy-full

```bash
pnpm --filter scripts deploy-full --network devnet
```

This will:
- Generate new program keypair
- Update program ID everywhere
- Build and deploy
- Initialize protocol (ProtocolState + Treasury)
- Fund treasury

### Step 2: Initialize Staking Pool (CRITICAL!)

⚠️ **You MUST do this before any loan repayments can work!**

The `repay_loan` instruction now requires `staking_reward_vault` to exist.

Create and run `scripts/initialize-staking.ts`:

```bash
npx tsx scripts/initialize-staking.ts \
  --network devnet \
  --token-mint <YOUR_GOVERNANCE_TOKEN_MINT> \
  --target-balance 50 \
  --base-rate 1000000 \
  --max-rate 10000000 \
  --min-rate 100000
```

**If you don't have a governance token yet**, you need to create one first or use a placeholder for testing.

### Step 3: Initialize Fee Receiver

Create and run `scripts/initialize-fee-receiver.ts`:

```bash
npx tsx scripts/initialize-fee-receiver.ts \
  --network devnet \
  --treasury-split 4000 \
  --staking-split 4000 \
  --operations-split 2000
```

### Step 4: Update Protocol Fee to 2%

```bash
npx tsx scripts/update-protocol-fees.ts \
  --network devnet \
  --protocol-fee 200
```

### Step 5: Whitelist Tokens (if needed)

```bash
pnpm --filter scripts whitelist-token --all --network devnet
```

### Step 6: Rebuild Frontend/Backend

```bash
# Rebuild SDK with new changes
pnpm --filter @memecoin-lending/sdk build

# Rebuild backend
pnpm --filter @memecoin-lending/server build

# Restart services
```

---

## Part 5: Verify Everything Works

### Test Checklist

```bash
# 1. Check protocol state
npx tsx scripts/check-protocol.ts --network devnet

# 2. Verify staking pool exists
npx tsx scripts/check-staking.ts --network devnet

# 3. Test loan creation
# (create a small test loan through UI or script)

# 4. Test loan repayment (most critical!)
# (repay the test loan - this will fail if setup is incomplete)

# 5. Test staking (if you have governance tokens)
```

### Expected Flow After Deployment

```
1. deploy-full.ts runs
   ├── Program deployed ✓
   ├── Program ID updated everywhere ✓
   ├── Protocol initialized (ProtocolState) ✓
   └── Treasury funded ✓

2. initialize-staking.ts runs
   ├── StakingPool created ✓
   ├── staking_vault (token account) created ✓
   └── reward_vault (SOL PDA) created ✓  ← CRITICAL for repay_loan!

3. initialize-fee-receiver.ts runs
   └── FeeReceiver PDA created ✓ (for creator fee distribution)

4. update-protocol-fees.ts runs
   └── Protocol fee set to 2% ✓

5. Everything works!
   ├── Loans can be created ✓
   ├── Loans can be repaid (fees distributed to 3 places) ✓
   ├── Staking works ✓
   └── Creator fees can be distributed ✓
```

---

## Part 6: Quick Reference - New PDAs

| PDA | Seeds | Purpose |
|-----|-------|---------|
| `staking_pool` | `["staking_pool"]` | Staking configuration |
| `staking_vault` | `["staking_vault"]` | Authority for staked tokens |
| `reward_vault` | `["reward_vault"]` | Holds SOL rewards |
| `user_stake` | `["user_stake", pool, user]` | Individual stake positions |
| `fee_receiver` | `["fee_receiver"]` | PumpFun creator fee receiver |

---

## Part 7: Troubleshooting

### "Account not found" on repayLoan
→ `reward_vault` doesn't exist. Run `initialize-staking.ts` first.

### "Invalid fee split configuration"
→ Splits don't sum to 10000. Check your parameters.

### "Staking pool not initialized"
→ Run `initialize-staking.ts` before staking operations.

### Loan repayment fails silently
→ Check that `operations_wallet` in ProtocolState matches what you're passing.

---

## Summary: Order of Operations

```
1. ✏️  Fix SDK repayLoan function (add new accounts)
2. ✏️  Add missing PDA functions to SDK
3. ✏️  Update tests
4. 🔨 pnpm build (rebuild everything)
5. 🚀 pnpm --filter scripts deploy-full --network devnet
6. 🎯 Initialize staking pool (CRITICAL!)
7. 💰 Initialize fee receiver
8. ⚙️  Update protocol fee to 2%
9. 📝 Whitelist tokens
10. ✅ Test everything
```

**The most critical step is #6 - without the staking pool, the `reward_vault` PDA won't exist, and loan repayments will fail!**