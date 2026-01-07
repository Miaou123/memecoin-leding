import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

// Create a test keypair
const keypair = Keypair.generate();
const publicKey = keypair.publicKey.toString();

// Create message with timestamp
const timestamp = Date.now();
const message = `Sign in to Memecoin Lending Protocol\nTimestamp: ${timestamp}`;
const messageBytes = new TextEncoder().encode(message);

// Sign the message
const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
const signatureBase58 = bs58.encode(signature);

console.log('Test Authentication Credentials:');
console.log('================================');
console.log('Public Key:', publicKey);
console.log('Timestamp:', timestamp);
console.log('Signature:', signatureBase58);
console.log('');

// Test with valid signature
console.log('Testing with VALID signature...');
const validResponse = await fetch('http://localhost:3002/api/admin/whitelist', {
  headers: {
    'X-Public-Key': publicKey,
    'X-Signature': signatureBase58,
    'X-Timestamp': timestamp.toString(),
  }
});
console.log('Status:', validResponse.status);
console.log('Response:', await validResponse.text());
console.log('');

// Test with forged signature
console.log('Testing with FORGED signature...');
const forgedResponse = await fetch('http://localhost:3002/api/admin/whitelist', {
  headers: {
    'X-Public-Key': publicKey,
    'X-Signature': 'FakeSignature123456789',
    'X-Timestamp': timestamp.toString(),
  }
});
console.log('Status:', forgedResponse.status);
console.log('Response:', await forgedResponse.text());