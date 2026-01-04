#!/usr/bin/env tsx

import { createClient, printHeader, printSuccess, printError, printInfo, printTxLink } from './cli-utils.js';
import { validateNetwork, getNetworkConfig, updateDeployment, updateStakingConfigNew } from './config.js';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import BN from 'bn.js';
import chalk from 'chalk';
import { Command } from 'commander';


const program = new Command();

program
  .name('initialize-staking')
  .description('Initialize the staking pool for governance token staking')
  .requiredOption('-m, --token-mint <address>', 'Governance token mint address')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --admin-keypair <path>', 'Path to admin keypair', '../keys/admin.json')
  .option('--target-balance <sol>', 'Target pool balance in SOL for optimal APR', '50')
  .option('--base-rate <lamports>', 'Base emission rate (lamports/second)', '1000000')
  .option('--max-rate <lamports>', 'Max emission rate (lamports/second)', '10000000')
  .option('--min-rate <lamports>', 'Min emission rate (lamports/second)', '100000')
  .action(async (options) => {
    try {
      printHeader('Initialize Staking Pool');
      
      // Validate token mint
      let stakingTokenMint: PublicKey;
      try {
        stakingTokenMint = new PublicKey(options.tokenMint);
      } catch {
        throw new Error(`Invalid token mint address: ${options.tokenMint}`);
      }
      
      // Validate network
      validateNetwork(options.network);
      const config = getNetworkConfig(options.network);
      
      printInfo('Network', options.network);
      printInfo('Program ID', config.programId);
      printInfo('Token Mint', stakingTokenMint.toString());
      
      // Create client
      const { client, keypair } = await createClient(options.network, options.adminKeypair);
      
      printInfo('Admin', keypair.publicKey.toString());
      
      // Derive PDAs
      const [stakingPool] = PublicKey.findProgramAddressSync(
        [Buffer.from('staking_pool')],
        new PublicKey(config.programId)
      );
      const [stakingVaultAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from('staking_vault')],
        new PublicKey(config.programId)
      );
      const [rewardVault] = PublicKey.findProgramAddressSync(
        [Buffer.from('reward_vault')],
        new PublicKey(config.programId)
      );
      
      // Get associated token address for staking vault
      const { getAssociatedTokenAddress } = await import('@solana/spl-token');
      const stakingVault = await getAssociatedTokenAddress(
        stakingTokenMint,
        stakingVaultAuthority,
        true
      );
      
      printInfo('Staking Pool PDA', stakingPool.toString());
      printInfo('Staking Vault', stakingVault.toString());
      printInfo('Reward Vault', rewardVault.toString());
      
      // Parse emission parameters
      const targetPoolBalance = new BN(parseFloat(options.targetBalance) * LAMPORTS_PER_SOL);
      const baseEmissionRate = new BN(options.baseRate);
      const maxEmissionRate = new BN(options.maxRate);
      const minEmissionRate = new BN(options.minRate);
      
      console.log(chalk.blue('\n⚙️  Emission Parameters:'));
      console.log(chalk.gray(`  Target Balance:  ${options.targetBalance} SOL`));
      console.log(chalk.gray(`  Base Rate:       ${options.baseRate} lamports/sec`));
      console.log(chalk.gray(`  Max Rate:        ${options.maxRate} lamports/sec`));
      console.log(chalk.gray(`  Min Rate:        ${options.minRate} lamports/sec`));
      
      console.log(chalk.yellow('\n🔄 Sending transaction...'));
      
      // Initialize staking
      const signature = await client.initializeStaking(
        stakingTokenMint,
        targetPoolBalance,
        baseEmissionRate,
        maxEmissionRate,
        minEmissionRate
      );
      
      printSuccess('Staking pool initialized successfully!');
      printInfo('Transaction', signature);
      printTxLink(signature, options.network);
      
      // Update deployment config with staking info
      console.log(chalk.yellow('\n💾 Updating deployment config...'));
      updateDeployment(options.network, {
        pdas: {
          stakingPool: stakingPool.toString(),
          stakingVault: stakingVault.toString(),
          rewardVault: rewardVault.toString(),
        },
        initialization: {
          staking: {
            txSignature: signature,
            timestamp: new Date().toISOString(),
            tokenMint: stakingTokenMint.toString(),
          }
        }
      });
      
      // Also update new deployment config format
      // Note: The correct stakingVaultAuthority is derived, not the ATA authority
      const [correctStakingVaultAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from('staking_vault')],
        new PublicKey(config.programId)
      );
      
      updateStakingConfigNew(options.network, {
        stakingPool: stakingPool.toString(),
        stakingTokenMint: stakingTokenMint.toString(),
        stakingVault: stakingVault.toString(),
        stakingVaultAuthority: correctStakingVaultAuthority.toString(),
        rewardVault: rewardVault.toString(),
        updatedAt: new Date().toISOString(),
      });
      
      printSuccess('Deployment config updated with staking addresses');
      
      console.log(chalk.green('\n✅ Staking pool initialization complete!'));
      
    } catch (error: any) {
      printError(`Failed to initialize staking: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

program.parse();