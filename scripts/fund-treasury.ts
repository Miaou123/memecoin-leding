#!/usr/bin/env tsx

import { config } from 'dotenv';
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction } from '@solana/web3.js';
import { MemecoinLendingClient } from '@memecoin-lending/sdk';
import { PROGRAM_ID, getNetworkConfig } from '@memecoin-lending/config';
import chalk from 'chalk';
import { Command } from 'commander';
import fs from 'fs';

config();

const program = new Command();

program
  .name('fund-treasury')
  .description('Fund the protocol treasury with SOL')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --funder-keypair <path>', 'Path to funder keypair', './keys/admin.json')
  .option('-a, --amount <sol>', 'Amount of SOL to fund', '10')
  .action(async (options) => {
    try {
      console.log(chalk.blue('💰 Funding protocol treasury...'));
      
      // Load network configuration
      process.env.SOLANA_NETWORK = options.network;
      const networkConfig = getNetworkConfig(options.network);
      
      console.log(chalk.gray(`Network: ${options.network}`));
      console.log(chalk.gray(`Amount: ${options.amount} SOL`));
      
      // Create connection
      const connection = new Connection(networkConfig.rpcUrl, 'confirmed');
      
      // Load funder keypair
      if (!fs.existsSync(options.funderKeypair)) {
        throw new Error(`Funder keypair not found: ${options.funderKeypair}`);
      }
      
      const funderKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(options.funderKeypair, 'utf8')))
      );
      
      console.log(chalk.gray(`Funder: ${funderKeypair.publicKey.toString()}`));
      
      // Check funder balance
      const balance = await connection.getBalance(funderKeypair.publicKey);
      const requiredLamports = parseFloat(options.amount) * LAMPORTS_PER_SOL;
      
      console.log(chalk.gray(`Current balance: ${balance / LAMPORTS_PER_SOL} SOL`));
      console.log(chalk.gray(`Required: ${requiredLamports / LAMPORTS_PER_SOL} SOL`));
      
      if (balance < requiredLamports) {
        throw new Error('Insufficient balance for funding');
      }
      
      // Create SDK client
      const idl = {}; // Load from target/idl/memecoin_lending.json
      const client = new MemecoinLendingClient(
        connection,
        funderKeypair as any,
        PROGRAM_ID,
        idl as any
      );
      
      // Get treasury PDA
      const [treasuryPDA] = client.getTreasuryPDA();
      console.log(chalk.gray(`Treasury: ${treasuryPDA.toString()}`));
      
      // Get current treasury balance
      const treasuryBalance = await connection.getBalance(treasuryPDA);
      console.log(chalk.gray(`Current treasury balance: ${treasuryBalance / LAMPORTS_PER_SOL} SOL`));
      
      // Create funding transaction
      console.log(chalk.blue('📤 Creating funding transaction...'));
      
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: funderKeypair.publicKey,
          toPubkey: treasuryPDA,
          lamports: requiredLamports,
        })
      );
      
      // Send transaction
      const signature = await connection.sendTransaction(
        transaction,
        [funderKeypair],
        { skipPreflight: false, preflightCommitment: 'confirmed' }
      );
      
      console.log(chalk.yellow('⏳ Confirming transaction...'));
      
      await connection.confirmTransaction(signature, 'confirmed');
      
      console.log(chalk.green('✅ Treasury funded successfully!'));
      console.log(chalk.gray(`Transaction: ${signature}`));
      
      // Check new treasury balance
      const newTreasuryBalance = await connection.getBalance(treasuryPDA);
      console.log(chalk.green(`New treasury balance: ${newTreasuryBalance / LAMPORTS_PER_SOL} SOL`));
      
      // Update protocol state
      try {
        const protocolState = await client.getProtocolState();
        console.log(chalk.blue('\n📊 Protocol State:'));
        console.log(chalk.gray(`  Treasury Balance: ${protocolState.treasuryBalance} lamports`));
        console.log(chalk.gray(`  Total Loans Created: ${protocolState.totalLoansCreated}`));
        console.log(chalk.gray(`  Total SOL Borrowed: ${protocolState.totalSolBorrowed}`));
      } catch (error) {
        console.log(chalk.yellow('Could not fetch updated protocol state'));
      }
      
      console.log(chalk.green('\n✅ Treasury funding completed!'));
      console.log(chalk.gray('The protocol is now ready to accept loans.'));
      
    } catch (error) {
      console.error(chalk.red('❌ Treasury funding failed:'), error);
      process.exit(1);
    }
  });

program.parse();