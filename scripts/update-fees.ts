#!/usr/bin/env tsx

/**
 * Update Fees CLI
 * 
 * Usage:
 *   pnpm --filter scripts update-fees --protocol 150 --network devnet
 *   pnpm --filter scripts update-fees --treasury 8500 --buyback 1000 --operations 500 --network devnet
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import chalk from 'chalk';
import { 
  createClient, 
  printHeader, 
  printInfo, 
  printSuccess,
  printError,
  printTxLink
} from './cli-utils';

config();

const program = new Command();

program
  .name('update-fees')
  .description('Update protocol fee configuration (admin only)')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --keypair <path>', 'Path to admin keypair', './keys/admin.json')
  .option('--protocol <bps>', 'Protocol fee in basis points (e.g., 100 = 1%)')
  .option('--treasury <bps>', 'Treasury fee share for liquidations in bps (e.g., 9000 = 90%)')
  .option('--buyback <bps>', 'Buyback fee share for liquidations in bps (e.g., 500 = 5%)')
  .option('--operations <bps>', 'Operations fee share for liquidations in bps (e.g., 500 = 5%)')
  .option('--dry-run', 'Simulate the transaction without executing')
  .action(async (options) => {
    try {
      printHeader('💸 Update Fees');
      
      console.log(chalk.gray(`Network: ${options.network}\n`));
      
      const { client, keypair } = await createClient(options.network, options.keypair);
      
      // Get current state
      const protocolState = await client.getProtocolState();
      
      // Verify admin
      if (protocolState.admin !== keypair.publicKey.toString()) {
        throw new Error(
          `You are not the protocol admin.\n` +
          `  Admin: ${protocolState.admin}\n` +
          `  Your wallet: ${keypair.publicKey.toString()}`
        );
      }
      
      console.log(chalk.blue('📊 Current Fee Configuration:'));
      printInfo('Protocol Fee', `${protocolState.protocolFeeBps / 100}% (${protocolState.protocolFeeBps} bps)`);
      printInfo('Treasury Fee (Liquidation)', `${protocolState.treasuryFeeBps / 100}% (${protocolState.treasuryFeeBps} bps)`);
      printInfo('Buyback Fee (Liquidation)', `${protocolState.buybackFeeBps / 100}% (${protocolState.buybackFeeBps} bps)`);
      printInfo('Operations Fee (Liquidation)', `${protocolState.operationsFeeBps / 100}% (${protocolState.operationsFeeBps} bps)`);
      
      // Determine new values
      const newProtocolFee = options.protocol !== undefined ? parseInt(options.protocol) : null;
      const newTreasuryFee = options.treasury !== undefined ? parseInt(options.treasury) : null;
      const newBuybackFee = options.buyback !== undefined ? parseInt(options.buyback) : null;
      const newOperationsFee = options.operations !== undefined ? parseInt(options.operations) : null;
      
      if (newProtocolFee === null && newTreasuryFee === null && newBuybackFee === null && newOperationsFee === null) {
        console.log(chalk.yellow('\n⚠️  No fee changes specified.'));
        console.log(chalk.gray('Use --protocol, --treasury, --buyback, --operations to specify values.'));
        return;
      }
      
      // Validate liquidation fee split if any are provided
      if (newTreasuryFee !== null || newBuybackFee !== null || newOperationsFee !== null) {
        const treasury = newTreasuryFee ?? protocolState.treasuryFeeBps;
        const buyback = newBuybackFee ?? protocolState.buybackFeeBps;
        const operations = newOperationsFee ?? protocolState.operationsFeeBps;
        
        const total = treasury + buyback + operations;
        if (total !== 10000) {
          throw new Error(
            `Liquidation fee split must equal 100% (10000 bps).\n` +
            `  Treasury: ${treasury} bps\n` +
            `  Buyback: ${buyback} bps\n` +
            `  Operations: ${operations} bps\n` +
            `  Total: ${total} bps (should be 10000)`
          );
        }
      }
      
      console.log(chalk.blue('\n📋 New Fee Configuration:'));
      if (newProtocolFee !== null) {
        printInfo('Protocol Fee', `${newProtocolFee / 100}% (${newProtocolFee} bps) ← CHANGED`);
      }
      if (newTreasuryFee !== null) {
        printInfo('Treasury Fee', `${newTreasuryFee / 100}% (${newTreasuryFee} bps) ← CHANGED`);
      }
      if (newBuybackFee !== null) {
        printInfo('Buyback Fee', `${newBuybackFee / 100}% (${newBuybackFee} bps) ← CHANGED`);
      }
      if (newOperationsFee !== null) {
        printInfo('Operations Fee', `${newOperationsFee / 100}% (${newOperationsFee} bps) ← CHANGED`);
      }
      
      if (options.dryRun) {
        console.log(chalk.yellow('\n🔶 DRY RUN - Transaction not executed'));
        return;
      }
      
      console.log(chalk.yellow('\n⏳ Updating fees...'));
      
      const txSignature = await client.updateFees({
        protocolFeeBps: newProtocolFee ?? undefined,
        treasuryFeeBps: newTreasuryFee ?? undefined,
        buybackFeeBps: newBuybackFee ?? undefined,
        operationsFeeBps: newOperationsFee ?? undefined,
      });
      
      console.log('');
      printSuccess('Fees updated successfully!');
      printInfo('Transaction', txSignature);
      printTxLink(txSignature, options.network);
      console.log('');
      
    } catch (error: any) {
      printError(`Failed to update fees: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();