#!/usr/bin/env tsx

import { createClient, printHeader, printSuccess, printError, printInfo, printTxLink } from './cli-utils.js';
import { validateNetwork, getNetworkConfig, updateDeployment } from './config.js';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import BN from 'bn.js';
import chalk from 'chalk';
import { Command } from 'commander';

const program = new Command();

program
  .name('update-staking-config')
  .description('Update staking pool configuration')
  .requiredOption('--network <network>', 'Solana network (devnet, mainnet, localnet)')
  .option('--admin-keypair <path>', 'Path to admin keypair (defaults to ./keys/admin.json)')
  .option('--target-balance <sol>', 'Target pool balance in SOL for optimal APR')
  .option('--base-rate <lamports>', 'Base emission rate in lamports/second')
  .option('--max-rate <lamports>', 'Max emission rate in lamports/second')
  .option('--min-rate <lamports>', 'Min emission rate in lamports/second')
  .option('--pause', 'Pause staking pool')
  .option('--unpause', 'Unpause staking pool')
  .action(async (options) => {
    try {
      printHeader('Update Staking Config');
      
      // Validate network
      validateNetwork(options.network);
      const config = getNetworkConfig(options.network);
      
      printInfo('Network', options.network);
      printInfo('Program ID', config.programId);
      
      // Create client
      const { client, keypair } = await createClient(options.network, options.adminKeypair);
      
      printInfo('Admin', keypair.publicKey.toString());
      
      // Validate that at least one parameter is provided
      const hasUpdates = !!(
        options.targetBalance ||
        options.baseRate ||
        options.maxRate ||
        options.minRate ||
        options.pause ||
        options.unpause
      );
      
      if (!hasUpdates) {
        console.log(chalk.yellow('No parameters provided to update.'));
        console.log(chalk.gray('Available options:'));
        console.log(chalk.gray('  --target-balance <sol>     Target pool balance in SOL'));
        console.log(chalk.gray('  --base-rate <lamports>     Base emission rate in lamports/second'));
        console.log(chalk.gray('  --max-rate <lamports>      Max emission rate in lamports/second'));
        console.log(chalk.gray('  --min-rate <lamports>      Min emission rate in lamports/second'));
        console.log(chalk.gray('  --pause                    Pause staking pool'));
        console.log(chalk.gray('  --unpause                  Unpause staking pool'));
        return;
      }
      
      // Validate pause/unpause conflict
      if (options.pause && options.unpause) {
        throw new Error('Cannot use both --pause and --unpause options together');
      }
      
      // Check if staking pool exists by fetching it
      console.log(chalk.yellow('\\n🔍 Checking staking pool...'));
      
      let stakingPoolData: any;
      try {
        // Derive staking pool PDA
        const [stakingPoolPDA] = PublicKey.findProgramAddressSync(
          [Buffer.from('staking_pool')],
          new PublicKey(config.programId)
        );
        
        // Try to fetch staking pool data using anchor program
        const program = (client as any).program;
        stakingPoolData = await program.account.stakingPool.fetch(stakingPoolPDA);
      } catch (error) {
        throw new Error('Staking pool not found. Please run initialize-staking.ts first.');
      }
      
      // Parse and validate parameters
      let targetPoolBalance: BN | undefined;
      let baseEmissionRate: BN | undefined;
      let maxEmissionRate: BN | undefined;
      let minEmissionRate: BN | undefined;
      let paused: boolean | undefined;
      
      if (options.targetBalance) {
        const targetBalanceSOL = parseFloat(options.targetBalance);
        if (isNaN(targetBalanceSOL) || targetBalanceSOL <= 0) {
          throw new Error('Invalid target balance. Must be a positive number.');
        }
        targetPoolBalance = new BN(Math.floor(targetBalanceSOL * LAMPORTS_PER_SOL));
      }
      
      if (options.baseRate) {
        const baseRate = parseInt(options.baseRate);
        if (isNaN(baseRate) || baseRate < 0) {
          throw new Error('Invalid base rate. Must be a non-negative integer.');
        }
        baseEmissionRate = new BN(baseRate);
      }
      
      if (options.maxRate) {
        const maxRate = parseInt(options.maxRate);
        if (isNaN(maxRate) || maxRate < 0) {
          throw new Error('Invalid max rate. Must be a non-negative integer.');
        }
        maxEmissionRate = new BN(maxRate);
      }
      
      if (options.minRate) {
        const minRate = parseInt(options.minRate);
        if (isNaN(minRate) || minRate < 0) {
          throw new Error('Invalid min rate. Must be a non-negative integer.');
        }
        minEmissionRate = new BN(minRate);
      }
      
      if (options.pause) {
        paused = true;
      } else if (options.unpause) {
        paused = false;
      }
      
      // Display current configuration
      console.log(chalk.blue('\\n📊 Current Configuration:'));
      console.log(chalk.gray(`  Target Balance:    ${(stakingPoolData.targetPoolBalance.toNumber() / LAMPORTS_PER_SOL).toFixed(2)} SOL`));
      console.log(chalk.gray(`  Base Rate:         ${stakingPoolData.baseEmissionRate.toNumber().toLocaleString()} lamports/sec`));
      console.log(chalk.gray(`  Max Rate:          ${stakingPoolData.maxEmissionRate.toNumber().toLocaleString()} lamports/sec`));
      console.log(chalk.gray(`  Min Rate:          ${stakingPoolData.minEmissionRate.toNumber().toLocaleString()} lamports/sec`));
      console.log(chalk.gray(`  Paused:            ${stakingPoolData.paused}`));
      
      // Display changes to apply
      console.log(chalk.blue('\\n🔧 Changes to apply:'));
      if (targetPoolBalance) {
        const currentSOL = (stakingPoolData.targetPoolBalance.toNumber() / LAMPORTS_PER_SOL).toFixed(2);
        const newSOL = (targetPoolBalance.toNumber() / LAMPORTS_PER_SOL).toFixed(2);
        console.log(chalk.green(`  Target Balance:    ${currentSOL} SOL → ${newSOL} SOL`));
      }
      if (baseEmissionRate) {
        const current = stakingPoolData.baseEmissionRate.toNumber().toLocaleString();
        const newRate = baseEmissionRate.toNumber().toLocaleString();
        console.log(chalk.green(`  Base Rate:         ${current} → ${newRate} lamports/sec`));
      }
      if (maxEmissionRate) {
        const current = stakingPoolData.maxEmissionRate.toNumber().toLocaleString();
        const newRate = maxEmissionRate.toNumber().toLocaleString();
        console.log(chalk.green(`  Max Rate:          ${current} → ${newRate} lamports/sec`));
      }
      if (minEmissionRate) {
        const current = stakingPoolData.minEmissionRate.toNumber().toLocaleString();
        const newRate = minEmissionRate.toNumber().toLocaleString();
        console.log(chalk.green(`  Min Rate:          ${current} → ${newRate} lamports/sec`));
      }
      if (paused !== undefined) {
        const current = stakingPoolData.paused;
        console.log(chalk.green(`  Paused:            ${current} → ${paused}`));
      }
      
      console.log(chalk.yellow('\\n🔄 Sending transaction...'));
      
      // Update staking config
      const signature = await client.updateStakingConfig({
        targetPoolBalance,
        baseEmissionRate,
        maxEmissionRate,
        minEmissionRate,
        paused,
      });
      
      printSuccess('Staking config updated successfully!');
      printInfo('Transaction', signature);
      printTxLink(signature, options.network);
      
      // Fetch updated configuration
      console.log(chalk.yellow('\\n📊 Fetching updated configuration...'));
      const updatedStakingPoolData = await (client as any).program.account.stakingPool.fetch(
        PublicKey.findProgramAddressSync(
          [Buffer.from('staking_pool')],
          new PublicKey(config.programId)
        )[0]
      );
      
      // Display new configuration
      console.log(chalk.blue('\\n📊 New Configuration:'));
      console.log(chalk.gray(`  Target Balance:    ${(updatedStakingPoolData.targetPoolBalance.toNumber() / LAMPORTS_PER_SOL).toFixed(2)} SOL`));
      console.log(chalk.gray(`  Base Rate:         ${updatedStakingPoolData.baseEmissionRate.toNumber().toLocaleString()} lamports/sec`));
      console.log(chalk.gray(`  Max Rate:          ${updatedStakingPoolData.maxEmissionRate.toNumber().toLocaleString()} lamports/sec`));
      console.log(chalk.gray(`  Min Rate:          ${updatedStakingPoolData.minEmissionRate.toNumber().toLocaleString()} lamports/sec`));
      console.log(chalk.gray(`  Paused:            ${updatedStakingPoolData.paused}`));
      
      // Update deployment config with new staking configuration
      console.log(chalk.yellow('\\n💾 Updating deployment config...'));
      updateDeployment(options.network, {
        initialization: {
          staking: {
            txSignature: signature,
            timestamp: new Date().toISOString(),
            lastConfigUpdate: new Date().toISOString(),
          }
        }
      });
      
      printSuccess('Deployment config updated with staking configuration changes');
      
      console.log(chalk.green('\\n✅ Staking config update complete!'));
      
    } catch (error) {
      printError(`Failed to update staking config: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse(process.argv);