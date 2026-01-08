import { Connection, PublicKey } from '@solana/web3.js';

async function main() {
    const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(RPC_URL, 'confirmed');
    
    const tokenMint = new PublicKey('a3W4qutoEJA4232T2gwZUfgYJTetr96pU4SJMwppump');
    
    console.log('=== Finding Correct PumpSwap Pool ===');
    console.log('Token mint:', tokenMint.toString());
    
    // Known PumpSwap program IDs
    const pumpSwapPrograms = [
        'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',  // Main PumpSwap program
        'pump5nVmPXyvzXQZnVnGFptZtSf5HVrs2fJv5HXYez8',  // Possible alternative
    ];
    
    // Let me check token accounts to find pools
    console.log('\n=== Checking token accounts ===');
    
    // Get largest token accounts for this mint
    const accounts = await connection.getTokenLargestAccounts(tokenMint);
    console.log('\nLargest token accounts:');
    
    for (const account of accounts.value.slice(0, 10)) {
        console.log(`\nAccount: ${account.address.toString()}`);
        console.log(`Amount: ${account.amount} (${Number(account.amount) / 1e6} tokens)`);
        
        // Get account info to check owner
        const info = await connection.getAccountInfo(account.address);
        if (info) {
            console.log(`Owner: ${info.owner.toString()}`);
            
            // Check if owned by a pool
            for (const poolProgram of pumpSwapPrograms) {
                if (info.owner.toString() === poolProgram) {
                    console.log('✅ This is a pool token account!');
                }
            }
        }
    }
    
    // Let's also check for WSOL accounts that might be paired
    const wsol = new PublicKey('So11111111111111111111111111111111111111112');
    console.log('\n=== Looking for associated WSOL pools ===');
    
    // Try to find the pool by looking at recent transactions
    console.log('\n=== Checking recent token transactions ===');
    const signatures = await connection.getSignaturesForAddress(tokenMint, { limit: 20 });
    
    for (const sig of signatures.slice(0, 5)) {
        console.log(`\nTransaction: ${sig.signature}`);
        const tx = await connection.getTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0
        });
        
        if (tx && tx.transaction.message.accountKeys) {
            // Look for PumpSwap program in the transaction
            for (const account of tx.transaction.message.accountKeys) {
                const accountStr = account.toString();
                if (pumpSwapPrograms.includes(accountStr)) {
                    console.log('Found PumpSwap program in transaction!');
                    
                    // Find other accounts that might be pools
                    for (const acc of tx.transaction.message.accountKeys) {
                        if (acc.toString() !== accountStr && acc.toString() !== tokenMint.toString()) {
                            const accInfo = await connection.getAccountInfo(acc);
                            if (accInfo && accInfo.owner.toString() === accountStr) {
                                console.log(`Potential pool: ${acc.toString()}`);
                            }
                        }
                    }
                }
            }
        }
    }
    
    // Check the pool we have
    console.log('\n=== Verifying stored pool ===');
    const storedPool = new PublicKey('4qxSqMh6iEdbdvtMp8r5MK2psAGKNk57PfGeVo2VhczQ');
    const poolInfo = await connection.getAccountInfo(storedPool);
    
    if (poolInfo) {
        console.log('Stored pool exists');
        console.log('Owner:', poolInfo.owner.toString());
        
        // Try different vault offset combinations
        console.log('\n=== Testing different vault offsets ===');
        const offsets = [
            { base: 64, quote: 96, name: "Standard" },
            { base: 32, quote: 64, name: "Alternative 1" },
            { base: 96, quote: 128, name: "Alternative 2" },
            { base: 128, quote: 160, name: "Alternative 3" },
            { base: 8, quote: 40, name: "Compact" },
            { base: 72, quote: 104, name: "Offset +8" },
        ];
        
        for (const { base, quote, name } of offsets) {
            if (base + 32 <= poolInfo.data.length && quote + 32 <= poolInfo.data.length) {
                try {
                    const baseVault = new PublicKey(poolInfo.data.slice(base, base + 32));
                    const quoteVault = new PublicKey(poolInfo.data.slice(quote, quote + 32));
                    
                    const [baseInfo, quoteInfo] = await Promise.all([
                        connection.getAccountInfo(baseVault).catch(() => null),
                        connection.getAccountInfo(quoteVault).catch(() => null)
                    ]);
                    
                    if (baseInfo && quoteInfo) {
                        console.log(`\n✅ ${name} offsets work!`);
                        console.log(`Base vault (${base}): ${baseVault.toString()}`);
                        console.log(`Quote vault (${quote}): ${quoteVault.toString()}`);
                        
                        // Check if they're token accounts
                        if (baseInfo.data.length >= 165 && quoteInfo.data.length >= 165) {
                            const baseMint = new PublicKey(baseInfo.data.slice(0, 32));
                            const quoteMint = new PublicKey(quoteInfo.data.slice(0, 32));
                            console.log(`Base mint: ${baseMint.toString()}`);
                            console.log(`Quote mint: ${quoteMint.toString()}`);
                            
                            if (baseMint.equals(tokenMint) && quoteMint.equals(wsol)) {
                                console.log('🎉 Found correct vault configuration!');
                            }
                        }
                    }
                } catch (e) {
                    // Invalid pubkey
                }
            }
        }
    }
}

main().catch(console.error);