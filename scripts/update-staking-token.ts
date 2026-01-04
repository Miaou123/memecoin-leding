#!/usr/bin/env tsx

/**
 * Update Staking Token CLI
 * 
 * Usage:
 *   pnpm --filter scripts update-staking-token --mint <TOKEN_MINT> --network devnet
 *   npx tsx update-staking-token.ts --mint <TOKEN_MINT> --network devnet
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import chalk from 'chalk';
import { PublicKey } from '@solana/web3.js';
import { 
  createClient, 
  printHeader, 
  printInfo, 
  printSuccess,
  printError,
  printTxLink
} from './cli-utils.js';
import { updateStakingConfigNew, loadDeploymentConfigNew } from './config.js';

config();

const program = new Command();

program
  .name('update-staking-token')
  .description('Update the staking token mint (only when total_staked == 0)')
  .requiredOption('-m, --mint <address>', 'New staking token mint address')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --keypair <path>', 'Path to admin keypair', '../keys/admin.json')
  .option('--dry-run', 'Simulate the transaction without executing')
  .action(async (options) => {
    try {
      printHeader('🔄 Update Staking Token');
      
      console.log(chalk.gray(`Network: ${options.network}`));
      if (options.dryRun) {
        console.log(chalk.yellow('DRY RUN MODE - Transaction will not be executed\n'));
      }
      console.log('');
      
      const { client } = await createClient(options.network, options.keypair);
      
      // Validate mint
      let newMint: PublicKey;
      try {
        newMint = new PublicKey(options.mint);
      } catch {
        throw new Error('Invalid mint address provided');
      }
      
      // Check current pool state
      console.log(chalk.blue('📊 Checking current staking pool state...'));
      const pool = await client.getStakingPool();
      if (!pool) {
        throw new Error('Staking pool not initialized. Please initialize staking first.');
      }
      
      console.log(chalk.blue('\n📋 Current Pool State:'));
      printInfo('Current Token Mint', pool.stakingTokenMint);
      printInfo('Current Vault', pool.stakingVault);
      printInfo('Total Staked', `${Number(pool.totalStaked) / 1e6} tokens`);
      printInfo('Pool Paused', pool.paused ? 'Yes' : 'No');
      
      console.log(chalk.blue('\n🎯 Proposed Changes:'));
      printInfo('New Token Mint', newMint.toString());
      
      // SECURITY CHECK: Ensure no tokens are currently staked
      if (Number(pool.totalStaked) > 0) {
        console.log(chalk.red('\n❌ SECURITY ERROR:'));
        console.log(chalk.red('Cannot change staking token while users have active stakes!'));
        console.log(chalk.gray(`Total staked: ${Number(pool.totalStaked) / 1e6} tokens`));
        console.log(chalk.gray('Please wait for all users to unstake before changing the token.'));
        process.exit(1);
      }
      
      // Check if the new mint is different
      if (pool.stakingTokenMint === newMint.toString()) {
        console.log(chalk.yellow('\n⚠️  The new mint is the same as the current mint.'));
        console.log(chalk.gray('No changes will be made.'));
        return;
      }
      
      console.log(chalk.green('\n✅ Security Check Passed:'));
      console.log(chalk.gray('• Total staked is 0 - safe to change token'));
      console.log(chalk.gray('• New mint is different from current mint'));
      
      if (options.dryRun) {
        console.log(chalk.yellow('\n🔶 DRY RUN - Would update staking token'));
        console.log(chalk.gray('Run without --dry-run to execute the transaction'));
        return;
      }
      
      console.log(chalk.yellow('\n⏳ Updating staking token...'));
      console.log(chalk.gray('This will create a new staking vault for the new token'));
      
      const txSignature = await client.updateStakingConfig({
        newStakingTokenMint: newMint,
      });
      
      console.log('');
      printSuccess('Staking token updated successfully!');
      printInfo('Transaction', txSignature);
      printTxLink(txSignature, options.network);
      
      // Verify the update
      console.log(chalk.blue('\n🔍 Verifying update...'));
      const updatedPool = await client.getStakingPool();
      if (updatedPool) {
        console.log(chalk.blue('\n📊 Updated Pool State:'));
        printInfo('New Token Mint', updatedPool.stakingTokenMint);
        printInfo('New Vault', updatedPool.stakingVault);
        printInfo('Total Staked', `${Number(updatedPool.totalStaked) / 1e6} tokens`);
        
        if (updatedPool.stakingTokenMint === newMint.toString()) {
          console.log(chalk.green('\n🎉 Update verified successfully!'));
        } else {
          console.log(chalk.yellow('\n⚠️  Warning: Verification shows unexpected state'));
        }
      }
      
      // Update deployment config
      console.log(chalk.yellow('\n💾 Updating deployment config...'));
      const existingConfig = loadDeploymentConfigNew(options.network);
      
      // Derive new staking vault authority and vault
      const programId = new PublicKey('65HMkr2uRgeiPQmC1uCtojsnfKcbCynsWGK3snnw8urs');
      const [stakingVaultAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from('staking_vault')],
        programId
      );
      
      const { getAssociatedTokenAddress } = await import('@solana/spl-token');
      const newStakingVault = await getAssociatedTokenAddress(
        newMint,
        stakingVaultAuthority,
        true
      );
      
      updateStakingConfigNew(options.network, {
        ...existingConfig?.staking,
        stakingTokenMint: newMint.toString(),
        stakingVault: newStakingVault.toString(),
        updatedAt: new Date().toISOString(),
      });
      
      console.log(chalk.blue('\n📝 Next Steps:'));
      console.log(chalk.gray('• Users can now stake the new token'));
      console.log(chalk.gray('• The old token vault is no longer used'));
      console.log(chalk.gray('• Consider testing with a small stake to verify functionality'));
      console.log('');
      
    } catch (error: any) {
      console.log('');
      printError(`Failed to update staking token: ${error.message}`);
      
      if (error.message.includes('CannotChangeTokenWithActiveStakes')) {
        console.log(chalk.gray('\n💡 This error means users currently have tokens staked.'));
        console.log(chalk.gray('Wait for all users to unstake before changing the token.'));
      } else if (error.message.includes('Unauthorized')) {
        console.log(chalk.gray('\n💡 Only the protocol admin can update staking configuration.'));
        console.log(chalk.gray('Make sure you are using the correct admin keypair.'));
      } else if (error.message.includes('Invalid')) {
        console.log(chalk.gray('\n💡 Check that the mint address is valid and the token exists.'));
      }
      
      process.exit(1);
    }
  });

program.parse();