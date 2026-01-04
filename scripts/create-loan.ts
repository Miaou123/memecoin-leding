#!/usr/bin/env tsx

/**
 * Create Loan CLI
 * 
 * Usage:
 *   pnpm --filter scripts create-loan --mint <TOKEN_MINT> --amount 10000 --duration 24h --network devnet
 *   pnpm --filter scripts create-loan --mint <TOKEN_MINT> --amount 10000 --duration 7d --keypair ./keys/borrower.json
 */

import { config } from 'dotenv';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { Command } from 'commander';
import BN from 'bn.js';
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
  parseDuration,
  formatDuration,
  formatTier
} from './cli-utils';

config();

const program = new Command();

program
  .name('create-loan')
  .description('Create a new loan by depositing collateral')
  .requiredOption('-m, --mint <address>', 'Token mint address for collateral')
  .requiredOption('-a, --amount <tokens>', 'Amount of tokens to use as collateral')
  .requiredOption('-d, --duration <time>', 'Loan duration (e.g., 12h, 24h, 7d)')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --keypair <path>', 'Path to borrower keypair', '../keys/admin.json')
  .option('--dry-run', 'Simulate the transaction without executing')
  .action(async (options) => {
    try {
      printHeader('💰 Create Loan');
      
      console.log(chalk.gray(`Network: ${options.network}`));
      console.log(chalk.gray(`Token Mint: ${options.mint}`));
      console.log(chalk.gray(`Amount: ${options.amount} tokens`));
      console.log(chalk.gray(`Duration: ${options.duration}\n`));
      
      const { client, keypair, connection } = await createClient(options.network, options.keypair);
      const mint = new PublicKey(options.mint);
      
      // Parse duration
      const durationSeconds = parseDuration(options.duration);
      
      // Validate minimum duration (12 hours)
      if (durationSeconds < 12 * 3600) {
        throw new Error('Minimum loan duration is 12 hours');
      }
      
      // Validate maximum duration (7 days)
      if (durationSeconds > 7 * 24 * 3600) {
        throw new Error('Maximum loan duration is 7 days');
      }
      
      console.log(chalk.blue('🔍 Checking prerequisites...\n'));
      
      // Check token config exists
      const tokenConfig = await client.getTokenConfig(mint);
      if (!tokenConfig) {
        throw new Error('Token is not whitelisted for lending');
      }
      
      if (!tokenConfig.enabled) {
        throw new Error('Token is currently disabled for lending');
      }
      
      printInfo('Token Tier', formatTier(tokenConfig.tier));
      printInfo('Base LTV', `${tokenConfig.ltvBps / 100}%`);
      
      // Get borrower's token account
      const borrowerTokenAccount = await getAssociatedTokenAddress(mint, keypair.publicKey);
      
      // Check token balance
      let tokenAccountInfo;
      try {
        tokenAccountInfo = await getAccount(connection, borrowerTokenAccount);
      } catch (e) {
        throw new Error(`You don't have a token account for this mint. Create one first.`);
      }
      
      // Calculate collateral amount (assuming 9 decimals)
      const decimals = 9; // TODO: fetch from mint
      const collateralAmount = new BN(parseFloat(options.amount) * Math.pow(10, decimals));
      
      if (BigInt(tokenAccountInfo.amount) < BigInt(collateralAmount.toString())) {
        throw new Error(
          `Insufficient token balance. ` +
          `Have: ${formatTokens(tokenAccountInfo.amount.toString())}, ` +
          `Need: ${formatTokens(collateralAmount.toString())}`
        );
      }
      
      printInfo('Your Token Balance', formatTokens(tokenAccountInfo.amount.toString()));
      printInfo('Collateral Amount', formatTokens(collateralAmount.toString()));
      
      // Check treasury has enough SOL
      const [treasuryPDA] = client.getTreasuryPDA();
      const treasuryBalance = await connection.getBalance(treasuryPDA);
      printInfo('Treasury Balance', `${formatSOL(treasuryBalance)} SOL`);
      
      // Estimate loan terms
      console.log(chalk.blue('\n📊 Estimating loan terms...\n'));
      
      try {
        const estimate = await client.estimateLoan({
          mint: mint.toString(),
          collateralAmount: collateralAmount.toString(),
          durationSeconds,
        });
        
        // Add import for getLtvModifierDisplay if not already imported
        const { getLtvModifierDisplay } = require('@memecoin-lending/sdk');
        
        printInfo('Duration Modifier', getLtvModifierDisplay(durationSeconds));
        printInfo('Effective LTV', `${(estimate.ltv || 0).toFixed(2)}%`);
        printInfo('Estimated SOL to Receive', `${formatSOL(estimate.solAmount)} SOL`);
        printInfo('Protocol Fee (2%)', `${formatSOL(estimate.protocolFee || 0)} SOL`);
        printInfo('Total Repayment', `${formatSOL(estimate.totalOwed)} SOL`);
        printInfo('Liquidation Price', `${estimate.liquidationPrice} lamports/token`);
        
      } catch (e: any) {
        console.log(chalk.yellow('Could not estimate terms (API not available). Proceeding...\n'));
      }
      
      if (options.dryRun) {
        console.log(chalk.yellow('\n🔶 DRY RUN - Transaction not executed'));
        return;
      }
      
      // Confirm
      console.log(chalk.yellow('\n⚠️  Creating loan...'));
      console.log(chalk.gray(`Borrower: ${keypair.publicKey.toString()}`));
      console.log(chalk.gray(`Duration: ${formatDuration(durationSeconds)}`));
      
      // Create the loan
      const txSignature = await client.createLoan({
        mint,
        collateralAmount,
        durationSeconds,
      });
      
      console.log('');
      printSuccess('Loan created successfully!');
      printInfo('Transaction', txSignature);
      printTxLink(txSignature, options.network);
      
      // Fetch the new loan to show details
      console.log(chalk.blue('\n📝 Loan Details:'));
      
      // Get the loan PDA (need to derive it)
      const protocolState = await client.getProtocolState();
      const loanIndex = new BN(protocolState.totalLoansCreated - 1);
      const [loanPDA] = client.getLoanPDA(keypair.publicKey, mint, loanIndex);
      
      printInfo('Loan PDA', loanPDA.toString());
      
      // Try to fetch the loan
      try {
        const loan = await client.getLoan(loanPDA);
        if (loan) {
          printInfo('SOL Borrowed', `${formatSOL(loan.solBorrowed)} SOL`);
          printInfo('Due Date', new Date(loan.dueAt * 1000).toLocaleString());
        }
      } catch (e) {
        console.log(chalk.gray('  (loan details will be available shortly)'));
      }
      
      console.log('');
      
    } catch (error: any) {
      printError(`Failed to create loan: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();