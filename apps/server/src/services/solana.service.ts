import { Connection, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, Idl } from '@coral-xyz/anchor';
import { getNetworkConfig } from '@memecoin-lending/config';
import { getAdminKeypair } from '../config/keys.js';
import fs from 'fs';
import path from 'path';

let connection: Connection | null = null;
let program: Program | null = null;
let provider: AnchorProvider | null = null;

export function getConnection(): Connection {
  if (!connection) {
    const networkConfig = getNetworkConfig();
    const rpcUrl = process.env.SOLANA_RPC_URL || networkConfig.rpcUrl;
    connection = new Connection(rpcUrl, 'confirmed');
    console.log(`[Solana] Connected to ${rpcUrl}`);
  }
  return connection;
}

export function getProgram(): Program {
  if (!program) {
    const conn = getConnection();
    const wallet = new Wallet(getAdminKeypair());
    
    provider = new AnchorProvider(conn, wallet, {
      commitment: 'confirmed',
    });
    
    // Load IDL
    const idlPaths = [
      process.env.IDL_PATH,
      './target/idl/memecoin_lending.json',
      '../../target/idl/memecoin_lending.json',
      '../../../target/idl/memecoin_lending.json',
      path.join(process.cwd(), 'target/idl/memecoin_lending.json'),
      path.join(process.cwd(), '../../../target/idl/memecoin_lending.json'),
    ].filter(Boolean);
    
    let idl: Idl | null = null;
    for (const p of idlPaths as string[]) {
      try {
        if (fs.existsSync(p)) {
          idl = JSON.parse(fs.readFileSync(p, 'utf-8'));
          console.log(`[Solana] IDL loaded from ${p}`);
          break;
        }
      } catch (error) {
        // Continue to next path
      }
    }
    
    if (!idl) {
      throw new Error('IDL file not found - required for program operations');
    }
    
    program = new Program(idl, provider);
    console.log(`[Solana] Program initialized: ${program.programId.toString()}`);
  }
  
  return program;
}

export function getProvider(): AnchorProvider {
  if (!provider) {
    getProgram(); // This initializes provider
  }
  return provider!;
}