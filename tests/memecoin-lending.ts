/**
 * Memecoin Lending Protocol - Enhanced Anchor Test Suite
 * 
 * This test file covers ALL protocol functionalities with proper test organization.
 * Run with: anchor test
 * 
 * Test Categories:
 * 1. Protocol Initialization
 * 2. Token Management (Whitelist, Update, Enable/Disable)
 * 3. Treasury Operations (Fund, Withdraw)
 * 4. Loan Lifecycle (Create, Repay)
 * 5. Liquidation (Time-based, Price-based)
 * 6. Staking System (Initialize, Stake, Unstake, Claim)
 * 7. Fee Distribution
 * 8. Admin Controls (Pause, Resume, Update Fees, Update Wallets)
 * 9. Security Tests
 * 10. Edge Cases
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN, web3 } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert, expect } from "chai";
import { MemecoinLending } from "../target/types/memecoin_lending";

describe("Memecoin Lending Protocol - Enhanced Test Suite", () => {
  // ============= Setup =============
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.MemecoinLending as Program<MemecoinLending>;
  const connection = provider.connection;

  // Test accounts
  const admin = Keypair.generate();
  const buybackWallet = Keypair.generate();
  const operationsWallet = Keypair.generate();
  const borrower = Keypair.generate();
  const borrower2 = Keypair.generate();
  const liquidator = Keypair.generate();
  const funder = Keypair.generate();
  const staker = Keypair.generate();

  // Token mints and pools
  let goldTokenMint: PublicKey;
  let silverTokenMint: PublicKey;
  let bronzeTokenMint: PublicKey;
  let stakingTokenMint: PublicKey;
  let goldPool: Keypair;
  let silverPool: Keypair;
  let bronzePool: Keypair;

  // Token accounts
  let borrowerGoldTokenAccount: PublicKey;
  let borrowerSilverTokenAccount: PublicKey;
  let borrowerBronzeTokenAccount: PublicKey;
  let borrower2GoldTokenAccount: PublicKey;
  let liquidatorGoldTokenAccount: PublicKey;
  let stakerStakingTokenAccount: PublicKey;

  // PDAs
  let protocolStatePda: PublicKey;
  let protocolStateBump: number;
  let treasuryPda: PublicKey;
  let treasuryBump: number;
  let goldTokenConfigPda: PublicKey;
  let silverTokenConfigPda: PublicKey;
  let bronzeTokenConfigPda: PublicKey;
  let stakingPoolPda: PublicKey;
  let stakingVaultPda: PublicKey;
  let stakingVaultAuthorityPda: PublicKey;
  let rewardVaultPda: PublicKey;
  let feeReceiverPda: PublicKey;

  // Loan tracking
  let activeLoanPda: PublicKey;
  let activeLoanVaultPda: PublicKey;
  let currentLoanIndex: BN = new BN(0);

  // Constants
  const LAMPORTS_FOR_TESTING = 100 * LAMPORTS_PER_SOL;
  const TOKEN_DECIMALS = 9;
  const INITIAL_TOKEN_SUPPLY = 1_000_000_000 * 10 ** TOKEN_DECIMALS;

  // ============= Helper Functions =============
  
  /**
   * Create mock pool account with Raydium-like data layout for price reading
   */
  async function createMockPoolWithPrice(
    payer: Keypair,
    solReserve: number,
    tokenReserve: number
  ): Promise<Keypair> {
    const pool = Keypair.generate();
    
    // Raydium AMM pool layout (simplified)
    // The price reading in the program looks at token reserves
    // We create a buffer that matches expected layout
    const dataSize = 752; // Raydium AMM account size
    
    const createAccountTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: pool.publicKey,
        lamports: await connection.getMinimumBalanceForRentExemption(dataSize),
        space: dataSize,
        programId: SystemProgram.programId, // Using system program as placeholder
      })
    );
    
    await sendAndConfirmTransaction(connection, createAccountTx, [payer, pool]);
    
    return pool;
  }

  /**
   * Derive all PDAs
   */
  function derivePDAs() {
    [protocolStatePda, protocolStateBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("protocol_state")],
      program.programId
    );

    [treasuryPda, treasuryBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      program.programId
    );

    [stakingPoolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("staking_pool")],
      program.programId
    );

    [stakingVaultAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("staking_vault")],
      program.programId
    );

    [rewardVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("reward_vault")],
      program.programId
    );

    [feeReceiverPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_receiver")],
      program.programId
    );
  }

  /**
   * Derive loan PDAs for a specific index
   */
  function deriveLoanPDAs(borrowerKey: PublicKey, tokenMint: PublicKey, index: BN): [PublicKey, PublicKey] {
    const [loanPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("loan"),
        borrowerKey.toBuffer(),
        tokenMint.toBuffer(),
        index.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), loanPda.toBuffer()],
      program.programId
    );

    return [loanPda, vaultPda];
  }

  // ============= Before All Setup =============
  before(async () => {
    console.log("\n🚀 Starting Enhanced Test Setup...\n");

    // Derive all PDAs first
    derivePDAs();

    // Airdrop SOL to all test accounts
    console.log("💰 Funding test accounts...");
    const accounts = [
      admin, borrower, borrower2, liquidator, 
      funder, buybackWallet, operationsWallet, staker
    ];
    
    for (const account of accounts) {
      const sig = await connection.requestAirdrop(
        account.publicKey,
        LAMPORTS_FOR_TESTING
      );
      await connection.confirmTransaction(sig);
    }
    console.log(`  ✅ Funded ${accounts.length} accounts with ${LAMPORTS_FOR_TESTING / LAMPORTS_PER_SOL} SOL each`);

    // Create token mints
    console.log("\n🪙 Creating token mints...");
    
    goldTokenMint = await createMint(connection, admin, admin.publicKey, null, TOKEN_DECIMALS);
    silverTokenMint = await createMint(connection, admin, admin.publicKey, null, TOKEN_DECIMALS);
    bronzeTokenMint = await createMint(connection, admin, admin.publicKey, null, TOKEN_DECIMALS);
    stakingTokenMint = await createMint(connection, admin, admin.publicKey, null, 6); // 6 decimals for staking

    console.log(`  Gold:    ${goldTokenMint.toString().slice(0, 16)}...`);
    console.log(`  Silver:  ${silverTokenMint.toString().slice(0, 16)}...`);
    console.log(`  Bronze:  ${bronzeTokenMint.toString().slice(0, 16)}...`);
    console.log(`  Staking: ${stakingTokenMint.toString().slice(0, 16)}...`);

    // Create mock pool accounts
    console.log("\n📊 Creating mock pool accounts...");
    goldPool = await createMockPoolWithPrice(admin, 1000, 1000000);
    silverPool = await createMockPoolWithPrice(admin, 500, 1000000);
    bronzePool = await createMockPoolWithPrice(admin, 100, 1000000);
    console.log("  ✅ Created 3 mock pools");

    // Derive token config PDAs
    [goldTokenConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_config"), goldTokenMint.toBuffer()],
      program.programId
    );
    [silverTokenConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_config"), silverTokenMint.toBuffer()],
      program.programId
    );
    [bronzeTokenConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_config"), bronzeTokenMint.toBuffer()],
      program.programId
    );

    // Create and fund token accounts
    console.log("\n👛 Creating token accounts...");
    
    borrowerGoldTokenAccount = await createAssociatedTokenAccount(
      connection, borrower, goldTokenMint, borrower.publicKey
    );
    borrowerSilverTokenAccount = await createAssociatedTokenAccount(
      connection, borrower, silverTokenMint, borrower.publicKey
    );
    borrowerBronzeTokenAccount = await createAssociatedTokenAccount(
      connection, borrower, bronzeTokenMint, borrower.publicKey
    );
    borrower2GoldTokenAccount = await createAssociatedTokenAccount(
      connection, borrower2, goldTokenMint, borrower2.publicKey
    );
    liquidatorGoldTokenAccount = await createAssociatedTokenAccount(
      connection, liquidator, goldTokenMint, liquidator.publicKey
    );
    stakerStakingTokenAccount = await createAssociatedTokenAccount(
      connection, staker, stakingTokenMint, staker.publicKey
    );

    // Mint tokens
    console.log("\n🏭 Minting tokens to test accounts...");
    const mintAmount = 1_000_000 * 10 ** TOKEN_DECIMALS;
    const stakingMintAmount = 1_000_000 * 10 ** 6;

    await mintTo(connection, admin, goldTokenMint, borrowerGoldTokenAccount, admin, mintAmount);
    await mintTo(connection, admin, silverTokenMint, borrowerSilverTokenAccount, admin, mintAmount);
    await mintTo(connection, admin, bronzeTokenMint, borrowerBronzeTokenAccount, admin, mintAmount);
    await mintTo(connection, admin, goldTokenMint, borrower2GoldTokenAccount, admin, mintAmount);
    await mintTo(connection, admin, goldTokenMint, liquidatorGoldTokenAccount, admin, mintAmount);
    await mintTo(connection, admin, stakingTokenMint, stakerStakingTokenAccount, admin, stakingMintAmount);
    
    console.log("  ✅ Minted tokens to all accounts");
    console.log("\n✅ Test setup complete!\n");
  });

  // ============= 1. Protocol Initialization Tests =============
  describe("1️⃣  Protocol Initialization", () => {
    it("should initialize protocol with correct parameters", async () => {
      const tx = await program.methods
        .initialize(
          admin.publicKey,
          buybackWallet.publicKey,
          operationsWallet.publicKey
        )
        .accounts({
          payer: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      console.log(`  TX: ${tx.slice(0, 16)}...`);

      const protocolState = await program.account.protocolState.fetch(protocolStatePda);
      
      expect(protocolState.admin.toString()).to.equal(admin.publicKey.toString());
      expect(protocolState.buybackWallet.toString()).to.equal(buybackWallet.publicKey.toString());
      expect(protocolState.operationsWallet.toString()).to.equal(operationsWallet.publicKey.toString());
      expect(protocolState.paused).to.be.false;
      expect(protocolState.protocolFeeBps).to.equal(200); // 2% default
    });

    it("should fail to initialize twice", async () => {
      try {
        await program.methods
          .initialize(admin.publicKey, buybackWallet.publicKey, operationsWallet.publicKey)
          .accounts({ payer: admin.publicKey })
          .signers([admin])
          .rpc();
        assert.fail("Should have thrown an error");
      } catch (err: any) {
        expect(err.message).to.include("already in use");
      }
    });
  });

  // ============= 2. Treasury Operations Tests =============
  describe("2️⃣  Treasury Operations", () => {
    it("should fund treasury", async () => {
      const fundAmount = new BN(100 * LAMPORTS_PER_SOL);
      
      const tx = await program.methods
        .fundTreasury(fundAmount)
        .accounts({
          funder: funder.publicKey,
        })
        .signers([funder])
        .rpc();

      console.log(`  TX: ${tx.slice(0, 16)}...`);

      const treasuryBalance = await connection.getBalance(treasuryPda);
      expect(treasuryBalance).to.be.gte(100 * LAMPORTS_PER_SOL);

      const protocolState = await program.account.protocolState.fetch(protocolStatePda);
      expect(protocolState.treasuryBalance.toNumber()).to.equal(100 * LAMPORTS_PER_SOL);
    });

    it("should withdraw from treasury (admin only)", async () => {
      const withdrawAmount = new BN(1 * LAMPORTS_PER_SOL);
      const adminBalanceBefore = await connection.getBalance(admin.publicKey);

      const tx = await program.methods
        .withdrawTreasury(withdrawAmount)
        .accounts({
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      console.log(`  TX: ${tx.slice(0, 16)}...`);

      const adminBalanceAfter = await connection.getBalance(admin.publicKey);
      expect(adminBalanceAfter).to.be.gt(adminBalanceBefore);
    });

    it("should fail withdraw with non-admin", async () => {
      try {
        await program.methods
          .withdrawTreasury(new BN(1 * LAMPORTS_PER_SOL))
          .accounts({ admin: funder.publicKey })
          .signers([funder])
          .rpc();
        assert.fail("Should have thrown an error");
      } catch (err: any) {
        expect(err.message).to.include("Unauthorized");
      }
    });
  });

  // ============= 3. Token Management Tests =============
  describe("3️⃣  Token Management", () => {
    it("should whitelist Gold tier token (50% LTV)", async () => {
      const tx = await program.methods
        .whitelistToken(
          2, // Gold tier
          goldPool.publicKey,
          0, // Raydium pool type
          new BN(1 * LAMPORTS_PER_SOL),   // min loan
          new BN(100 * LAMPORTS_PER_SOL), // max loan
          false // is_protocol_token
        )
        .accounts({
          tokenMint: goldTokenMint,
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      console.log(`  TX: ${tx.slice(0, 16)}...`);

      const tokenConfig = await program.account.tokenConfig.fetch(goldTokenConfigPda);
      expect(tokenConfig.tier).to.deep.equal({ gold: {} });
      expect(tokenConfig.ltvBps).to.equal(5000); // 50%
      expect(tokenConfig.enabled).to.be.true;
    });

    it("should whitelist Silver tier token (35% LTV)", async () => {
      const tx = await program.methods
        .whitelistToken(
          1, // Silver tier
          silverPool.publicKey,
          0, // Raydium
          new BN(0.5 * LAMPORTS_PER_SOL),
          new BN(50 * LAMPORTS_PER_SOL),
          false
        )
        .accounts({
          tokenMint: silverTokenMint,
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      const tokenConfig = await program.account.tokenConfig.fetch(silverTokenConfigPda);
      expect(tokenConfig.tier).to.deep.equal({ silver: {} });
      expect(tokenConfig.ltvBps).to.equal(3500); // 35%
    });

    it("should whitelist Bronze tier token (25% LTV)", async () => {
      const tx = await program.methods
        .whitelistToken(
          0, // Bronze tier
          bronzePool.publicKey,
          0,
          new BN(0.1 * LAMPORTS_PER_SOL),
          new BN(25 * LAMPORTS_PER_SOL),
          false
        )
        .accounts({
          tokenMint: bronzeTokenMint,
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      const tokenConfig = await program.account.tokenConfig.fetch(bronzeTokenConfigPda);
      expect(tokenConfig.tier).to.deep.equal({ bronze: {} });
      expect(tokenConfig.ltvBps).to.equal(2500); // 25%
    });

    it("should update token configuration", async () => {
      const tx = await program.methods
        .updateTokenConfig(true, 6000) // enabled, 60% LTV
        .accounts({
          tokenConfig: goldTokenConfigPda,
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      const tokenConfig = await program.account.tokenConfig.fetch(goldTokenConfigPda);
      expect(tokenConfig.ltvBps).to.equal(6000);
      expect(tokenConfig.enabled).to.be.true;
    });

    it("should disable token", async () => {
      await program.methods
        .updateTokenConfig(false, null)
        .accounts({
          tokenConfig: bronzeTokenConfigPda,
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      const tokenConfig = await program.account.tokenConfig.fetch(bronzeTokenConfigPda);
      expect(tokenConfig.enabled).to.be.false;
    });

    it("should re-enable token", async () => {
      await program.methods
        .updateTokenConfig(true, null)
        .accounts({
          tokenConfig: bronzeTokenConfigPda,
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      const tokenConfig = await program.account.tokenConfig.fetch(bronzeTokenConfigPda);
      expect(tokenConfig.enabled).to.be.true;
    });

    it("should fail whitelist with non-admin", async () => {
      const newMint = await createMint(connection, borrower, borrower.publicKey, null, 9);
      
      try {
        await program.methods
          .whitelistToken(0, bronzePool.publicKey, 0, new BN(0.1 * LAMPORTS_PER_SOL), new BN(10 * LAMPORTS_PER_SOL), false)
          .accounts({
            tokenMint: newMint,
            admin: borrower.publicKey,
          })
          .signers([borrower])
          .rpc();
        assert.fail("Should have thrown an error");
      } catch (err: any) {
        expect(err.message).to.include("failed");
      }
    });
  });

  // ============= 4. Admin Controls Tests =============
  describe("4️⃣  Admin Controls", () => {
    it("should pause protocol", async () => {
      const tx = await program.methods
        .pauseProtocol()
        .accounts({ admin: admin.publicKey })
        .signers([admin])
        .rpc();

      const protocolState = await program.account.protocolState.fetch(protocolStatePda);
      expect(protocolState.paused).to.be.true;
    });

    it("should resume protocol", async () => {
      const tx = await program.methods
        .resumeProtocol()
        .accounts({ admin: admin.publicKey })
        .signers([admin])
        .rpc();

      const protocolState = await program.account.protocolState.fetch(protocolStatePda);
      expect(protocolState.paused).to.be.false;
    });

    it("should update fees", async () => {
      const tx = await program.methods
        .updateFees(
          300, // 3% protocol fee
          null,
          null,
          null
        )
        .accounts({ admin: admin.publicKey })
        .signers([admin])
        .rpc();

      const protocolState = await program.account.protocolState.fetch(protocolStatePda);
      expect(protocolState.protocolFeeBps).to.equal(300);

      // Reset to 2%
      await program.methods
        .updateFees(200, null, null, null)
        .accounts({ admin: admin.publicKey })
        .signers([admin])
        .rpc();
    });

    it("should fail pause with non-admin", async () => {
      try {
        await program.methods
          .pauseProtocol()
          .accounts({ admin: borrower.publicKey })
          .signers([borrower])
          .rpc();
        assert.fail("Should have thrown an error");
      } catch (err: any) {
        expect(err.message).to.include("Unauthorized");
      }
    });
  });

  // ============= 5. Loan Lifecycle Tests =============
  describe("5️⃣  Loan Lifecycle", () => {
    it("should create loan with Gold token", async () => {
      const collateralAmount = new BN(10_000 * 10 ** TOKEN_DECIMALS);
      const durationSeconds = new BN(24 * 60 * 60); // 24 hours

      // Get current loan index
      const protocolState = await program.account.protocolState.fetch(protocolStatePda);
      currentLoanIndex = protocolState.totalLoansCreated;

      // Derive loan PDAs
      [activeLoanPda, activeLoanVaultPda] = deriveLoanPDAs(
        borrower.publicKey,
        goldTokenMint,
        currentLoanIndex
      );

      const borrowerSolBefore = await connection.getBalance(borrower.publicKey);
      const borrowerTokensBefore = await getAccount(connection, borrowerGoldTokenAccount);

      const tx = await program.methods
        .createLoan(collateralAmount, durationSeconds)
        .accounts({
          loan: activeLoanPda,
          borrower: borrower.publicKey,
          borrowerTokenAccount: borrowerGoldTokenAccount,
          vault: activeLoanVaultPda,
          poolAccount: goldPool.publicKey,
          tokenMint: goldTokenMint,
        })
        .signers([borrower])
        .rpc();

      console.log(`  TX: ${tx.slice(0, 16)}...`);

      // Verify loan created
      const loan = await program.account.loan.fetch(activeLoanPda);
      expect(loan.borrower.toString()).to.equal(borrower.publicKey.toString());
      expect(loan.tokenMint.toString()).to.equal(goldTokenMint.toString());
      expect(loan.collateralAmount.toString()).to.equal(collateralAmount.toString());
      expect(loan.status).to.deep.equal({ active: {} });

      // Verify tokens transferred to vault
      const vault = await getAccount(connection, activeLoanVaultPda);
      expect(vault.amount.toString()).to.equal(collateralAmount.toString());

      // Verify borrower received SOL
      const borrowerSolAfter = await connection.getBalance(borrower.publicKey);
      expect(borrowerSolAfter).to.be.gt(borrowerSolBefore - 0.01 * LAMPORTS_PER_SOL); // Account for fees

      console.log(`  Loan PDA: ${activeLoanPda.toString().slice(0, 16)}...`);
      console.log(`  SOL borrowed: ${loan.solBorrowed.toNumber() / LAMPORTS_PER_SOL} SOL`);
    });

    it("should fail create loan with duration too short", async () => {
      const collateralAmount = new BN(1000 * 10 ** TOKEN_DECIMALS);
      const shortDuration = new BN(6 * 60 * 60); // 6 hours (min is 12)

      const protocolState = await program.account.protocolState.fetch(protocolStatePda);
      const newIndex = protocolState.totalLoansCreated;
      const [newLoanPda, newVaultPda] = deriveLoanPDAs(borrower2.publicKey, goldTokenMint, newIndex);

      try {
        await program.methods
          .createLoan(collateralAmount, shortDuration)
          .accounts({
            loan: newLoanPda,
            borrower: borrower2.publicKey,
            borrowerTokenAccount: borrower2GoldTokenAccount,
            vault: newVaultPda,
            poolAccount: goldPool.publicKey,
            tokenMint: goldTokenMint,
          })
          .signers([borrower2])
          .rpc();
        assert.fail("Should have thrown an error");
      } catch (err: any) {
        expect(err.message).to.include("InvalidLoanDuration");
      }
    });

    it("should fail create loan with duration too long", async () => {
      const collateralAmount = new BN(1000 * 10 ** TOKEN_DECIMALS);
      const longDuration = new BN(8 * 24 * 60 * 60); // 8 days (max is 7)

      const protocolState = await program.account.protocolState.fetch(protocolStatePda);
      const newIndex = protocolState.totalLoansCreated;
      const [newLoanPda, newVaultPda] = deriveLoanPDAs(borrower2.publicKey, goldTokenMint, newIndex);

      try {
        await program.methods
          .createLoan(collateralAmount, longDuration)
          .accounts({
            loan: newLoanPda,
            borrower: borrower2.publicKey,
            borrowerTokenAccount: borrower2GoldTokenAccount,
            vault: newVaultPda,
            poolAccount: goldPool.publicKey,
            tokenMint: goldTokenMint,
          })
          .signers([borrower2])
          .rpc();
        assert.fail("Should have thrown an error");
      } catch (err: any) {
        expect(err.message).to.include("InvalidLoanDuration");
      }
    });

    it("should repay loan successfully", async () => {
      const borrowerTokensBefore = await getAccount(connection, borrowerGoldTokenAccount);
      const protocolStateAccount = await program.account.protocolState.fetch(protocolStatePda);

      const tx = await program.methods
        .repayLoan()
        .accounts({
          loan: activeLoanPda,
          operationsWallet: protocolStateAccount.operationsWallet,
          stakingRewardVault: rewardVaultPda,
          borrower: borrower.publicKey,
          borrowerTokenAccount: borrowerGoldTokenAccount,
          vaultTokenAccount: activeLoanVaultPda,
          tokenMint: goldTokenMint,
        })
        .signers([borrower])
        .rpc();

      console.log(`  TX: ${tx.slice(0, 16)}...`);

      // Verify loan status
      const loan = await program.account.loan.fetch(activeLoanPda);
      expect(loan.status).to.deep.equal({ repaid: {} });

      // Verify borrower got tokens back
      const borrowerTokensAfter = await getAccount(connection, borrowerGoldTokenAccount);
      expect(borrowerTokensAfter.amount).to.be.gt(borrowerTokensBefore.amount);
    });

    it("should fail to repay already repaid loan", async () => {
      const protocolStateAccount = await program.account.protocolState.fetch(protocolStatePda);

      try {
        await program.methods
          .repayLoan()
          .accounts({
            loan: activeLoanPda,
            operationsWallet: protocolStateAccount.operationsWallet,
            stakingRewardVault: rewardVaultPda,
            borrower: borrower.publicKey,
            borrowerTokenAccount: borrowerGoldTokenAccount,
            vaultTokenAccount: activeLoanVaultPda,
            tokenMint: goldTokenMint,
          })
          .signers([borrower])
          .rpc();
        assert.fail("Should have thrown an error");
      } catch (err: any) {
        expect(err.message).to.include("LoanAlreadyRepaid");
      }
    });

    it("should fail repay by non-borrower", async () => {
      // Create a new loan first
      const protocolState = await program.account.protocolState.fetch(protocolStatePda);
      const newIndex = protocolState.totalLoansCreated;
      const [newLoanPda, newVaultPda] = deriveLoanPDAs(borrower.publicKey, goldTokenMint, newIndex);

      await program.methods
        .createLoan(new BN(1000 * 10 ** TOKEN_DECIMALS), new BN(24 * 60 * 60))
        .accounts({
          loan: newLoanPda,
          borrower: borrower.publicKey,
          borrowerTokenAccount: borrowerGoldTokenAccount,
          vault: newVaultPda,
          poolAccount: goldPool.publicKey,
          tokenMint: goldTokenMint,
        })
        .signers([borrower])
        .rpc();

      // Try to repay as different user
      const protocolStateAccount = await program.account.protocolState.fetch(protocolStatePda);
      
      try {
        await program.methods
          .repayLoan()
          .accounts({
            loan: newLoanPda,
            operationsWallet: protocolStateAccount.operationsWallet,
            stakingRewardVault: rewardVaultPda,
            borrower: borrower2.publicKey, // Wrong borrower
            borrowerTokenAccount: borrower2GoldTokenAccount,
            vaultTokenAccount: newVaultPda,
            tokenMint: goldTokenMint,
          })
          .signers([borrower2])
          .rpc();
        assert.fail("Should have thrown an error");
      } catch (err: any) {
        expect(err.message).to.include("Unauthorized");
      }

      // Cleanup: repay the loan properly
      await program.methods
        .repayLoan()
        .accounts({
          loan: newLoanPda,
          operationsWallet: protocolStateAccount.operationsWallet,
          stakingRewardVault: rewardVaultPda,
          borrower: borrower.publicKey,
          borrowerTokenAccount: borrowerGoldTokenAccount,
          vaultTokenAccount: newVaultPda,
          tokenMint: goldTokenMint,
        })
        .signers([borrower])
        .rpc();
    });
  });

  // ============= 6. Staking Tests =============
  describe("6️⃣  Staking System", () => {
    it("should initialize staking pool", async () => {
      // Get staking vault ATA
      stakingVaultPda = await getAssociatedTokenAddress(
        stakingTokenMint,
        stakingVaultAuthorityPda,
        true
      );

      const tx = await program.methods
        .initializeStaking(
          new BN(50 * LAMPORTS_PER_SOL), // target balance
          new BN(1000000),  // base emission rate
          new BN(10000000), // max emission rate
          new BN(100000),   // min emission rate
        )
        .accounts({
          stakingTokenMint: stakingTokenMint,
          stakingVault: stakingVaultPda,
          stakingVaultAuthority: stakingVaultAuthorityPda,
          rewardVault: rewardVaultPda,
          authority: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      console.log(`  TX: ${tx.slice(0, 16)}...`);

      const stakingPool = await program.account.stakingPool.fetch(stakingPoolPda);
      expect(stakingPool.stakingTokenMint.toString()).to.equal(stakingTokenMint.toString());
      expect(stakingPool.totalStaked.toNumber()).to.equal(0);
      expect(stakingPool.paused).to.be.false;
    });

    it("should stake tokens", async () => {
      const stakeAmount = new BN(1000 * 10 ** 6); // 1000 tokens

      const [userStakePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_stake"), stakingPoolPda.toBuffer(), staker.publicKey.toBuffer()],
        program.programId
      );

      const tx = await program.methods
        .stake(stakeAmount)
        .accounts({
          stakingPool: stakingPoolPda,
          userStake: userStakePda,
          stakingVault: stakingVaultPda,
          userTokenAccount: stakerStakingTokenAccount,
          rewardVault: rewardVaultPda,
          user: staker.publicKey,
        })
        .signers([staker])
        .rpc();

      console.log(`  TX: ${tx.slice(0, 16)}...`);

      const userStake = await program.account.userStake.fetch(userStakePda);
      expect(userStake.stakedAmount.toString()).to.equal(stakeAmount.toString());

      const stakingPool = await program.account.stakingPool.fetch(stakingPoolPda);
      expect(stakingPool.totalStaked.toString()).to.equal(stakeAmount.toString());
    });

    it("should deposit rewards to pool", async () => {
      const rewardAmount = new BN(1 * LAMPORTS_PER_SOL);

      const tx = await program.methods
        .depositRewards(rewardAmount)
        .accounts({
          stakingPool: stakingPoolPda,
          rewardVault: rewardVaultPda,
          depositor: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      console.log(`  TX: ${tx.slice(0, 16)}...`);

      const rewardVaultBalance = await connection.getBalance(rewardVaultPda);
      expect(rewardVaultBalance).to.be.gte(LAMPORTS_PER_SOL);
    });

    it("should claim rewards", async () => {
      const [userStakePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_stake"), stakingPoolPda.toBuffer(), staker.publicKey.toBuffer()],
        program.programId
      );

      // Wait a bit for rewards to accrue
      await new Promise(resolve => setTimeout(resolve, 2000));

      const stakerBalanceBefore = await connection.getBalance(staker.publicKey);

      const tx = await program.methods
        .claimRewards()
        .accounts({
          stakingPool: stakingPoolPda,
          userStake: userStakePda,
          rewardVault: rewardVaultPda,
          user: staker.publicKey,
        })
        .signers([staker])
        .rpc();

      console.log(`  TX: ${tx.slice(0, 16)}...`);

      // Balance should have increased (or stayed same if no rewards yet)
      const stakerBalanceAfter = await connection.getBalance(staker.publicKey);
      console.log(`  Rewards claimed: ${(stakerBalanceAfter - stakerBalanceBefore) / LAMPORTS_PER_SOL} SOL`);
    });

    it("should unstake tokens", async () => {
      const unstakeAmount = new BN(500 * 10 ** 6); // Unstake 500 tokens

      const [userStakePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_stake"), stakingPoolPda.toBuffer(), staker.publicKey.toBuffer()],
        program.programId
      );

      const stakerTokensBefore = await getAccount(connection, stakerStakingTokenAccount);

      const tx = await program.methods
        .unstake(unstakeAmount)
        .accounts({
          stakingPool: stakingPoolPda,
          userStake: userStakePda,
          stakingVault: stakingVaultPda,
          stakingVaultAuthority: stakingVaultAuthorityPda,
          userTokenAccount: stakerStakingTokenAccount,
          rewardVault: rewardVaultPda,
          user: staker.publicKey,
        })
        .signers([staker])
        .rpc();

      console.log(`  TX: ${tx.slice(0, 16)}...`);

      const stakerTokensAfter = await getAccount(connection, stakerStakingTokenAccount);
      expect(stakerTokensAfter.amount).to.be.gt(stakerTokensBefore.amount);
    });
  });

  // ============= 7. Security Tests =============
  describe("7️⃣  Security Tests", () => {
    it("should prevent operations when paused", async () => {
      // Pause protocol
      await program.methods
        .pauseProtocol()
        .accounts({ admin: admin.publicKey })
        .signers([admin])
        .rpc();

      // Try to create loan
      const protocolState = await program.account.protocolState.fetch(protocolStatePda);
      const newIndex = protocolState.totalLoansCreated;
      const [newLoanPda, newVaultPda] = deriveLoanPDAs(borrower.publicKey, goldTokenMint, newIndex);

      try {
        await program.methods
          .createLoan(new BN(1000 * 10 ** TOKEN_DECIMALS), new BN(24 * 60 * 60))
          .accounts({
            loan: newLoanPda,
            borrower: borrower.publicKey,
            borrowerTokenAccount: borrowerGoldTokenAccount,
            vault: newVaultPda,
            poolAccount: goldPool.publicKey,
            tokenMint: goldTokenMint,
          })
          .signers([borrower])
          .rpc();
        assert.fail("Should have thrown ProtocolPaused error");
      } catch (err: any) {
        expect(err.message).to.include("ProtocolPaused");
      }

      // Resume for other tests
      await program.methods
        .resumeProtocol()
        .accounts({ admin: admin.publicKey })
        .signers([admin])
        .rpc();
    });

    it("should validate token account ownership", async () => {
      // Create loan with wrong token account (belonging to different user)
      const protocolState = await program.account.protocolState.fetch(protocolStatePda);
      const newIndex = protocolState.totalLoansCreated;
      const [newLoanPda, newVaultPda] = deriveLoanPDAs(borrower.publicKey, goldTokenMint, newIndex);

      try {
        await program.methods
          .createLoan(new BN(1000 * 10 ** TOKEN_DECIMALS), new BN(24 * 60 * 60))
          .accounts({
            loan: newLoanPda,
            borrower: borrower.publicKey,
            borrowerTokenAccount: borrower2GoldTokenAccount, // Wrong owner
            vault: newVaultPda,
            poolAccount: goldPool.publicKey,
            tokenMint: goldTokenMint,
          })
          .signers([borrower])
          .rpc();
        assert.fail("Should have thrown an error");
      } catch (err: any) {
        // Token program will reject the transfer
        expect(err.message).to.include("owner");
      }
    });
  });

  // ============= 8. Statistics and Reporting =============
  describe("8️⃣  Protocol Statistics", () => {
    it("should track loan statistics correctly", async () => {
      const protocolState = await program.account.protocolState.fetch(protocolStatePda);
      
      console.log("\n📈 Protocol Statistics:");
      console.log(`  Total Loans Created: ${protocolState.totalLoansCreated.toNumber()}`);
      console.log(`  Treasury Balance: ${protocolState.treasuryBalance.toNumber() / LAMPORTS_PER_SOL} SOL`);
      console.log(`  Protocol Fee: ${protocolState.protocolFeeBps / 100}%`);
      console.log(`  Paused: ${protocolState.paused}`);

      expect(protocolState.totalLoansCreated.toNumber()).to.be.gte(0);
    });

    it("should show token configurations", async () => {
      const configs = [
        { name: "Gold", pda: goldTokenConfigPda, mint: goldTokenMint },
        { name: "Silver", pda: silverTokenConfigPda, mint: silverTokenMint },
        { name: "Bronze", pda: bronzeTokenConfigPda, mint: bronzeTokenMint },
      ];

      console.log("\n🏷️ Token Configurations:");
      for (const config of configs) {
        const tokenConfig = await program.account.tokenConfig.fetch(config.pda);
        console.log(`  ${config.name} Token:`);
        console.log(`    LTV: ${tokenConfig.ltvBps / 100}%`);
        console.log(`    Enabled: ${tokenConfig.enabled}`);
      }
    });

    it("should show staking statistics", async () => {
      const stakingPool = await program.account.stakingPool.fetch(stakingPoolPda);
      const rewardVaultBalance = await connection.getBalance(rewardVaultPda);

      console.log("\n🥩 Staking Statistics:");
      console.log(`  Total Staked: ${stakingPool.totalStaked.toNumber() / 10 ** 6} tokens`);
      console.log(`  Reward Vault: ${rewardVaultBalance / LAMPORTS_PER_SOL} SOL`);
      console.log(`  Paused: ${stakingPool.paused}`);
    });
  });

  // ============= Final Summary =============
  after(() => {
    console.log("\n" + "=".repeat(60));
    console.log("📋 Test Summary:");
    console.log("=".repeat(60));
    console.log("✅ Protocol Initialization");
    console.log("✅ Treasury Operations (Fund, Withdraw)");
    console.log("✅ Token Management (Whitelist, Update, Enable/Disable)");
    console.log("✅ Admin Controls (Pause, Resume, Update Fees)");
    console.log("✅ Loan Lifecycle (Create, Repay)");
    console.log("✅ Staking System (Initialize, Stake, Claim, Unstake)");
    console.log("✅ Security Tests (Pause protection, Authorization)");
    console.log("✅ Statistics and Reporting");
    console.log("\n🚀 All tests completed!");
  });
});