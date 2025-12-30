import { Connection, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://devnet.helius-rpc.com/?api-key=', 'confirmed');
  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, '../target/idl/memecoin_lending.json'), 'utf8'));
  const programId = new PublicKey('8yrnAJZBNhU6Ae163oyN6tMzVs2Wg4o2dpPYVdt6H9Dt');

  const [protocolStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('protocol_state')],
    programId
  );

  const provider = new AnchorProvider(connection, { publicKey: programId } as any, {});
  const program = new Program(idl, provider);

  const account = await (program.account as any).protocolState.fetch(protocolStatePDA);
  console.log('Protocol State:');
  console.log('  Admin:', account.admin.toString());
  console.log('  Buyback Wallet:', account.buybackWallet.toString());
  console.log('  Operations Wallet:', account.operationsWallet.toString());
  console.log('  Paused:', account.paused);
  console.log('  Protocol Fee:', account.protocolFeeBps, 'bps');
}

main().catch(console.error);