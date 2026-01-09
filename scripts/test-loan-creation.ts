import { Connection, PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, Idl } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import fs from 'fs';
import path from 'path';

async function main() {
    // Configuration
    const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(RPC_URL, 'confirmed');
    
    // Load admin keypair for simulation
    const adminKeyPath = path.join(process.cwd(), 'keys', 'admin.json');
    const adminKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(adminKeyPath, 'utf-8')))
    );
    
    const wallet = new Wallet(adminKeypair);
    const provider = new AnchorProvider(connection, wallet, { 
        commitment: 'confirmed',
        preflightCommitment: 'confirmed'
    });
    
    // Load IDL
    const idlPath = path.join(process.cwd(), 'target', 'idl', 'memecoin_lending.json');
    const idl: Idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
    const programId = new PublicKey('2NVfyczy1rWMdb7Y9kGmHCZkM72wyYiN5ry8dntzBK2S');
    const program = new Program(idl, provider);
    
    // Token and pool configuration
    const tokenMint = new PublicKey('a3W4qutoEJA4232T2gwZUfgYJTetr96pU4SJMwppump');
    const poolAddress = new PublicKey('4qxSqMh6iEdbdvtMp8r5MK2psAGKNk57PfGeVo2VhczQ');
    
    console.log('=== Test Loan Creation ===');
    console.log('Token mint:', tokenMint.toString());
    console.log('Pool address:', poolAddress.toString());
    console.log('Borrower:', adminKeypair.publicKey.toString());
    
    try {
        // Derive PDAs
        const [protocolStatePda] = PublicKey.findProgramAddressSync(
            [Buffer.from('protocol_state')],
            programId
        );
        
        const [tokenConfigPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('token_config'), tokenMint.toBuffer()],
            programId
        );
        
        const [treasuryPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('treasury')],
            programId
        );
        
        // Loan PDA
        const loanId = Keypair.generate().publicKey;
        const [loanPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('loan'), loanId.toBuffer()],
            programId
        );
        
        // Token accounts
        const borrowerCollateralAccount = getAssociatedTokenAddressSync(
            tokenMint,
            adminKeypair.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID
        );
        
        const treasuryCollateralAccount = getAssociatedTokenAddressSync(
            tokenMint,
            treasuryPda,
            true,
            TOKEN_2022_PROGRAM_ID
        );
        
        console.log('\n=== Simulating Loan Creation ===');
        console.log('Collateral amount: 100 tokens (100_000_000 raw)');
        console.log('Duration: 48 hours');
        console.log('Approved price: 754000 (0.000754 SOL per token)');
        console.log('Expected loan: ~0.0377 SOL at 50% LTV');
        
        // First, let's check the pool account to understand the issue
        const poolAccount = await connection.getAccountInfo(poolAddress);
        if (!poolAccount) {
            console.log('❌ Pool account not found at', poolAddress.toString());
            
            // Let's search for the correct pool
            console.log('\n=== Searching for correct pool ===');
            console.log('Checking PumpSwap program for pools...');
            
            // You would need to know the PumpSwap program ID and how to query pools
            // For now, let's just note this is the issue
            console.log('\nThe pool address might be incorrect or the pool might not exist.');
            console.log('This would cause the PriceDeviationTooHigh error if the program can\'t read the price.');
            
            return;
        }
        
        console.log('\n✅ Pool account found');
        console.log('Pool owner:', poolAccount.owner.toString());
        console.log('Pool data length:', poolAccount.data.length);
        
        // Extract vault addresses from pool
        // PumpSwap Pool Layout - MUST match programs/memecoin-lending/src/utils.rs
        // See IDL layout comment in utils.rs for full structure
        const PUMPSWAP_POOL_BASE_VAULT_OFFSET = 139;  // pool_base_token_account
        const PUMPSWAP_POOL_QUOTE_VAULT_OFFSET = 171; // pool_quote_token_account
        const PUMPSWAP_POOL_MIN_LEN = 211;
        
        const baseVault = new PublicKey(poolAccount.data.slice(PUMPSWAP_POOL_BASE_VAULT_OFFSET, PUMPSWAP_POOL_BASE_VAULT_OFFSET + 32));
        const quoteVault = new PublicKey(poolAccount.data.slice(PUMPSWAP_POOL_QUOTE_VAULT_OFFSET, PUMPSWAP_POOL_QUOTE_VAULT_OFFSET + 32));
        
        console.log('\nBase vault:', baseVault.toString());
        console.log('Quote vault:', quoteVault.toString());
        
        // Check if vaults exist
        const [baseVaultInfo, quoteVaultInfo] = await Promise.all([
            connection.getAccountInfo(baseVault),
            connection.getAccountInfo(quoteVault)
        ]);
        
        if (!baseVaultInfo || !quoteVaultInfo) {
            console.log('\n❌ Vault accounts not found!');
            console.log('Base vault exists:', !!baseVaultInfo);
            console.log('Quote vault exists:', !!quoteVaultInfo);
            console.log('\nThis pool might be uninitialized or the vault addresses are incorrect.');
            return;
        }
        
        console.log('\n✅ Both vault accounts exist');
        
        // Try to simulate the instruction
        console.log('\n=== Simulating create_loan instruction ===');
        
        const tx = await program.methods
            .createLoan(
                new BN(100_000_000), // collateral_amount
                new BN(48 * 3600),   // duration_seconds
                new BN(754000),      // approved_price (0.000754 * 1e9)
                new BN(Date.now() / 1000) // price_timestamp
            )
            .accounts({
                protocolState: protocolStatePda,
                tokenConfig: tokenConfigPda,
                loan: loanPda,
                borrower: adminKeypair.publicKey,
                collateralMint: tokenMint,
                collateralFrom: borrowerCollateralAccount,
                collateralTo: treasuryCollateralAccount,
                treasury: treasuryPda,
                loanId: loanId,
                pool: poolAddress,
                baseVault: baseVault,
                quoteVault: quoteVault,
                tokenProgram: TOKEN_2022_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: SYSVAR_RENT_PUBKEY,
            })
            .simulate();
        
        console.log('✅ Simulation successful!');
        console.log('Logs:', tx.logs);
        
    } catch (error) {
        console.error('\n❌ Error:', error);
        if (error instanceof Error && 'logs' in error) {
            console.error('Program logs:', (error as any).logs);
            
            // Parse the error
            const logs = (error as any).logs || [];
            const errorLog = logs.find((log: string) => log.includes('Error Number:'));
            if (errorLog) {
                console.log('\n=== Error Analysis ===');
                console.log(errorLog);
                
                if (errorLog.includes('0x2ef5')) {
                    console.log('\n🚨 PriceDeviationTooHigh (0x2ef5) detected!');
                    console.log('This means the on-chain calculation is producing a price that\'s too different from the approved price.');
                    console.log('\nPossible causes:');
                    console.log('1. The /1000 fix is not deployed on-chain');
                    console.log('2. The vault balances have changed significantly');
                    console.log('3. The pool address is wrong');
                }
            }
        }
    }
}

main().catch(console.error);