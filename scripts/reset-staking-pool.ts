#!/usr/bin/env tsx

import { Connection, PublicKey, Keypair, SystemProgram } from '@solana/web3.js';
import { AnchorProvider, Program } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { Command } from 'commander';
import { validateNetwork, getNetworkConfig } from './config.js';

const program = new Command();

program
  .name('reset-staking-pool')
  .description('Close and reinitialize the staking pool')
  .option('-n, --network <network>', 'Network: devnet, mainnet, localnet', 'devnet')
  .option('-k, --admin-keypair <path>', 'Path to admin keypair', '../keys/admin.json')
  .option('--token-mint <address>', 'Token mint for staking', '6KHL8uUXFie8Xdy3EBvw6EgruiU3duc9fvGrWoZ9pump')
  .parse();

const options = program.opts();

async function main() {
  const network = validateNetwork(options.network);
  const networkConfig = getNetworkConfig(network);
  
  console.log(chalk.blue.bold('\n🔄 Reset Staking Pool\n'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log(chalk.white(`  Network:     ${network}`));
  console.log(chalk.white(`  RPC URL:     ${networkConfig.rpcUrl}`));
  console.log(chalk.gray('─'.repeat(60) + '\n'));

  // Load admin keypair
  const adminPath = path.resolve(options.adminKeypair);
  if (!fs.existsSync(adminPath)) {
    console.error(chalk.red(`❌ Admin keypair not found: ${adminPath}`));
    process.exit(1);
  }
  
  const adminKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(adminPath, 'utf8')))
  );
  
  const connection = new Connection(networkConfig.rpcUrl, 'confirmed');
  const provider = new AnchorProvider(connection, adminKeypair as any, {
    commitment: 'confirmed',
  });

  // Load IDL
  const idlPath = path.resolve(__dirname, '../target/idl/memecoin_lending.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
  
  // Get program ID from deployment
  const deploymentPath = path.join(__dirname, '..', 'deployments', `${network}-latest.json`);
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  const programId = new PublicKey(deployment.programId);
  
  const program = new Program(idl, programId, provider);

  // Derive staking pool PDA
  const [stakingPoolPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('staking_pool')],
    programId
  );

  try {
    console.log(chalk.yellow('⚠️  WARNING: This will close the existing staking pool!'));
    console.log(chalk.yellow('   All staked tokens will need to be withdrawn first.\n'));
    
    // Check if staking pool exists
    const stakingPoolInfo = await connection.getAccountInfo(stakingPoolPDA);
    if (!stakingPoolInfo) {
      console.log(chalk.gray('   Staking pool does not exist'));
    } else {
      console.log(chalk.gray(`   Current staking pool: ${stakingPoolPDA.toBase58()}`));
      console.log(chalk.gray(`   Account size: ${stakingPoolInfo.data.length} bytes`));
      
      // Try to close the account (this would need a specific instruction in your program)
      console.log(chalk.red('\n❌ Cannot automatically close staking pool.'));
      console.log(chalk.yellow('   The program needs a close_staking_pool instruction.'));
      console.log(chalk.yellow('   Or deploy with a new program ID to get fresh PDAs.\n'));
      
      console.log(chalk.blue('Alternative solutions:'));
      console.log(chalk.gray('1. Deploy with --skip-keygen=false to get new program ID'));
      console.log(chalk.gray('2. Add a close_staking_pool instruction to the program'));
      console.log(chalk.gray('3. Manually update the staking pool data\n'));
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Error:'), error);
    process.exit(1);
  }
}

main().catch(console.error);