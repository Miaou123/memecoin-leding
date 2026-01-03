#!/usr/bin/env tsx

import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { MemecoinLendingClient } from '@memecoin-lending/sdk';
import { getProgramId, getRpcUrl, getAdminKeypair, getNetworkConfig } from './config.js';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Wallet wrapper for Keypair (needed for SDK)
export class NodeWallet {
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

// Load keypair from file
export function loadKeypair(keypairPath: string): Keypair {
  const resolvedPath = path.resolve(keypairPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Keypair not found: ${resolvedPath}`);
  }
  const keyData = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(keyData));
}

// Load IDL from target folder
export function loadIdl(): any {
  const possiblePaths = [
    path.join(__dirname, '../target/idl/memecoin_lending.json'),
    path.join(__dirname, './target/idl/memecoin_lending.json'),
    path.join(__dirname, '../../target/idl/memecoin_lending.json'),
  ];
  
  for (const idlPath of possiblePaths) {
    const resolvedPath = idlPath;
    if (fs.existsSync(resolvedPath)) {
      return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    }
  }
  
  throw new Error('IDL not found. Make sure to run `anchor build` first.');
}

// Create SDK client
export async function createClient(
  network: string,
  keypairPath?: string
): Promise<{ client: MemecoinLendingClient; keypair: Keypair; connection: Connection }> {
  const config = getNetworkConfig(network);
  const connection = new Connection(config.rpcUrl, 'confirmed');
  
  const keypair = keypairPath ? loadKeypair(keypairPath) : getAdminKeypair();
  const wallet = new NodeWallet(keypair);
  const idl = loadIdl();
  
  const client = new MemecoinLendingClient(
    connection,
    wallet,
    new PublicKey(config.programId),
    idl
  );
  
  return { client, keypair, connection };
}

// Create connection for a specific network
export function createConnection(network: string): Connection {
  const rpcUrl = getRpcUrl(network);
  return new Connection(rpcUrl, 'confirmed');
}

// Create program instance
export function createProgram(network: string, wallet: any): any {
  const config = getNetworkConfig(network);
  const connection = createConnection(network);
  const idl = loadIdl();
  
  return new MemecoinLendingClient(
    connection,
    wallet,
    new PublicKey(config.programId),
    idl
  );
}

// Format SOL amount
export function formatSOL(lamports: number | bigint | string): string {
  const amount = typeof lamports === 'string' ? parseInt(lamports) : Number(lamports);
  return (amount / LAMPORTS_PER_SOL).toFixed(4);
}

// Format token amount with decimals
export function formatTokens(amount: number | bigint | string, decimals: number = 9): string {
  const value = typeof amount === 'string' ? parseInt(amount) : Number(amount);
  return (value / Math.pow(10, decimals)).toLocaleString();
}

// Format duration in human readable
export function formatDuration(seconds: number): string {
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} minutes`;
  } else if (seconds < 86400) {
    return `${(seconds / 3600).toFixed(1)} hours`;
  } else {
    return `${(seconds / 86400).toFixed(1)} days`;
  }
}

// Parse duration string to seconds
export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+(?:\.\d+)?)\s*(h|hour|hours|d|day|days|m|min|minutes?)$/i);
  if (!match) {
    throw new Error('Invalid duration format. Use: 12h, 24h, 1d, 7d, 30m, etc.');
  }
  
  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  
  if (unit.startsWith('h')) return value * 3600;
  if (unit.startsWith('d')) return value * 86400;
  if (unit.startsWith('m')) return value * 60;
  
  throw new Error('Invalid duration unit');
}

// Print header
export function printHeader(title: string): void {
  console.log(chalk.blue.bold('\n' + '═'.repeat(60)));
  console.log(chalk.blue.bold(`  ${title}`));
  console.log(chalk.blue.bold('═'.repeat(60) + '\n'));
}

// Print success
export function printSuccess(message: string): void {
  console.log(chalk.green(`✅ ${message}`));
}

// Print error
export function printError(message: string): void {
  console.log(chalk.red(`❌ ${message}`));
}

// Print info
export function printInfo(label: string, value: string): void {
  console.log(chalk.gray(`  ${label}: `) + chalk.white(value));
}

// Print transaction link
export function printTxLink(signature: string, network: string): void {
  const baseUrl = network === 'mainnet' 
    ? 'https://explorer.solana.com/tx/' 
    : `https://explorer.solana.com/tx/${signature}?cluster=${network}`;
  console.log(chalk.cyan(`  Explorer: ${baseUrl}`));
}

// Loan status formatter
export function formatLoanStatus(status: any): string {
  if (typeof status === 'string') {
    if (status === 'Active') return chalk.green('Active');
    if (status === 'Repaid') return chalk.blue('Repaid');
    if (status.includes('Liquidated')) return chalk.red(status);
    return status;
  }
  if (status.active) return chalk.green('Active');
  if (status.repaid) return chalk.blue('Repaid');
  if (status.liquidatedTime) return chalk.red('Liquidated (Time)');
  if (status.liquidatedPrice) return chalk.red('Liquidated (Price)');
  return chalk.gray('Unknown');
}

// Tier formatter
export function formatTier(tier: any): string {
  if (tier.gold) return chalk.yellow('🥇 Gold');
  if (tier.silver) return chalk.gray('🥈 Silver');
  if (tier.bronze) return chalk.hex('#CD7F32')('🥉 Bronze');
  return 'Unknown';
}

// Pool type formatter
export function formatPoolType(poolType: any): string {
  if (poolType.raydium) return 'Raydium';
  if (poolType.orca) return 'Orca';
  if (poolType.pumpfun) return 'Pumpfun';
  if (poolType.pumpswap) return 'PumpSwap';
  return 'Unknown';
}

// Pad string for table alignment
export function padRight(str: string, length: number): string {
  // Strip ANSI codes for length calculation
  const plainStr = str.replace(/\x1b\[[0-9;]*m/g, '');
  const padding = Math.max(0, length - plainStr.length);
  return str + ' '.repeat(padding);
}