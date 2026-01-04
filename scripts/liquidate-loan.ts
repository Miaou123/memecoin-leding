#!/usr/bin/env tsx

/**
 * Liquidate Loan CLI
 * 
 * Usage:
 *   pnpm --filter scripts liquidate-loan --loan <LOAN_PUBKEY> --network devnet
 *   pnpm --filter scripts liquidate-loan --find-liquidatable --network devnet
 */

import { config } from 'dotenv';
import { PublicKey } from '@solana/web3.js';
import { Command } from 'commander';
import chalk from 'chalk';
import { 
  createClient, 
  printHeader, 
  printInfo, 
  printSuccess,
  printError,
  printTxLink,
  formatSOL, 
  formatTokens,
  formatLoanStatus,
  padRight
} from './cli-utils';

config();

const program = new Command();

program
  .name('liquidate-loan')
  .description('Liquidate an expired or underwater loan')
  .option('-l, --loan <pubkey>', 'Loan account public key to liquidate')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --keypair <path>', 'Path to liquidator keypair', './keys/admin.json')
  .option('--find-liquidatable', 'Find and list all liquidatable loans')
  .option('--dry-run', 'Simulate the transaction without executing')
  .action(async (options) => {
    try {
      printHeader('⚡ Liquidate Loan');
      
      console.log(chalk.gray(`Network: ${options.network}\n`));
      
      const { client, keypair, connection } = await createClient(options.network, options.keypair);
      
      // Find liquidatable loans mode
      if (options.findLiquidatable) {
        console.log(chalk.blue('🔍 Scanning for liquidatable loans...\n'));
        
        const allLoans = await client.getAllLoans();
        const now = Math.floor(Date.now() / 1000);
        
        const liquidatable: any[] = [];
        
        for (const loan of allLoans) {
          const isActive = loan.status === 'Active' || loan.status?.active;
          if (!isActive) continue;
          
          const isOverdue = loan.dueAt < now;
          // TODO: Add price-based liquidation check when price oracle is available
          
          if (isOverdue) {
            liquidatable.push({
              ...loan,
              reason: 'Overdue (Time-based)',
            });
          }
        }
        
        if (liquidatable.length === 0) {
          console.log(chalk.green('✅ No liquidatable loans found.'));
          return;
        }
        
        console.log(chalk.yellow(`Found ${liquidatable.length} liquidatable loan(s):\n`));
        
        console.log(chalk.blue('─'.repeat(100)));
        console.log(
          chalk.bold(
            padRight('Loan PDA', 48) +
            padRight('Collateral', 18) +
            padRight('Borrowed', 14) +
            'Reason'
          )
        );
        console.log(chalk.blue('─'.repeat(100)));
        
        for (const loan of liquidatable) {
          console.log(
            padRight(loan.pubkey.slice(0, 44) + '...', 48) +
            padRight(formatTokens(loan.collateralAmount) + ' tokens', 18) +
            padRight(formatSOL(loan.solBorrowed) + ' SOL', 14) +
            chalk.red(loan.reason)
          );
        }
        
        console.log(chalk.blue('─'.repeat(100)));
        console.log('');
        console.log(chalk.gray('To liquidate, run:'));
        console.log(chalk.gray(`  pnpm --filter scripts liquidate-loan --loan <LOAN_PDA> --network ${options.network}`));
        console.log('');
        return;
      }
      
      // Liquidate specific loan
      if (!options.loan) {
        throw new Error('Please provide --loan <pubkey> or use --find-liquidatable');
      }
      
      const loanPubkey = new PublicKey(options.loan);
      
      console.log(chalk.blue('🔍 Fetching loan details...\n'));
      
      const loan = await client.getLoan(loanPubkey);
      
      if (!loan) {
        throw new Error('Loan not found');
      }
      
      // Check loan status
      const isActive = loan.status === 'Active' || loan.status?.active;
      if (!isActive) {
        throw new Error(`Loan is not active. Current status: ${formatLoanStatus(loan.status)}`);
      }
      
      const dueDate = new Date(loan.dueAt * 1000);
      const now = new Date();
      const isOverdue = dueDate < now;
      
      console.log(chalk.blue('📋 Loan Details:'));
      printInfo('Loan PDA', loan.pubkey);
      printInfo('Borrower', loan.borrower);
      printInfo('Token Mint', loan.tokenMint);
      printInfo('Collateral', formatTokens(loan.collateralAmount) + ' tokens');
      printInfo('SOL Borrowed', formatSOL(loan.solBorrowed) + ' SOL');
      printInfo('Due Date', dueDate.toLocaleString());
      printInfo('Status', isOverdue ? chalk.red('OVERDUE - Liquidatable') : chalk.green('Not yet due'));
      
      // Check if liquidatable
      let isLiquidatable = false;
      let reason = '';
      
      if (isOverdue) {
        isLiquidatable = true;
        reason = 'Time-based liquidation (loan expired)';
      }
      
      // TODO: Add price-based liquidation check
      // const currentPrice = await client.getTokenPrice(new PublicKey(loan.tokenMint));
      // if (currentPrice < loan.liquidationPrice) {
      //   isLiquidatable = true;
      //   reason = 'Price-based liquidation (below threshold)';
      // }
      
      if (!isLiquidatable) {
        console.log(chalk.yellow('\n⚠️  This loan is not yet liquidatable.'));
        console.log(chalk.gray(`   Loan is due at: ${dueDate.toLocaleString()}`));
        console.log(chalk.gray(`   Current time: ${now.toLocaleString()}`));
        return;
      }
      
      console.log(chalk.yellow(`\n⚡ Liquidation Reason: ${reason}`));
      
      console.log(chalk.blue('\n💰 Liquidation Info:'));
      printInfo('Auto-liquidation', 'Protocol automatically liquidates via PumpFun/Jupiter');
      printInfo('Liquidator Reward', 'No manual liquidation bonuses - system handles liquidation');
      
      if (options.dryRun) {
        console.log(chalk.yellow('\n🔶 DRY RUN - Transaction not executed'));
        return;
      }
      
      // Execute liquidation
      console.log(chalk.yellow('\n⏳ Executing liquidation...'));
      
      const txSignature = await client.liquidate(loanPubkey);
      
      console.log('');
      printSuccess('Loan liquidated successfully!');
      printInfo('Transaction', txSignature);
      printTxLink(txSignature, options.network);
      
      console.log(chalk.green('\n🎉 Collateral liquidated automatically via DEX!'));
      console.log('');
      
    } catch (error: any) {
      printError(`Failed to liquidate loan: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();