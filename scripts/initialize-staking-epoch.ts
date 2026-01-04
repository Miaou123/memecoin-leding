#!/usr/bin/env tsx

/**
 * Initialize Epoch-Based Staking Pool
 * 
 * Creates a new staking pool with epoch-based rewards where:
 * - Rewards are distributed at the end of each epoch
 * - Users must be staked for a FULL epoch to earn rewards (anti-gaming)
 * - Rewards accumulate across epochs if unclaimed
 * - Fair distribution - only distributes what exists in the vault
 * 
 * Usage:
 *   npx tsx initialize-staking-epoch.ts --network devnet --token-mint <address> --epoch-duration 300
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import chalk from 'chalk';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import BN from 'bn.js';
import { 
  createClient, 
  printHeader, 
  printInfo, 
  printSuccess,
  printError,
  printTxLink
} from './cli-utils.js';
import { saveDeploymentConfig, loadDeploymentConfig } from './config.js';

config();

const program = new Command();

program
  .name('initialize-staking-epoch')
  .description('Initialize epoch-based staking pool')
  .requiredOption('-t, --token-mint <address>', 'Staking token mint address')
  .option('-d, --epoch-duration <seconds>', 'Epoch duration in seconds', '300') // 5 minutes default
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --keypair <path>', 'Path to admin keypair', '../keys/admin.json')
  .action(async (options) => {
    try {
      printHeader('🥩 Initialize Epoch-Based Staking Pool');
      
      console.log(chalk.cyan('📋 Epoch-Based Staking System Features:'));
      console.log(chalk.white('  ✅ 5-minute epochs (configurable)'));
      console.log(chalk.white('  ✅ Auto-advance on any interaction'));
      console.log(chalk.white('  ✅ Must be staked FULL epoch to earn (anti-gaming)'));
      console.log(chalk.white('  ✅ Rewards accumulate across epochs'));
      console.log(chalk.white('  ✅ Fair proportional distribution'));
      console.log(chalk.white('  ✅ Never distributes more than exists in vault'));
      console.log('');
      
      const { client, keypair } = await createClient(options.network, options.keypair);
      
      const tokenMint = new PublicKey(options.tokenMint);
      const epochDuration = new BN(parseInt(options.epochDuration));
      
      printInfo('Token Mint', tokenMint.toString());
      printInfo('Epoch Duration', `${epochDuration.toString()} seconds (${epochDuration.toNumber() / 60} minutes)`);
      printInfo('Admin', keypair.publicKey.toString());
      
      console.log(chalk.yellow('⚠️  WARNING: This will replace any existing staking system!'));
      console.log(chalk.red('⚠️  Make sure to drain existing rewards first!'));
      console.log('');
      
      console.log('⏳ Initializing epoch-based staking pool...');
      
      const tx = await client.initializeStaking(tokenMint, epochDuration);
      
      printSuccess('Epoch-based staking pool initialized!');
      printTxLink(tx, options.network);
      
      // Save to deployment config
      console.log('\n📝 Updating deployment config...');
      const stakingPool = await client.getStakingPool();
      if (stakingPool) {
        const existing = loadDeploymentConfig(options.network);
        saveDeploymentConfig(options.network, {
          ...existing,
          staking: {
            stakingPool: stakingPool.stakingPool || '',
            stakingTokenMint: tokenMint.toString(),
            stakingVault: stakingPool.stakingVault,
            rewardVault: stakingPool.rewardVault,
            epochDuration: epochDuration.toNumber(),
            systemType: 'epoch-based',
            updatedAt: new Date().toISOString(),
          },
        });
        printSuccess('Deployment config updated!');
      }
      
      console.log(chalk.green('\n✅ Epoch-based staking system is ready!'));
      console.log(chalk.cyan('\n📋 Next Steps:'));
      console.log(chalk.white('  1. Deposit initial rewards: npx tsx deposit-rewards.ts --amount 5'));
      console.log(chalk.white('  2. Test staking: npx tsx stake-tokens.ts --amount 1000'));
      console.log(chalk.white('  3. Wait for epoch to complete (5 minutes)'));
      console.log(chalk.white('  4. Claim rewards: npx tsx claim-rewards.ts'));
      
    } catch (error: any) {
      printError(`Failed: ${error.message}`);
      
      if (error.message.includes('InvalidEpochDuration')) {
        console.log(chalk.yellow('\n💡 Epoch duration must be between 60 seconds (1 minute) and 604800 seconds (1 week)'));
      } else if (error.message.includes('account Address already in use')) {
        console.log(chalk.yellow('\n💡 Staking pool already exists. Use a different program or drain existing pool first.'));
      }
      
      process.exit(1);
    }
  });

program.parse();