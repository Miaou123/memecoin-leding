#!/usr/bin/env tsx

/**
 * Repay Loan CLI
 * 
 * Usage:
 *   pnpm --filter scripts repay-loan --loan <LOAN_PUBKEY> --network devnet
 *   pnpm --filter scripts repay-loan --loan <LOAN_PUBKEY> --keypair ./keys/borrower.json
 */

import { config } from 'dotenv';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
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
  formatDuration
} from './cli-utils';

config();

const program = new Command();

program
  .name('repay-loan')
  .description('Repay a loan and reclaim your collateral')
  .requiredOption('-l, --loan <pubkey>', 'Loan account public key')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --keypair <path>', 'Path to borrower keypair', './keys/admin.json')
  .option('--dry-run', 'Simulate the transaction without executing')
  .action(async (options) => {
    try {
      printHeader('💸 Repay Loan');
      
      console.log(chalk.gray(`Network: ${options.network}`));
      console.log(chalk.gray(`Loan: ${options.loan}\n`));
      
      const { client, keypair, connection } = await createClient(options.network, options.keypair);
      const loanPubkey = new PublicKey(options.loan);
      
      // Fetch loan details
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
      
      // Verify borrower
      if (loan.borrower !== keypair.publicKey.toString()) {
        throw new Error(
          `You are not the borrower of this loan.\n` +
          `  Loan borrower: ${loan.borrower}\n` +
          `  Your wallet: ${keypair.publicKey.toString()}`
        );
      }
      
      const dueDate = new Date(loan.dueAt * 1000);
      const createdDate = new Date(loan.createdAt * 1000);
      const isOverdue = dueDate < new Date();
      const timeRemaining = loan.dueAt - Math.floor(Date.now() / 1000);
      
      console.log(chalk.blue('📋 Loan Details:'));
      printInfo('Borrower', loan.borrower);
      printInfo('Token Mint', loan.tokenMint);
      printInfo('Collateral', formatTokens(loan.collateralAmount) + ' tokens');
      printInfo('SOL Borrowed', formatSOL(loan.solBorrowed) + ' SOL');
      printInfo('Interest Rate', `${loan.interestRateBps / 100}% APR`);
      printInfo('Created', createdDate.toLocaleString());
      printInfo('Due Date', isOverdue 
        ? chalk.red(dueDate.toLocaleString() + ' (OVERDUE!)') 
        : dueDate.toLocaleString()
      );
      
      if (!isOverdue) {
        printInfo('Time Remaining', formatDuration(timeRemaining));
      }
      
      // Calculate repayment amount
      console.log(chalk.blue('\n💰 Repayment Calculation:'));
      
      const principal = parseInt(loan.solBorrowed);
      const elapsedSeconds = Math.floor(Date.now() / 1000) - loan.createdAt;
      const interestRate = loan.interestRateBps / 10000; // Convert bps to decimal
      const interest = Math.floor(principal * interestRate * elapsedSeconds / (365 * 24 * 3600));
      const protocolFee = Math.floor(principal * 0.01); // 1% protocol fee
      const totalRepayment = principal + interest + protocolFee;
      
      printInfo('Principal', formatSOL(principal) + ' SOL');
      printInfo('Accrued Interest', formatSOL(interest) + ' SOL');
      printInfo('Protocol Fee (1%)', formatSOL(protocolFee) + ' SOL');
      printInfo('Total Repayment', chalk.bold(formatSOL(totalRepayment) + ' SOL'));
      
      // Check borrower's SOL balance
      const borrowerBalance = await connection.getBalance(keypair.publicKey);
      printInfo('Your SOL Balance', formatSOL(borrowerBalance) + ' SOL');
      
      if (borrowerBalance < totalRepayment + 10000) { // +10000 for tx fees
        throw new Error(
          `Insufficient SOL balance for repayment.\n` +
          `  Need: ~${formatSOL(totalRepayment + 10000)} SOL (including tx fees)\n` +
          `  Have: ${formatSOL(borrowerBalance)} SOL`
        );
      }
      
      if (isOverdue) {
        console.log(chalk.yellow('\n⚠️  WARNING: This loan is overdue and may be liquidated at any time!'));
        console.log(chalk.yellow('    Repay immediately to avoid losing your collateral.'));
      }
      
      if (options.dryRun) {
        console.log(chalk.yellow('\n🔶 DRY RUN - Transaction not executed'));
        console.log(chalk.gray(`Would repay ~${formatSOL(totalRepayment)} SOL to reclaim ${formatTokens(loan.collateralAmount)} tokens`));
        return;
      }
      
      // Execute repayment
      console.log(chalk.yellow('\n⏳ Repaying loan...'));
      
      const txSignature = await client.repayLoan(loanPubkey);
      
      console.log('');
      printSuccess('Loan repaid successfully!');
      printInfo('Transaction', txSignature);
      printTxLink(txSignature, options.network);
      
      console.log(chalk.green('\n🎉 Your collateral has been returned to your wallet!'));
      console.log(chalk.gray(`   ${formatTokens(loan.collateralAmount)} tokens returned`));
      console.log('');
      
    } catch (error: any) {
      printError(`Failed to repay loan: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();