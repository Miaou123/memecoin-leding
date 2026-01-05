import { 
  Connection, 
  PublicKey, 
  Transaction, 
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { getPriceAuthorityKeypair } from '../config/keys.js';
import { getJupiterPrice } from './jupiter-price.service.js';
import { getConnection, getProgram } from './solana.service.js';
import { assertCircuitBreakerOk } from './circuit-breaker.service.js';
import { checkWalletRateLimit } from './wallet-rate-limit.service.js';

// Constants matching on-chain program
const PROTOCOL_STATE_SEED = Buffer.from('protocol_state');
const TREASURY_SEED = Buffer.from('treasury');
const TOKEN_CONFIG_SEED = Buffer.from('token_config');
const LOAN_SEED = Buffer.from('loan');
const VAULT_SEED = Buffer.from('vault');

// Price signature validity (30 seconds)
const PRICE_VALIDITY_SECONDS = 30;

export interface PrepareLoanRequest {
  tokenMint: string;
  collateralAmount: string; // In token base units (with decimals)
  durationSeconds: number;
  borrower: string;
}

export interface PrepareLoanResponse {
  transaction: string; // Base64 encoded serialized transaction
  price: string; // Price in lamports (scaled)
  priceInSol: string; // Human readable price
  timestamp: number;
  expiresAt: number;
  estimatedSolAmount: string; // Estimated SOL to receive
  loanPda: string;
}

export async function prepareLoanTransaction(
  request: PrepareLoanRequest
): Promise<PrepareLoanResponse> {
  // Check circuit breaker before preparing any loan
  await assertCircuitBreakerOk();

  // Check wallet rate limit
  const rateLimitResult = await checkWalletRateLimit(request.borrower);
  if (!rateLimitResult.allowed) {
    throw new Error(rateLimitResult.reason || 'Rate limit exceeded');
  }

  const connection = getConnection();
  const program = getProgram();
  const priceAuthority = getPriceAuthorityKeypair();
  
  const borrower = new PublicKey(request.borrower);
  const tokenMint = new PublicKey(request.tokenMint);
  const collateralAmount = new BN(request.collateralAmount);
  const durationSeconds = request.durationSeconds;

  // 1. Fetch price from Jupiter (off-chain, secure)
  console.log(`[PrepareLoan] Fetching Jupiter price for ${request.tokenMint.slice(0, 8)}...`);
  const jupiterPrice = await getJupiterPrice(request.tokenMint);
  const approvedPrice = jupiterPrice.priceInLamports;
  const priceTimestamp = jupiterPrice.timestamp;

  // 2. Derive all PDAs
  const [protocolStatePda] = PublicKey.findProgramAddressSync(
    [PROTOCOL_STATE_SEED],
    program.programId
  );

  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [TREASURY_SEED],
    program.programId
  );

  const [tokenConfigPda] = PublicKey.findProgramAddressSync(
    [TOKEN_CONFIG_SEED, tokenMint.toBuffer()],
    program.programId
  );

  // Fetch protocol state to get loan index
  const protocolState = await (program.account as any).protocolState.fetch(protocolStatePda);
  const loanIndex = protocolState.totalLoansCreated;

  const [loanPda] = PublicKey.findProgramAddressSync(
    [
      LOAN_SEED,
      borrower.toBuffer(),
      tokenMint.toBuffer(),
      new BN(loanIndex).toArrayLike(Buffer, 'le', 8),
    ],
    program.programId
  );

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [VAULT_SEED, loanPda.toBuffer()],
    program.programId
  );

  // Fetch token config to get pool address
  const tokenConfig = await (program.account as any).tokenConfig.fetch(tokenConfigPda);
  const poolAddress = tokenConfig.poolAddress;

  // Get borrower's token account
  const borrowerTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    borrower
  );

  // 3. Build the transaction
  console.log(`[PrepareLoan] Building transaction...`);
  
  const tx = await program.methods
    .createLoan(
      collateralAmount,
      new BN(durationSeconds),
      new BN(approvedPrice.toString()),
      new BN(priceTimestamp)
    )
    .accounts({
      protocolState: protocolStatePda,
      tokenConfig: tokenConfigPda,
      loan: loanPda,
      treasury: treasuryPda,
      borrower: borrower,
      borrowerTokenAccount: borrowerTokenAccount,
      vault: vaultPda,
      poolAccount: poolAddress,
      tokenMint: tokenMint,
      priceAuthority: priceAuthority.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  // Get recent blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = borrower;

  // 4. Price authority signs the transaction
  console.log(`[PrepareLoan] Signing with price authority: ${priceAuthority.publicKey.toString().slice(0, 8)}...`);
  tx.partialSign(priceAuthority);

  // 5. Serialize for frontend
  const serializedTx = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  // Calculate estimated SOL amount (for display)
  const PRICE_SCALE = 1_000_000n;
  const BPS_DIVISOR = 10000n;
  const ltvBps = BigInt(tokenConfig.ltvBps);
  
  const collateralBigInt = BigInt(request.collateralAmount);
  const estimatedSol = (collateralBigInt * approvedPrice * ltvBps) / (PRICE_SCALE * BPS_DIVISOR);

  console.log(`[PrepareLoan] Transaction prepared successfully`);
  console.log(`[PrepareLoan] - Loan PDA: ${loanPda.toString()}`);
  console.log(`[PrepareLoan] - Price: ${jupiterPrice.price.toExponential(4)} SOL`);
  console.log(`[PrepareLoan] - Estimated SOL: ${Number(estimatedSol) / 1e9} SOL`);

  return {
    transaction: serializedTx.toString('base64'),
    price: approvedPrice.toString(),
    priceInSol: jupiterPrice.price.toExponential(6),
    timestamp: priceTimestamp,
    expiresAt: priceTimestamp + PRICE_VALIDITY_SECONDS,
    estimatedSolAmount: estimatedSol.toString(),
    loanPda: loanPda.toString(),
  };
}