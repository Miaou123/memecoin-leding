// Quick debug script to check environment variables
require('dotenv').config();

console.log('Environment Variables:');
console.log('SOLANA_NETWORK:', process.env.SOLANA_NETWORK);
console.log('PROGRAM_ID:', process.env.PROGRAM_ID);
console.log('SOLANA_RPC_URL:', process.env.SOLANA_RPC_URL);
console.log('PORT:', process.env.PORT);

console.log('\nDetected network:', process.env.SOLANA_NETWORK || 'devnet');
console.log('Is mainnet?', process.env.SOLANA_NETWORK === 'mainnet-beta');