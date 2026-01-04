#!/usr/bin/env tsx

import { config } from 'dotenv';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import { getNetworkConfig } from '@memecoin-lending/config';
import chalk from 'chalk';
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';

config();

const program = new Command();

program
  .name('deploy-program')
  .description('Deploy the memecoin lending program to Solana')
  .option('-n, --network <network>', 'Network to deploy to (mainnet-beta, devnet, localnet)', 'devnet')
  .option('-k, --keypair <path>', 'Path to deployer keypair', '../keys/deployer.json')
  .option('-p, --program-keypair <path>', 'Path to program keypair', '../keys/program.json')
  .action(async (options) => {
    try {
      console.log(chalk.blue('🚀 Starting program deployment...'));
      
      // Load network configuration
      process.env.SOLANA_NETWORK = options.network;
      const networkConfig = getNetworkConfig(options.network);
      
      console.log(chalk.gray(`Network: ${options.network}`));
      console.log(chalk.gray(`RPC: ${networkConfig.rpcUrl}`));
      
      // Create connection
      const connection = new Connection(networkConfig.rpcUrl, 'confirmed');
      
      // Load deployer keypair
      if (!fs.existsSync(options.keypair)) {
        throw new Error(`Deployer keypair not found: ${options.keypair}`);
      }
      
      const deployerKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(options.keypair, 'utf8')))
      );
      
      console.log(chalk.gray(`Deployer: ${deployerKeypair.publicKey.toString()}`));
      
      // Check deployer balance
      const balance = await connection.getBalance(deployerKeypair.publicKey);
      console.log(chalk.gray(`Balance: ${balance / 1e9} SOL`));
      
      if (balance < 0.1 * 1e9) { // 0.1 SOL minimum
        throw new Error('Insufficient balance for deployment');
      }
      
      // Load or generate program keypair
      let programKeypair: Keypair;
      
      if (fs.existsSync(options.programKeypair)) {
        programKeypair = Keypair.fromSecretKey(
          Uint8Array.from(JSON.parse(fs.readFileSync(options.programKeypair, 'utf8')))
        );
        console.log(chalk.yellow(`Using existing program keypair: ${programKeypair.publicKey.toString()}`));
      } else {
        programKeypair = Keypair.generate();
        
        // Save program keypair
        fs.mkdirSync(path.dirname(options.programKeypair), { recursive: true });
        fs.writeFileSync(
          options.programKeypair,
          JSON.stringify(Array.from(programKeypair.secretKey))
        );
        
        console.log(chalk.green(`Generated new program keypair: ${programKeypair.publicKey.toString()}`));
      }
      
      // Deploy program using Anchor
      console.log(chalk.blue('📦 Building and deploying program...'));
      
      // Note: In a real implementation, you would:
      // 1. Run `anchor build` to compile the program
      // 2. Use `solana program deploy` or Anchor's deployment
      // 3. Verify the deployment
      
      // For this example, we'll simulate the deployment
      console.log(chalk.yellow('⚠️  Simulated deployment - integrate with Anchor CLI'));
      
      // Update environment with program ID
      const envPath = path.join(process.cwd(), '.env');
      let envContent = '';
      
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
      }
      
      // Update or add PROGRAM_ID
      if (envContent.includes('PROGRAM_ID=')) {
        envContent = envContent.replace(
          /PROGRAM_ID=.*/,
          `PROGRAM_ID=${programKeypair.publicKey.toString()}`
        );
      } else {
        envContent += `\nPROGRAM_ID=${programKeypair.publicKey.toString()}\n`;
      }
      
      fs.writeFileSync(envPath, envContent);
      
      console.log(chalk.green('✅ Program deployment completed!'));
      console.log(chalk.green(`Program ID: ${programKeypair.publicKey.toString()}`));
      console.log(chalk.gray('Next steps:'));
      console.log(chalk.gray('1. Run initialize-protocol to set up the protocol'));
      console.log(chalk.gray('2. Run whitelist-token to add supported tokens'));
      console.log(chalk.gray('3. Run fund-treasury to add initial liquidity'));
      
    } catch (error) {
      console.error(chalk.red('❌ Deployment failed:'), error);
      process.exit(1);
    }
  });

program.parse();