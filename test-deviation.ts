import { Connection, PublicKey } from '@solana/web3.js';

async function main() {
  const connection = new Connection(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com');
  
  const baseVault = new PublicKey('EHr9wihWd2tR5kQA8MRNafgx2ETG7ax58Go87pLpbjLR');
  const quoteVault = new PublicKey('2apbt5vM3mkoD6FaAc4uzqsvAstjijfyqNkhb47sfXLn');
  
  const baseVaultAccount = await connection.getAccountInfo(baseVault);
  const quoteVaultAccount = await connection.getAccountInfo(quoteVault);
  
  const baseAmount = baseVaultAccount!.data.readBigUInt64LE(64);
  const quoteAmount = quoteVaultAccount!.data.readBigUInt64LE(64);
  
  console.log('Base amount:', baseAmount.toString());
  console.log('Quote amount:', quoteAmount.toString());
  
  const PRICE_SCALE = 1_000_000n;
  
  // WITHOUT decimal fix (what's probably deployed)
  const poolPriceRaw = (quoteAmount * PRICE_SCALE) / baseAmount;
  console.log('\nWithout /1000 fix:', poolPriceRaw.toString());
  
  // WITH decimal fix
  const poolPriceFixed = poolPriceRaw / 1000n;
  console.log('With /1000 fix:', poolPriceFixed.toString());
  
  // Backend sends ~747
  const backendPrice = 747n;
  console.log('\nBackend price:', backendPrice.toString());
  
  // Deviation calculation
  const deviationRaw = Number((poolPriceRaw - backendPrice) * 10000n / backendPrice);
  const deviationFixed = Number((poolPriceFixed - backendPrice) * 10000n / backendPrice);
  
  console.log('\nDeviation without fix:', deviationRaw, 'bps (', (deviationRaw/100).toFixed(1), '%)');
  console.log('Deviation with fix:', deviationFixed, 'bps (', (deviationFixed/100).toFixed(1), '%)');
  console.log('\nMax allowed: 2000 bps (20%)');
}

main().catch(console.error);
