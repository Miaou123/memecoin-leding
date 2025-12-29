#!/usr/bin/env tsx

/**
 * Get Loans CLI
 * 
 * Usage:
 *   pnpm --filter scripts get-loans --network devnet
 *   pnpm --filter scripts get-loans --borrower <WALLET> --network devnet
 *   pnpm --filter scripts get-loans --loan <LOAN_PUBKEY> --network devnet
 *   pnpm --filter scripts get-loans --active --network devnet
 */

import { config } from 'dotenv';
import { PublicKey } from '@solana/web3.js';
import { Command } from 'commander';
import chalk from 'chalk';
import { 
  createClient, 
  printHeader, 
  printInfo, 
  formatSOL, 
  formatTokens,
  formatLoanStatus,
  formatDuration,
  padRight
} from './cli-utils';

config();

const program = new Command();

program
  .name('get-loans')
  .description('View loans - all, by borrower, or specific loan')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --keypair <path>', 'Path to keypair', './keys/admin.json')
  .option('-b, --borrower <wallet>', 'Filter by borrower wallet address')
  .option('-l, --loan <pubkey>', 'Get specific loan by pubkey')
  .option('-a, --active', 'Show only active loans')
  .option('--limit <number>', 'Limit number of results', '50')
  .action(async (options) => {
    try {
      printHeader('📋 Loans');
      
      console.log(chalk.gray(`Network: ${options.network}`));
      
      const { client } = await createClient(options.network, options.keypair);
      
      // Get specific loan
      if (options.loan) {
        console.log(chalk.gray(`Fetching loan: ${options.loan}\n`));
        
        const loan = await client.getLoan(new PublicKey(options.loan));
        
        if (!loan) {
          console.log(chalk.yellow('Loan not found.'));
          return;
        }
        
        printLoanDetails(loan);
        return;
      }
      
      // Get loans by borrower or all loans
      let loans: any[];
      
      if (options.borrower) {
        console.log(chalk.gray(`Fetching loans for: ${options.borrower}\n`));
        loans = await client.getLoansByBorrower(new PublicKey(options.borrower));
      } else {
        console.log(chalk.gray('Fetching all loans...\n'));
        loans = await client.getAllLoans();
      }
      
      // Filter active only if requested
      if (options.active) {
        loans = loans.filter(loan => loan.status === 'Active' || loan.status?.active);
      }
      
      // Limit results
      const limit = parseInt(options.limit);
      if (loans.length > limit) {
        loans = loans.slice(0, limit);
        console.log(chalk.yellow(`Showing first ${limit} loans...\n`));
      }
      
      if (loans.length === 0) {
        console.log(chalk.yellow('No loans found.'));
        return;
      }
      
      console.log(chalk.green(`Found ${loans.length} loan(s):\n`));
      
      // Print summary table
      console.log(chalk.blue('─'.repeat(120)));
      console.log(
        chalk.bold(
          padRight('Loan PDA', 48) +
          padRight('Borrower', 16) +
          padRight('Collateral', 15) +
          padRight('Borrowed', 12) +
          padRight('Status', 15) +
          'Due'
        )
      );
      console.log(chalk.blue('─'.repeat(120)));
      
      for (const loan of loans) {
        const dueDate = new Date(loan.dueAt * 1000);
        const isOverdue = dueDate < new Date() && (loan.status === 'Active' || loan.status?.active);
        
        console.log(
          padRight(loan.pubkey.slice(0, 44) + '...', 48) +
          padRight(loan.borrower.slice(0, 12) + '...', 16) +
          padRight(formatTokens(loan.collateralAmount), 15) +
          padRight(formatSOL(loan.solBorrowed) + ' SOL', 12) +
          padRight(formatLoanStatusSimple(loan.status), 15) +
          (isOverdue ? chalk.red(dueDate.toLocaleDateString()) : dueDate.toLocaleDateString())
        );
      }
      
      console.log(chalk.blue('─'.repeat(120)));
      console.log('');
      
      // Summary stats
      const activeLoans = loans.filter(l => l.status === 'Active' || l.status?.active);
      const totalBorrowed = loans.reduce((sum, l) => sum + parseInt(l.solBorrowed || '0'), 0);
      
      console.log(chalk.blue('📊 Summary:'));
      printInfo('Total Loans', loans.length.toString());
      printInfo('Active Loans', activeLoans.length.toString());
      printInfo('Total Borrowed', `${formatSOL(totalBorrowed)} SOL`);
      console.log('');
      
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to get loans:'), error.message);
      process.exit(1);
    }
  });

function printLoanDetails(loan: any): void {
  const dueDate = new Date(loan.dueAt * 1000);
  const createdDate = new Date(loan.createdAt * 1000);
  const isOverdue = dueDate < new Date() && (loan.status === 'Active' || loan.status?.active);
  
  console.log(chalk.blue('📝 Loan Details:'));
  printInfo('Loan PDA', loan.pubkey);
  printInfo('Borrower', loan.borrower);
  printInfo('Token Mint', loan.tokenMint);
  
  console.log(chalk.blue('\n💰 Amounts:'));
  printInfo('Collateral', formatTokens(loan.collateralAmount) + ' tokens');
  printInfo('SOL Borrowed', formatSOL(loan.solBorrowed) + ' SOL');
  printInfo('Entry Price', loan.entryPrice + ' lamports/token');
  printInfo('Liquidation Price', loan.liquidationPrice + ' lamports/token');
  
  console.log(chalk.blue('\n📅 Timing:'));
  printInfo('Created', createdDate.toLocaleString());
  printInfo('Due Date', isOverdue ? chalk.red(dueDate.toLocaleString() + ' (OVERDUE)') : dueDate.toLocaleString());
  printInfo('Duration', formatDuration(loan.dueAt - loan.createdAt));
  
  console.log(chalk.blue('\n📊 Terms:'));
  printInfo('Interest Rate', `${loan.interestRateBps / 100}% APR`);
  printInfo('Status', formatLoanStatus(loan.status));
  printInfo('Loan Index', loan.index.toString());
  
  console.log('');
}

function formatLoanStatusSimple(status: any): string {
  if (typeof status === 'string') return status;
  if (status.active) return chalk.green('Active');
  if (status.repaid) return chalk.blue('Repaid');
  if (status.liquidatedTime) return chalk.red('Liquidated');
  if (status.liquidatedPrice) return chalk.red('Liquidated');
  return 'Unknown';
}

program.parse();