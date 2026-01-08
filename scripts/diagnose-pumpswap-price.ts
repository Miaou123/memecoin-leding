import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, Idl } from '@coral-xyz/anchor';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import fs from 'fs';
import path from 'path';

const PRICE_SCALE = new BN(10).pow(new BN(9)); // 1e9 for 9 decimal precision

async function main() {
    // Configuration
    const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(RPC_URL, 'confirmed');
    
    // Create a dummy wallet for read-only operations
    const dummyKeypair = Keypair.generate();
    const wallet = new Wallet(dummyKeypair);
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    
    // Load IDL
    const idlPath = path.join(process.cwd(), 'target', 'idl', 'memecoin_lending.json');
    const idl: Idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
    const programId = new PublicKey('2NVfyczy1rWMdb7Y9kGmHCZkM72wyYiN5ry8dntzBK2S');
    const program = new Program(idl, provider);
    
    // Token and pool configuration
    const tokenMint = new PublicKey('a3W4qutoEJA4232T2gwZUfgYJTetr96pU4SJMwppump');
    const poolAddress = new PublicKey('4qxSqMh6iEdbdvtMp8r5MK2psAGKNk57PfGeVo2VhczQ');
    
    console.log('=== PumpSwap Price Diagnosis ===');
    console.log('Token mint:', tokenMint.toString());
    console.log('Pool address:', poolAddress.toString());
    console.log('Program ID:', programId.toString());
    
    try {
        // 1. Fetch token config to confirm pool type
        const [tokenConfigPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('token_config'), tokenMint.toBuffer()],
            programId
        );
        
        const tokenConfig = await program.account.tokenConfig.fetch(tokenConfigPda);
        console.log('\n=== Token Config ===');
        console.log('Enabled:', tokenConfig.enabled);
        console.log('Pool Type:', tokenConfig.poolType);
        console.log('Stored Pool Address:', tokenConfig.poolAddress.toString());
        console.log('LTV BPS:', tokenConfig.ltvBps);
        
        // 2. Fetch PumpSwap pool data
        const poolAccount = await connection.getAccountInfo(poolAddress);
        if (!poolAccount) {
            throw new Error('Pool account not found');
        }
        
        console.log('\n=== Pool Account ===');
        console.log('Owner:', poolAccount.owner.toString());
        console.log('Data length:', poolAccount.data.length);
        
        // 3. Extract vault addresses from pool data (PumpSwap layout)
        const PUMPSWAP_POOL_BASE_VAULT_OFFSET = 64;
        const PUMPSWAP_POOL_QUOTE_VAULT_OFFSET = 96;
        
        const baseVault = new PublicKey(poolAccount.data.slice(PUMPSWAP_POOL_BASE_VAULT_OFFSET, PUMPSWAP_POOL_BASE_VAULT_OFFSET + 32));
        const quoteVault = new PublicKey(poolAccount.data.slice(PUMPSWAP_POOL_QUOTE_VAULT_OFFSET, PUMPSWAP_POOL_QUOTE_VAULT_OFFSET + 32));
        
        console.log('\n=== Vault Addresses ===');
        console.log('Base vault (token):', baseVault.toString());
        console.log('Quote vault (SOL):', quoteVault.toString());
        
        // 4. Fetch vault balances (handle both Token and Token-2022)
        let baseVaultInfo, quoteVaultInfo;
        
        try {
            // Try Token-2022 first for base vault
            const baseAccount = await connection.getAccountInfo(baseVault);
            const quoteAccount = await connection.getAccountInfo(quoteVault);
            
            if (!baseAccount || !quoteAccount) {
                throw new Error('Vault accounts not found');
            }
            
            // Parse token amounts directly from account data
            // For token accounts, amount is stored at offset 64 (8 bytes)
            const baseAmount = baseAccount.data.readBigUInt64LE(64);
            const quoteAmount = quoteAccount.data.readBigUInt64LE(64);
            
            baseVaultInfo = {
                value: {
                    amount: baseAmount.toString(),
                    uiAmount: Number(baseAmount) / 1e6,  // 6 decimals for token
                    decimals: 6
                }
            };
            
            quoteVaultInfo = {
                value: {
                    amount: quoteAmount.toString(),
                    uiAmount: Number(quoteAmount) / 1e9,  // 9 decimals for WSOL
                    decimals: 9
                }
            };
        } catch (e) {
            console.error('Error fetching vault balances:', e);
            throw e;
        }
        
        console.log('\n=== Vault Balances ===');
        console.log('Base vault (token):', baseVaultInfo.value.uiAmount, tokenMint.toString().slice(0, 8));
        console.log('Quote vault (SOL):', quoteVaultInfo.value.uiAmount, 'SOL');
        
        // 5. Calculate price manually (mimicking on-chain calculation)
        const baseAmount = new BN(baseVaultInfo.value.amount);
        const quoteAmount = new BN(quoteVaultInfo.value.amount);
        
        console.log('\n=== Manual Price Calculation ===');
        console.log('Base amount (raw):', baseAmount.toString());
        console.log('Quote amount (raw):', quoteAmount.toString());
        
        // Calculate without /1000
        const priceWithoutDiv = quoteAmount
            .mul(PRICE_SCALE)
            .div(baseAmount);
        
        // Calculate with /1000
        const priceWithDiv = priceWithoutDiv.div(new BN(1000));
        
        console.log('\nPrice WITHOUT /1000:', priceWithoutDiv.toString());
        console.log('Price WITH /1000:', priceWithDiv.toString());
        
        // Convert to human readable
        const humanPriceWithout = priceWithoutDiv.toNumber() / PRICE_SCALE.toNumber();
        const humanPriceWith = priceWithDiv.toNumber() / PRICE_SCALE.toNumber();
        
        console.log('\nHuman readable prices:');
        console.log('WITHOUT /1000:', humanPriceWithout.toFixed(9), 'SOL per token');
        console.log('WITH /1000:', humanPriceWith.toFixed(9), 'SOL per token');
        
        // 6. Simulate loan calculation with $100 collateral
        const collateralAmount = new BN(100_000_000); // 100 tokens with 6 decimals
        const ltvBps = new BN(tokenConfig.ltvBps);
        
        console.log('\n=== Loan Simulation (100 tokens collateral) ===');
        console.log('Collateral:', collateralAmount.toString(), '(raw)');
        console.log('LTV:', ltvBps.toString(), 'bps');
        
        // Without /1000
        const loanAmountWithout = collateralAmount
            .mul(priceWithoutDiv)
            .mul(ltvBps)
            .div(PRICE_SCALE)
            .div(new BN(10000));
        
        // With /1000
        const loanAmountWith = collateralAmount
            .mul(priceWithDiv)
            .mul(ltvBps)
            .div(PRICE_SCALE)
            .div(new BN(10000));
        
        console.log('\nLoan amount WITHOUT /1000:', loanAmountWithout.toString(), 'lamports');
        console.log('Loan amount WITH /1000:', loanAmountWith.toString(), 'lamports');
        console.log('\nLoan amount WITHOUT /1000:', loanAmountWithout.toNumber() / 1e9, 'SOL');
        console.log('Loan amount WITH /1000:', loanAmountWith.toNumber() / 1e9, 'SOL');
        
        // 7. Check Jupiter price for comparison
        console.log('\n=== Jupiter Price Comparison ===');
        const jupiterUrl = `https://price.jup.ag/v4/price?ids=${tokenMint.toString()}`;
        try {
            const response = await fetch(jupiterUrl);
            const data = await response.json();
            const jupiterPrice = data.data[tokenMint.toString()]?.price;
            console.log('Jupiter price:', jupiterPrice || 'Not found', 'USD');
            console.log('Note: Jupiter shows USD price, our calculation shows SOL price');
        } catch (e) {
            console.log('Failed to fetch Jupiter price');
        }
        
        // 8. Diagnosis summary
        console.log('\n=== DIAGNOSIS SUMMARY ===');
        console.log('Expected behavior:');
        console.log('- Price should be ~0.000754 SOL per token');
        console.log('- 100 tokens at 60% LTV should borrow ~0.045 SOL');
        console.log('\nActual calculation:');
        console.log('- WITH /1000: Price =', humanPriceWith.toFixed(9), 'SOL, Loan =', loanAmountWith.toNumber() / 1e9, 'SOL');
        console.log('- WITHOUT /1000: Price =', humanPriceWithout.toFixed(9), 'SOL, Loan =', loanAmountWithout.toNumber() / 1e9, 'SOL');
        
        if (humanPriceWithout > 0.5) {
            console.log('\n🚨 ALERT: Price WITHOUT /1000 is too high! The program likely does NOT have the /1000 fix deployed.');
        } else if (humanPriceWith < 0.0001) {
            console.log('\n✅ SUCCESS: Price WITH /1000 looks correct. The program likely HAS the fix deployed.');
        } else {
            console.log('\n⚠️  WARNING: Unexpected price values. Manual investigation needed.');
        }
        
    } catch (error) {
        console.error('\nError during diagnosis:', error);
    }
}

main().catch(console.error);