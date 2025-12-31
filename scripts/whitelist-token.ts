#!/usr/bin/env tsx

import { config } from 'dotenv';
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { MemecoinLendingClient } from '@memecoin-lending/sdk';
import { PROGRAM_ID, getNetworkConfig } from '@memecoin-lending/config';
import chalk from 'chalk';
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import BN from 'bn.js';

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config();

// Wallet wrapper for Keypair
class NodeWallet {
  constructor(readonly payer: Keypair) {}

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if ('version' in tx) {
      (tx as VersionedTransaction).sign([this.payer]);
    } else {
      (tx as Transaction).partialSign(this.payer);
    }
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return txs.map((tx) => {
      if ('version' in tx) {
        (tx as VersionedTransaction).sign([this.payer]);
      } else {
        (tx as Transaction).partialSign(this.payer);
      }
      return tx;
    });
  }

  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }
}

const program = new Command();

program
  .name('whitelist-token')
  .description('Whitelist a token for lending')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --admin-keypair <path>', 'Path to admin keypair', './keys/admin.json')
  .option('-m, --mint <address>', 'Token mint address')
  .option('-t, --tier <tier>', 'Token tier (bronze, silver, gold)')
  .option('-p, --pool <address>', 'Pool address for price feeds')
  .option('--pool-type <type>', 'Pool type (raydium, orca, pumpfun, pumpswap)', 'pumpfun')
  .option('--protocol-token', 'Mark as protocol token (always 50% LTV)')
  .action(async (options) => {
    try {
      console.log(chalk.blue('📝 Whitelisting token(s)...'));
      
      process.env.SOLANA_NETWORK = options.network;
      const networkConfig = getNetworkConfig(options.network);
      
      console.log(chalk.gray(`Network: ${options.network}`));
      
      const connection = new Connection(networkConfig.rpcUrl, 'confirmed');
      
      if (!fs.existsSync(options.adminKeypair)) {
        throw new Error(`Admin keypair not found: ${options.adminKeypair}`);
      }
      
      const adminKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(options.adminKeypair, 'utf8')))
      );
      
      console.log(chalk.gray(`Admin: ${adminKeypair.publicKey.toString()}`));
      
      // Load the actual IDL
      const idlPath = path.join(__dirname, '../target/idl/memecoin_lending.json');
      if (!fs.existsSync(idlPath)) {
        throw new Error(`IDL not found: ${idlPath}`);
      }
      const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));

      // Create wallet wrapper
      const wallet = new NodeWallet(adminKeypair);

      const client = new MemecoinLendingClient(
        connection,
        wallet,
        PROGRAM_ID,
        idl
      );
      
      if (!options.mint || !options.tier) {
        console.log(chalk.yellow('Usage:'));
        console.log(chalk.gray('  --mint <address>   Token mint address (required)'));
        console.log(chalk.gray('  --tier <tier>      bronze, silver, or gold (required)'));
        console.log(chalk.gray('  --pool <address>   Pool address (optional, defaults to mint)'));
        console.log(chalk.gray('  --pool-type <type> raydium, orca, pumpfun, pumpswap (default: pumpfun)'));
        console.log(chalk.gray('  --protocol-token   Mark as protocol token (always 50% LTV)'));
        console.log(chalk.gray('\nExample:'));
        console.log(chalk.gray('  npx tsx whitelist-token.ts --mint ABC123... --tier gold --network devnet'));
        console.log(chalk.gray('  npx tsx whitelist-token.ts --mint ABC123... --tier bronze --protocol-token'));
        return;
      }
      
      const tierMap: Record<string, number> = {
        'bronze': 0,
        'silver': 1,
        'gold': 2,
      };
      
      const poolTypeMap: Record<string, number> = {
        'raydium': 0,
        'orca': 1,
        'pumpfun': 2,
        'pumpswap': 3,
      };
      
      if (!(options.tier.toLowerCase() in tierMap)) {
        throw new Error('Invalid tier. Must be bronze, silver, or gold');
      }
      
      const tier = tierMap[options.tier.toLowerCase()];
      const poolType = poolTypeMap[options.poolType?.toLowerCase() || 'pumpfun'] ?? 2;
      
      console.log(chalk.blue(`\n📝 Whitelisting token...`));
      console.log(chalk.gray(`  Mint: ${options.mint}`));
      console.log(chalk.gray(`  Tier: ${options.tier} (${tier})`));
      console.log(chalk.gray(`  Pool Type: ${options.poolType || 'pumpfun'} (${poolType})`));
      
      const txSignature = await client.whitelistToken({
        mint: new PublicKey(options.mint),
        tier: tier,
        poolAddress: new PublicKey(options.pool || options.mint),
        poolType: poolType,
        minLoanAmount: new BN(1000000),      // 0.001 SOL min
        maxLoanAmount: new BN(100000000000), // 100 SOL max
        isProtocolToken: options.protocolToken ?? false,
      });
      
      console.log(chalk.green('\n✅ Token whitelisted successfully!'));
      console.log(chalk.gray(`Transaction: ${txSignature}`));
      
      // Show tier info
      const tierInfo: Record<number, { ltv: string; liquidityReq: string }> = {
        0: { ltv: '25%', liquidityReq: '> $0' },
        1: { ltv: '35%', liquidityReq: '> $100k' },
        2: { ltv: '50%', liquidityReq: '> $300k' },
      };
      
      console.log(chalk.blue('\n📊 Token Config:'));
      const actualLtv = options.protocolToken ? '50%' : tierInfo[tier].ltv;
      console.log(chalk.gray(`  LTV: ${actualLtv}${options.protocolToken ? ' (Protocol Token)' : ` (${tierInfo[tier].liquidityReq})`}`));
      console.log(chalk.gray(`  Protocol Fee: 2% flat`));
      
    } catch (error) {
      console.error(chalk.red('❌ Whitelisting failed:'), error);
      process.exit(1);
    }
  });

program.parse();