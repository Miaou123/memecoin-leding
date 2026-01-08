import { Connection, PublicKey } from '@solana/web3.js';

async function main() {
    const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(RPC_URL, 'confirmed');
    
    const poolAddress = new PublicKey('4qxSqMh6iEdbdvtMp8r5MK2psAGKNk57PfGeVo2VhczQ');
    
    console.log('=== Analyzing PumpSwap Pool ===');
    console.log('Pool address:', poolAddress.toString());
    
    const poolAccount = await connection.getAccountInfo(poolAddress);
    if (!poolAccount) {
        console.log('Pool account not found');
        return;
    }
    
    console.log('\nPool Account Info:');
    console.log('Owner:', poolAccount.owner.toString());
    console.log('Lamports:', poolAccount.lamports);
    console.log('Data length:', poolAccount.data.length);
    console.log('Executable:', poolAccount.executable);
    
    // Let's examine the data structure
    console.log('\n=== Pool Data Analysis ===');
    
    // Common offsets for AMM pools
    const possibleOffsets = [
        { name: 'Offset 0-32', offset: 0 },
        { name: 'Offset 32-64', offset: 32 },
        { name: 'Offset 64-96', offset: 64 },
        { name: 'Offset 96-128', offset: 96 },
        { name: 'Offset 128-160', offset: 128 },
        { name: 'Offset 160-192', offset: 160 },
        { name: 'Offset 192-224', offset: 192 },
        { name: 'Offset 224-256', offset: 224 },
    ];
    
    for (const { name, offset } of possibleOffsets) {
        if (offset + 32 <= poolAccount.data.length) {
            try {
                const pubkey = new PublicKey(poolAccount.data.slice(offset, offset + 32));
                console.log(`\n${name}: ${pubkey.toString()}`);
                
                // Check if this could be a vault
                const accountInfo = await connection.getAccountInfo(pubkey);
                if (accountInfo) {
                    console.log(`  - Account exists`);
                    console.log(`  - Owner: ${accountInfo.owner.toString()}`);
                    console.log(`  - Lamports: ${accountInfo.lamports}`);
                    console.log(`  - Data length: ${accountInfo.data.length}`);
                    
                    // Check if it's a token account
                    if (accountInfo.data.length === 165 || accountInfo.data.length === 182) {
                        console.log(`  - ✅ Likely a token account`);
                        
                        // Read mint from token account (offset 0)
                        const mint = new PublicKey(accountInfo.data.slice(0, 32));
                        console.log(`  - Mint: ${mint.toString()}`);
                        
                        // Read amount (offset 64)
                        const amount = accountInfo.data.readBigUInt64LE(64);
                        console.log(`  - Amount: ${amount}`);
                    }
                } else {
                    console.log(`  - Account does not exist`);
                }
            } catch (e) {
                // Invalid pubkey, skip
            }
        }
    }
    
    // Let's also check if this pool follows a different structure
    console.log('\n=== Hex dump of first 256 bytes ===');
    const hexDump = poolAccount.data.slice(0, Math.min(256, poolAccount.data.length)).toString('hex');
    for (let i = 0; i < hexDump.length; i += 64) {
        console.log(`${i/2}: ${hexDump.slice(i, i + 64)}`);
    }
}

main().catch(console.error);