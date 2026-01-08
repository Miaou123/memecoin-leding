// Test script to understand the exact price calculation issue

// Simulate the on-chain calculation
function calculatePumpSwapPrice(
    quoteVaultAmount: bigint,  // SOL amount (9 decimals)
    baseVaultAmount: bigint,   // Token amount (6 decimals)
    withDivision: boolean
): bigint {
    const PRICE_SCALE = 1000000000n; // 1e9
    
    // Calculate price: quote_amount * PRICE_SCALE / base_amount
    let price = (quoteVaultAmount * PRICE_SCALE) / baseVaultAmount;
    
    if (withDivision) {
        price = price / 1000n;  // Normalize for decimal difference
    }
    
    return price;
}

// Test with realistic values
const testCases = [
    {
        name: "Small pool (like pump token)",
        baseAmount: 100000000000n,  // 100k tokens (6 decimals)
        quoteAmount: 75400000000n,   // 75.4 SOL (9 decimals)
    },
    {
        name: "Medium pool",
        baseAmount: 1000000000000n,  // 1M tokens
        quoteAmount: 754000000000n,  // 754 SOL
    },
    {
        name: "Large pool", 
        baseAmount: 10000000000000n, // 10M tokens
        quoteAmount: 7540000000000n, // 7540 SOL
    }
];

console.log("=== PumpSwap Price Calculation Test ===\n");

for (const test of testCases) {
    console.log(`${test.name}:`);
    console.log(`Base (tokens): ${test.baseAmount} (${Number(test.baseAmount) / 1e6} tokens)`);
    console.log(`Quote (SOL): ${test.quoteAmount} (${Number(test.quoteAmount) / 1e9} SOL)`);
    
    const priceWithout = calculatePumpSwapPrice(test.quoteAmount, test.baseAmount, false);
    const priceWith = calculatePumpSwapPrice(test.quoteAmount, test.baseAmount, true);
    
    console.log(`Price WITHOUT /1000: ${priceWithout} (${Number(priceWithout) / 1e9} SOL per token)`);
    console.log(`Price WITH /1000: ${priceWith} (${Number(priceWith) / 1e9} SOL per token)`);
    
    // Test loan calculation
    const collateral = 100000000n; // 100 tokens
    const ltv = 5000n; // 50%
    const BPS = 10000n;
    
    const loanWithout = (collateral * priceWithout * ltv) / 1000000000n / BPS;
    const loanWith = (collateral * priceWith * ltv) / 1000000000n / BPS;
    
    console.log(`100 token loan WITHOUT /1000: ${loanWithout} lamports (${Number(loanWithout) / 1e9} SOL)`);
    console.log(`100 token loan WITH /1000: ${loanWith} lamports (${Number(loanWith) / 1e9} SOL)`);
    
    // Check against expected price (0.000754 SOL)
    const expectedPrice = 754000n; // 0.000754 * 1e9
    const deviationWithout = Number(priceWithout - expectedPrice) / Number(expectedPrice) * 100;
    const deviationWith = Number(priceWith - expectedPrice) / Number(expectedPrice) * 100;
    
    console.log(`Deviation from expected (0.000754 SOL):`);
    console.log(`  WITHOUT /1000: ${deviationWithout.toFixed(2)}%`);
    console.log(`  WITH /1000: ${deviationWith.toFixed(2)}%`);
    console.log("");
}

console.log("\n=== Analysis ===");
console.log("The /1000 division is needed because:");
console.log("- WSOL has 9 decimals");
console.log("- The token has 6 decimals");
console.log("- The price calculation doesn't account for this difference");
console.log("- Without /1000, prices are ~1000x too high");
console.log("\nIf you're still getting PriceDeviationTooHigh, either:");
console.log("1. The /1000 fix isn't deployed on-chain");
console.log("2. The pool reserves have changed significantly");
console.log("3. The vault accounts don't exist or are wrong");