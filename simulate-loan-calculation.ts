#!/usr/bin/env npx tsx
/**
 * Simulate EXACT on-chain calculations for debugging
 * This mirrors the Rust code in create_loan.rs and utils.rs
 */

import { Connection, PublicKey } from '@solana/web3.js';

// ============================================================
// CONSTANTS - Must match programs/memecoin-lending/src/utils.rs
// ============================================================

const PRICE_SCALE = 1_000_000n;  // 1e6
const MIN_COLLATERAL_VALUE_LAMPORTS = 10_000_000n; // 0.01 SOL
const BPS_DIVISOR = 10_000n;
const DECIMAL_ADJUSTMENT = 1000n; // 10^(9-6) = 1000, compensates for SOL(9) vs Token(6) decimals

// PumpSwap pool offsets
const PUMPSWAP_POOL_BASE_VAULT_OFFSET = 139;
const PUMPSWAP_POOL_QUOTE_VAULT_OFFSET = 171;

// ============================================================
// TEST CONFIGURATION
// ============================================================

const CONFIG = {
  poolAddress: '4qxSqMh6iEdbdvtMp8r5MK2psAGKNk57PfGeVo2VhczQ',
  baseVault: 'EHr9wihWd2tR5kQA8MRNafgx2ETG7ax58Go87pLpbjLR',
  quoteVault: '2apbt5vM3mkoD6FaAc4uzqsvAstjijfyqNkhb47sfXLn',
  collateralAmount: 131_716_953n,  // 131.7 tokens (6 decimals)
  durationSeconds: 172_800n,       // 48 hours
  ltvBps: 5000n,                   // 50%
  backendPrice: 775n,              // ~0.000775 SOL per token (scaled by 1e6, with /1000 applied)
};

// ============================================================
// SIMULATION FUNCTIONS
// ============================================================

/**
 * Calculate pool price from vault amounts
 * WITH /1000 division to normalize decimals (9-6=3)
 */
function calculatePoolPrice(
  baseVaultAmount: bigint,
  quoteVaultAmount: bigint,
): bigint {
  // Formula: (quote_amount * PRICE_SCALE) / base_amount / 1000
  // The /1000 normalizes for decimal difference: SOL(9) - Token(6) = 3
  return (quoteVaultAmount * PRICE_SCALE) / baseVaultAmount / DECIMAL_ADJUSTMENT;
}

/**
 * Calculate collateral value in lamports
 * WITH x1000 to compensate for the /1000 in price
 */
function calculateCollateralValue(
  collateralAmount: bigint,
  price: bigint,
): bigint {
  // Formula: (collateral * price * 1000) / PRICE_SCALE
  // The x1000 compensates for the /1000 applied to the price
  return (collateralAmount * price * DECIMAL_ADJUSTMENT) / PRICE_SCALE;
}

/**
 * Calculate loan amount
 * WITH x1000 to compensate for the /1000 in price
 */
function calculateLoanAmount(
  collateralAmount: bigint,
  price: bigint,
  ltvBps: bigint
): bigint {
  // Formula: (collateral * price * ltv * 1000) / PRICE_SCALE / BPS_DIVISOR
  // The x1000 compensates for the /1000 applied to the price
  return (collateralAmount * price * ltvBps * DECIMAL_ADJUSTMENT) / PRICE_SCALE / BPS_DIVISOR;
}

/**
 * Calculate price deviation in bps
 */
function calculateDeviation(price1: bigint, price2: bigint): bigint {
  if (price1 > price2) {
    return ((price1 - price2) * BPS_DIVISOR) / price2;
  } else {
    return ((price2 - price1) * BPS_DIVISOR) / price1;
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const connection = new Connection(
    process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
    'confirmed'
  );

  console.log('');
  console.log('='.repeat(70));
  console.log('ON-CHAIN CALCULATION SIMULATOR');
  console.log('With /1000 for price, x1000 for value calculations');
  console.log('='.repeat(70));
  console.log('');

  // Fetch vault balances
  const baseVault = new PublicKey(CONFIG.baseVault);
  const quoteVault = new PublicKey(CONFIG.quoteVault);

  const [baseVaultAccount, quoteVaultAccount] = await Promise.all([
    connection.getAccountInfo(baseVault),
    connection.getAccountInfo(quoteVault),
  ]);

  if (!baseVaultAccount || !quoteVaultAccount) {
    console.error('ERROR: Could not fetch vault accounts');
    process.exit(1);
  }

  const baseAmount = baseVaultAccount.data.readBigUInt64LE(64);
  const quoteAmount = quoteVaultAccount.data.readBigUInt64LE(64);

  console.log('VAULT BALANCES:');
  console.log(`  Base (tokens):  ${baseAmount.toLocaleString()} raw = ${(Number(baseAmount) / 1e6).toFixed(2)} tokens`);
  console.log(`  Quote (WSOL):   ${quoteAmount.toLocaleString()} raw = ${(Number(quoteAmount) / 1e9).toFixed(4)} SOL`);
  console.log('');

  // Calculate pool price (WITH /1000)
  const poolPrice = calculatePoolPrice(baseAmount, quoteAmount);
  
  console.log('POOL PRICE CALCULATION:');
  console.log(`  Formula: (quoteAmount × PRICE_SCALE) / baseAmount / 1000`);
  console.log(`  = (${quoteAmount} × ${PRICE_SCALE}) / ${baseAmount} / 1000`);
  console.log(`  = ${poolPrice.toLocaleString()}`);
  console.log(`  = ${Number(poolPrice) / Number(PRICE_SCALE)} SOL per token ✓`);
  console.log('');

  // Backend price
  const backendPrice = CONFIG.backendPrice;
  
  console.log('BACKEND PRICE:');
  console.log(`  Value: ${backendPrice.toLocaleString()}`);
  console.log(`  = ${Number(backendPrice) / Number(PRICE_SCALE)} SOL per token`);
  console.log('');

  // Deviation check
  const deviation = calculateDeviation(backendPrice, poolPrice);
  console.log('DEVIATION CHECK:');
  console.log(`  Pool price:     ${poolPrice.toLocaleString()}`);
  console.log(`  Backend price:  ${backendPrice.toLocaleString()}`);
  console.log(`  Deviation:      ${deviation.toLocaleString()} bps (${(Number(deviation) / 100).toFixed(2)}%)`);
  console.log(`  Max allowed:    2000 bps (20%)`);
  console.log(`  PASSES:         ${deviation <= 2000n ? '✅ YES' : '❌ NO'}`);
  console.log('');

  // Collateral value (WITH x1000)
  const collateralValue = calculateCollateralValue(CONFIG.collateralAmount, backendPrice);
  
  console.log('COLLATERAL VALUE:');
  console.log(`  Formula: (collateralAmount × price × 1000) / PRICE_SCALE`);
  console.log(`  = (${CONFIG.collateralAmount} × ${backendPrice} × 1000) / ${PRICE_SCALE}`);
  console.log(`  = ${collateralValue.toLocaleString()} lamports`);
  console.log(`  = ${(Number(collateralValue) / 1e9).toFixed(6)} SOL`);
  console.log(`  Min required:   ${MIN_COLLATERAL_VALUE_LAMPORTS.toLocaleString()} lamports (${Number(MIN_COLLATERAL_VALUE_LAMPORTS) / 1e9} SOL)`);
  console.log(`  PASSES:         ${collateralValue >= MIN_COLLATERAL_VALUE_LAMPORTS ? '✅ YES' : '❌ NO'}`);
  console.log('');

  // Loan amount (WITH x1000)
  const loanAmount = calculateLoanAmount(CONFIG.collateralAmount, backendPrice, CONFIG.ltvBps);
  
  console.log('LOAN AMOUNT:');
  console.log(`  Formula: (collateral × price × ltv × 1000) / PRICE_SCALE / BPS_DIVISOR`);
  console.log(`  = (${CONFIG.collateralAmount} × ${backendPrice} × ${CONFIG.ltvBps} × 1000) / ${PRICE_SCALE} / ${BPS_DIVISOR}`);
  console.log(`  = ${loanAmount.toLocaleString()} lamports`);
  console.log(`  = ${(Number(loanAmount) / 1e9).toFixed(6)} SOL`);
  console.log('');

  // Expected values for validation
  const expectedCollateralSOL = (Number(CONFIG.collateralAmount) / 1e6) * (Number(backendPrice) / Number(PRICE_SCALE));
  const expectedLoanSOL = expectedCollateralSOL * (Number(CONFIG.ltvBps) / Number(BPS_DIVISOR));

  console.log('EXPECTED VALUES (sanity check):');
  console.log(`  Tokens: ${(Number(CONFIG.collateralAmount) / 1e6).toFixed(2)}`);
  console.log(`  Price:  ${Number(backendPrice) / Number(PRICE_SCALE)} SOL/token`);
  console.log(`  Expected collateral value: ${expectedCollateralSOL.toFixed(6)} SOL`);
  console.log(`  Expected loan (50% LTV):   ${expectedLoanSOL.toFixed(6)} SOL`);
  console.log('');

  // Summary
  console.log('='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Collateral:       ${(Number(CONFIG.collateralAmount) / 1e6).toFixed(2)} tokens`);
  console.log(`  Price:            ${Number(backendPrice) / Number(PRICE_SCALE)} SOL/token`);
  console.log(`  Collateral Value: ${(Number(collateralValue) / 1e9).toFixed(6)} SOL`);
  console.log(`  LTV:              ${Number(CONFIG.ltvBps) / 100}%`);
  console.log(`  Loan Amount:      ${(Number(loanAmount) / 1e9).toFixed(6)} SOL`);
  console.log('');

  const allPassed = deviation <= 2000n && collateralValue >= MIN_COLLATERAL_VALUE_LAMPORTS && loanAmount > 0n;
  
  if (allPassed) {
    console.log('🟢 All checks pass!');
  } else {
    console.log('🔴 Some checks failed.');
  }

  console.log('');
  console.log('='.repeat(70));
  console.log('RUST CODE CHANGES NEEDED:');
  console.log('='.repeat(70));
  console.log('');
  console.log('1. KEEP /1000 in read_pumpswap_price (utils.rs) ✓');
  console.log('');
  console.log('2. ADD x1000 in collateral_value calculation (create_loan.rs):');
  console.log('   let collateral_value = SafeMath::mul_div(');
  console.log('       collateral_amount * 1000,  // ADD x1000');
  console.log('       current_price,');
  console.log('       PRICE_SCALE as u64,');
  console.log('   )?;');
  console.log('');
  console.log('3. ADD x1000 in calculate_loan_amount (utils.rs):');
  console.log('   let loan_amount = collateral_u128');
  console.log('       .checked_mul(price_u128)');
  console.log('       .checked_mul(ltv_u128)');
  console.log('       .checked_mul(1000)  // ADD THIS');
  console.log('       .checked_div(PRICE_SCALE)');
  console.log('       .checked_div(bps_divisor_u128)?;');
  console.log('');
  console.log('='.repeat(70));
}

main().catch(console.error);