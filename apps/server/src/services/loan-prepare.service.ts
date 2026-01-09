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
import { 
  getPumpSwapPoolAddress, 
  extractPoolVaults,
  POOL_SIZE as PUMPSWAP_POOL_SIZE,
  POOL_BASE_VAULT_OFFSET as PUMPSWAP_POOL_BASE_VAULT_OFFSET,
  POOL_QUOTE_VAULT_OFFSET as PUMPSWAP_POOL_QUOTE_VAULT_OFFSET,
  POOL_MIN_LEN as PUMPSWAP_POOL_MIN_LEN
} from './pumpswap-pool.service.js';

// Token-2022 Program ID
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

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

// Helper function to detect Token-2022
async function getTokenProgramForMint(
  connection: Connection, 
  mint: PublicKey
): Promise<PublicKey> {
  const mintInfo = await connection.getAccountInfo(mint);
  if (!mintInfo) {
    throw new Error(`Mint account not found: ${mint.toString()}`);
  }
  
  if (mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    console.log(`[PrepareLoan] Using Token-2022 for ${mint.toString().slice(0,8)}...`);
    return TOKEN_2022_PROGRAM_ID;
  }
  
  return TOKEN_PROGRAM_ID;
}

// Helper function to fetch PumpSwap vaults
async function getPumpSwapVaults(
  connection: Connection,
  poolAddress: PublicKey
): Promise<{ baseVault: PublicKey; quoteVault: PublicKey } | null> {
  try {
    const poolAccount = await connection.getAccountInfo(poolAddress);
    if (!poolAccount || poolAccount.data.length < PUMPSWAP_POOL_MIN_LEN) {
      console.warn('[PrepareLoan] PumpSwap pool account not found or too small');
      return null;
    }
    
    const vaults = extractPoolVaults(poolAccount.data);
    console.log(`[PrepareLoan] PumpSwap vaults - base: ${vaults.baseVault.toString().slice(0,8)}..., quote: ${vaults.quoteVault.toString().slice(0,8)}...`);
    
    return vaults;
  } catch (error) {
    console.error('[PrepareLoan] Failed to fetch PumpSwap vaults:', error);
    return null;
  }
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
  let tokenConfig;
  try {
    tokenConfig = await (program.account as any).tokenConfig.fetch(tokenConfigPda);
  } catch (error: any) {
    if (error.message?.includes('Account does not exist')) {
      throw new Error(`Token ${request.tokenMint} is not whitelisted or not configured for lending`);
    }
    throw error;
  }
  const poolAddress = tokenConfig.poolAddress;

  // Detect token program (SPL Token vs Token-2022)
  const tokenProgramId = await getTokenProgramForMint(connection, tokenMint);

  // Get borrower's token account (with appropriate token program)
  const borrowerTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    borrower,
    false, // allowOwnerOffCurve
    tokenProgramId
  );

  // Check if PumpSwap and fetch vaults
  // Debug: log the actual poolType format
  console.log('[PrepareLoan] Token config poolType:', JSON.stringify(tokenConfig.poolType), typeof tokenConfig.poolType);

  // Handle both Anchor enum object format and numeric format
  let isPumpSwap = false;
  if (typeof tokenConfig.poolType === 'object' && tokenConfig.poolType !== null) {
    const poolTypeKey = Object.keys(tokenConfig.poolType)[0];
    isPumpSwap = poolTypeKey === 'pumpSwap';
    console.log('[PrepareLoan] Pool type key:', poolTypeKey, 'isPumpSwap:', isPumpSwap);
  } else {
    isPumpSwap = tokenConfig.poolType === 3;
    console.log('[PrepareLoan] Pool type numeric:', tokenConfig.poolType, 'isPumpSwap:', isPumpSwap);
  }
  
  let pumpswapBaseVault: PublicKey | null = null;
  let pumpswapQuoteVault: PublicKey | null = null;

  if (isPumpSwap) {
    console.log('[PrepareLoan] PumpSwap pool address:', poolAddress.toString());
    let vaults = await getPumpSwapVaults(connection, poolAddress);
    
    // If vaults fetch failed, try discovering the pool
    if (!vaults) {
      console.warn('[PrepareLoan] Could not fetch vaults from stored pool, trying pool discovery');
      const discoveredPool = await getPumpSwapPoolAddress(connection, tokenMint);
      
      if (discoveredPool && !discoveredPool.equals(poolAddress)) {
        console.log('[PrepareLoan] Found different pool via discovery:', discoveredPool.toString());
        vaults = await getPumpSwapVaults(connection, discoveredPool);
        
        if (vaults) {
          // Update the pool address for the transaction
          poolAddress = discoveredPool;
          console.log('[PrepareLoan] Using discovered pool address');
        }
      }
    }
    
    if (!vaults) {
      // For PumpSwap, we might not need the vault accounts if the on-chain program handles it
      console.warn('[PrepareLoan] Could not fetch PumpSwap vaults, proceeding without them');
      // Don't throw error, let the transaction builder handle it
    } else {
      pumpswapBaseVault = vaults.baseVault;
      pumpswapQuoteVault = vaults.quoteVault;
      console.log('[PrepareLoan] PumpSwap token detected, vaults fetched successfully');
    }
  }

  // 3. Build the transaction
  console.log(`[PrepareLoan] Building transaction...`);
  
  // Build accounts object
  const accounts: any = {
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
    tokenProgram: tokenProgramId,  // Use detected program (Token or Token-2022)
    systemProgram: SystemProgram.programId,
  };

  // For PumpSwap, add vault accounts as named optional accounts
  if (pumpswapBaseVault && pumpswapQuoteVault) {
    accounts.pumpswapBaseVault = pumpswapBaseVault;
    accounts.pumpswapQuoteVault = pumpswapQuoteVault;
    console.log('[PrepareLoan] Added PumpSwap vaults to accounts');
  }

  const tx = await program.methods
    .createLoan(
      collateralAmount,
      new BN(durationSeconds),
      new BN(approvedPrice.toString()),
      new BN(priceTimestamp)
    )
    .accounts(accounts)
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