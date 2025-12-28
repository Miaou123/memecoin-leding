import * as anchor from "@coral-xyz/anchor";
import { Program, BN, web3 } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert, expect } from "chai";
import { MemecoinLending } from "../target/types/memecoin_lending";

describe("memecoin-lending", () => {
  // Configure the client
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.MemecoinLending as Program<MemecoinLending>;
  const connection = provider.connection;

  // Test accounts
  const admin = Keypair.generate();
  const buybackWallet = Keypair.generate();
  const operationsWallet = Keypair.generate();
  const borrower = Keypair.generate();
  const liquidator = Keypair.generate();

  // Token and pool
  let tokenMint: PublicKey;
  let mockPool: Keypair;

  // PDAs
  let protocolStatePda: PublicKey;
  let protocolStateBump: number;
  let treasuryPda: PublicKey;
  let treasuryBump: number;
  let tokenConfigPda: PublicKey;
  let tokenConfigBump: number;

  // Test constants
  const LAMPORTS_FOR_TESTING = 100 * LAMPORTS_PER_SOL;
  const TOKEN_DECIMALS = 9;
  const INITIAL_TOKEN_SUPPLY = 1_000_000_000 * 10 ** TOKEN_DECIMALS;

  before(async () => {
    // Airdrop SOL to test accounts
    const accounts = [admin, borrower, liquidator];
    for (const account of accounts) {
      const sig = await connection.requestAirdrop(
        account.publicKey,
        LAMPORTS_FOR_TESTING
      );
      await connection.confirmTransaction(sig);
    }

    // Derive PDAs
    [protocolStatePda, protocolStateBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("protocol_state")],
      program.programId
    );

    [treasuryPda, treasuryBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      program.programId
    );

    // Create mock token mint
    tokenMint = await createMint(
      connection,
      admin,
      admin.publicKey,
      null,
      TOKEN_DECIMALS
    );

    // Create mock pool account for price oracle
    mockPool = Keypair.generate();
    const createPoolTx = new web3.Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: mockPool.publicKey,
        lamports: await connection.getMinimumBalanceForRentExemption(200),
        space: 200,
        programId: SystemProgram.programId, // Mock - would be Raydium/Pumpfun in prod
      })
    );
    await provider.sendAndConfirm(createPoolTx, [admin, mockPool]);

    // Derive token config PDA
    [tokenConfigPda, tokenConfigBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_config"), tokenMint.toBuffer()],
      program.programId
    );

    console.log("Test setup complete");
    console.log("Admin:", admin.publicKey.toString());
    console.log("Token Mint:", tokenMint.toString());
    console.log("Protocol State PDA:", protocolStatePda.toString());
    console.log("Treasury PDA:", treasuryPda.toString());
  });

  describe("Initialize Protocol", () => {
    it("should initialize the protocol successfully", async () => {
      const tx = await program.methods
        .initialize(
          admin.publicKey,
          buybackWallet.publicKey,
          operationsWallet.publicKey
        )
        .accounts({
          protocolState: protocolStatePda,
          treasury: treasuryPda,
          payer: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      console.log("Initialize tx:", tx);

      // Verify protocol state
      const protocolState = await program.account.protocolState.fetch(
        protocolStatePda
      );
      expect(protocolState.admin.toString()).to.equal(
        admin.publicKey.toString()
      );
      expect(protocolState.buybackWallet.toString()).to.equal(
        buybackWallet.publicKey.toString()
      );
      expect(protocolState.operationsWallet.toString()).to.equal(
        operationsWallet.publicKey.toString()
      );
      expect(protocolState.paused).to.be.false;
      expect(protocolState.totalLoansCreated.toNumber()).to.equal(0);
      expect(protocolState.protocolFeeBps).to.equal(100); // 1%
      expect(protocolState.liquidationTreasuryBps).to.equal(9000); // 90%
      expect(protocolState.liquidationBuybackBps).to.equal(500); // 5%
      expect(protocolState.liquidationOperationsBps).to.equal(500); // 5%
    });

    it("should fail to initialize twice", async () => {
      try {
        await program.methods
          .initialize(
            admin.publicKey,
            buybackWallet.publicKey,
            operationsWallet.publicKey
          )
          .accounts({
            protocolState: protocolStatePda,
            treasury: treasuryPda,
            payer: admin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([admin])
          .rpc();
        assert.fail("Should have thrown an error");
      } catch (err: any) {
        expect(err.message).to.include("already in use");
      }
    });
  });

  describe("Whitelist Token", () => {
    it("should whitelist a token successfully", async () => {
      const tx = await program.methods
        .whitelistToken(
          { gold: {} }, // TokenTier::Gold
          mockPool.publicKey,
          { raydium: {} }, // PoolType::Raydium
          new BN(0.1 * LAMPORTS_PER_SOL), // min loan: 0.1 SOL
          new BN(100 * LAMPORTS_PER_SOL) // max loan: 100 SOL
        )
        .accounts({
          protocolState: protocolStatePda,
          tokenConfig: tokenConfigPda,
          tokenMint: tokenMint,
          poolAccount: mockPool.publicKey,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      console.log("Whitelist token tx:", tx);

      // Verify token config
      const tokenConfig = await program.account.tokenConfig.fetch(
        tokenConfigPda
      );
      expect(tokenConfig.mint.toString()).to.equal(tokenMint.toString());
      expect(tokenConfig.tier).to.deep.equal({ gold: {} });
      expect(tokenConfig.enabled).to.be.true;
      expect(tokenConfig.ltvBps).to.equal(7000); // 70% for Gold
      expect(tokenConfig.interestRateBps).to.equal(500); // 5% for Gold
      expect(tokenConfig.liquidationBonusBps).to.equal(500); // 5% for Gold
    });

    it("should fail to whitelist with non-admin", async () => {
      const fakeAdmin = Keypair.generate();
      const airdropSig = await connection.requestAirdrop(
        fakeAdmin.publicKey,
        LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(airdropSig);

      try {
        await program.methods
          .whitelistToken(
            { bronze: {} },
            mockPool.publicKey,
            { raydium: {} },
            new BN(0.1 * LAMPORTS_PER_SOL),
            new BN(100 * LAMPORTS_PER_SOL)
          )
          .accounts({
            protocolState: protocolStatePda,
            tokenConfig: tokenConfigPda,
            tokenMint: tokenMint,
            poolAccount: mockPool.publicKey,
            admin: fakeAdmin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([fakeAdmin])
          .rpc();
        assert.fail("Should have thrown an error");
      } catch (err: any) {
        expect(err.message).to.include("Unauthorized");
      }
    });
  });

  describe("Update Token Config", () => {
    it("should update token config successfully", async () => {
      const tx = await program.methods
        .updateTokenConfig(
          null, // keep enabled
          6500, // new LTV: 65%
          600, // new interest: 6%
          null, // keep liquidation bonus
          null, // keep min amount
          null // keep max amount
        )
        .accounts({
          protocolState: protocolStatePda,
          tokenConfig: tokenConfigPda,
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      console.log("Update token config tx:", tx);

      const tokenConfig = await program.account.tokenConfig.fetch(
        tokenConfigPda
      );
      expect(tokenConfig.ltvBps).to.equal(6500);
      expect(tokenConfig.interestRateBps).to.equal(600);
    });
  });

  describe("Fund Treasury", () => {
    it("should fund treasury successfully", async () => {
      const fundAmount = new BN(50 * LAMPORTS_PER_SOL);

      const tx = await program.methods
        .fundTreasury(fundAmount)
        .accounts({
          protocolState: protocolStatePda,
          treasury: treasuryPda,
          funder: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      console.log("Fund treasury tx:", tx);

      // Verify treasury balance
      const treasuryBalance = await connection.getBalance(treasuryPda);
      expect(treasuryBalance).to.be.gte(50 * LAMPORTS_PER_SOL);

      const protocolState = await program.account.protocolState.fetch(
        protocolStatePda
      );
      expect(protocolState.treasuryBalance.toNumber()).to.equal(
        50 * LAMPORTS_PER_SOL
      );
    });
  });

  describe("Admin Functions", () => {
    it("should pause protocol", async () => {
      const tx = await program.methods
        .pauseProtocol()
        .accounts({
          protocolState: protocolStatePda,
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      const protocolState = await program.account.protocolState.fetch(
        protocolStatePda
      );
      expect(protocolState.paused).to.be.true;
    });

    it("should resume protocol", async () => {
      const tx = await program.methods
        .resumeProtocol()
        .accounts({
          protocolState: protocolStatePda,
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      const protocolState = await program.account.protocolState.fetch(
        protocolStatePda
      );
      expect(protocolState.paused).to.be.false;
    });

    it("should update fees", async () => {
      const tx = await program.methods
        .updateFees(
          200, // protocol fee: 2%
          8500, // liquidation treasury: 85%
          1000, // liquidation buyback: 10%
          500 // liquidation operations: 5%
        )
        .accounts({
          protocolState: protocolStatePda,
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      const protocolState = await program.account.protocolState.fetch(
        protocolStatePda
      );
      expect(protocolState.protocolFeeBps).to.equal(200);
      expect(protocolState.liquidationTreasuryBps).to.equal(8500);
      expect(protocolState.liquidationBuybackBps).to.equal(1000);
      expect(protocolState.liquidationOperationsBps).to.equal(500);
    });

    it("should fail to update fees if they don't sum to 100%", async () => {
      try {
        await program.methods
          .updateFees(
            null,
            5000, // 50%
            2500, // 25%
            2000 // 20% - Total: 95%, should fail
          )
          .accounts({
            protocolState: protocolStatePda,
            admin: admin.publicKey,
          })
          .signers([admin])
          .rpc();
        assert.fail("Should have thrown an error");
      } catch (err: any) {
        expect(err.message).to.include("InvalidFeeConfiguration");
      }
    });
  });

  // Note: Create Loan, Repay Loan, and Liquidate tests would require
  // more complex setup with mock price data in the pool account
  // For a complete test suite, you'd need to:
  // 1. Create a proper mock pool with encoded price data
  // 2. Set up token accounts for borrower
  // 3. Mint tokens to borrower
  // 4. Test the full loan lifecycle
});

describe("Loan Lifecycle (Integration)", () => {
  // This would be a more complete integration test
  // that requires setting up proper mock price feeds

  it.skip("should create, repay loan successfully", async () => {
    // Setup:
    // 1. Create mock pool with price data
    // 2. Mint tokens to borrower
    // 3. Create loan
    // 4. Verify loan state
    // 5. Repay loan
    // 6. Verify collateral returned
  });

  it.skip("should liquidate expired loan", async () => {
    // Setup:
    // 1. Create loan with short duration
    // 2. Wait for expiry (or mock time)
    // 3. Liquidate
    // 4. Verify liquidation
  });

  it.skip("should liquidate underwater loan", async () => {
    // Setup:
    // 1. Create loan
    // 2. Update mock pool price to trigger liquidation
    // 3. Liquidate
    // 4. Verify liquidation reason is price-based
  });
});