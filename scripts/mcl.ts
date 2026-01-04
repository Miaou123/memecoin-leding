#!/usr/bin/env tsx

/**
 * Memecoin Lending Protocol CLI
 * 
 * Unified command-line interface for all protocol operations.
 * 
 * Usage:
 *   pnpm --filter scripts mcl <command> [options]
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

program
  .name('mcl')
  .description(chalk.blue('🪙 Memecoin Lending Protocol CLI'))
  .version('1.0.0');

// Helper to run a script
function runScript(scriptName: string, args: string[]): void {
  const scriptPath = path.join(__dirname, `${scriptName}.ts`);
  const command = `npx tsx ${scriptPath} ${args.join(' ')}`;
  
  try {
    execSync(command, { stdio: 'inherit' });
  } catch (error: any) {
    process.exit(error.status || 1);
  }
}

// ============= VIEW COMMANDS =============

program
  .command('protocol-state')
  .alias('ps')
  .description('View protocol state and statistics')
  .option('-n, --network <network>', 'Network', 'devnet')
  .option('-k, --keypair <path>', 'Keypair path', './keys/admin.json')
  .action((opts) => {
    runScript('get-protocol-state', ['--network', opts.network, '--keypair', opts.keypair]);
  });

program
  .command('loans')
  .alias('ls')
  .description('View loans')
  .option('-n, --network <network>', 'Network', 'devnet')
  .option('-k, --keypair <path>', 'Keypair path', './keys/admin.json')
  .option('-b, --borrower <wallet>', 'Filter by borrower')
  .option('-l, --loan <pubkey>', 'Get specific loan')
  .option('-a, --active', 'Show only active loans')
  .option('--limit <number>', 'Limit results', '50')
  .action((opts) => {
    const args = ['--network', opts.network, '--keypair', opts.keypair];
    if (opts.borrower) args.push('--borrower', opts.borrower);
    if (opts.loan) args.push('--loan', opts.loan);
    if (opts.active) args.push('--active');
    if (opts.limit) args.push('--limit', opts.limit);
    runScript('get-loans', args);
  });

program
  .command('tokens')
  .alias('tk')
  .description('View whitelisted tokens')
  .option('-n, --network <network>', 'Network', 'devnet')
  .option('-k, --keypair <path>', 'Keypair path', './keys/admin.json')
  .option('-m, --mint <address>', 'Get specific token')
  .action((opts) => {
    const args = ['--network', opts.network, '--keypair', opts.keypair];
    if (opts.mint) args.push('--mint', opts.mint);
    runScript('get-token-configs', args);
  });

// ============= LOAN OPERATIONS =============

program
  .command('create-loan')
  .alias('cl')
  .description('Create a new loan')
  .requiredOption('-m, --mint <address>', 'Token mint address')
  .requiredOption('-a, --amount <tokens>', 'Collateral amount')
  .requiredOption('-d, --duration <time>', 'Duration (e.g., 24h, 7d)')
  .option('-n, --network <network>', 'Network', 'devnet')
  .option('-k, --keypair <path>', 'Borrower keypair', './keys/admin.json')
  .option('--dry-run', 'Simulate only')
  .action((opts) => {
    const args = [
      '--mint', opts.mint,
      '--amount', opts.amount,
      '--duration', opts.duration,
      '--network', opts.network,
      '--keypair', opts.keypair,
    ];
    if (opts.dryRun) args.push('--dry-run');
    runScript('create-loan', args);
  });

program
  .command('repay-loan')
  .alias('rl')
  .description('Repay a loan')
  .requiredOption('-l, --loan <pubkey>', 'Loan pubkey')
  .option('-n, --network <network>', 'Network', 'devnet')
  .option('-k, --keypair <path>', 'Borrower keypair', './keys/admin.json')
  .option('--dry-run', 'Simulate only')
  .action((opts) => {
    const args = ['--loan', opts.loan, '--network', opts.network, '--keypair', opts.keypair];
    if (opts.dryRun) args.push('--dry-run');
    runScript('repay-loan', args);
  });

program
  .command('liquidate')
  .alias('liq')
  .description('Liquidate a loan or find liquidatable loans')
  .option('-l, --loan <pubkey>', 'Loan pubkey to liquidate')
  .option('-n, --network <network>', 'Network', 'devnet')
  .option('-k, --keypair <path>', 'Liquidator keypair', './keys/admin.json')
  .option('--find-liquidatable', 'Find all liquidatable loans')
  .option('--dry-run', 'Simulate only')
  .action((opts) => {
    const args = ['--network', opts.network, '--keypair', opts.keypair];
    if (opts.loan) args.push('--loan', opts.loan);
    if (opts.findLiquidatable) args.push('--find-liquidatable');
    if (opts.dryRun) args.push('--dry-run');
    runScript('liquidate-loan', args);
  });

// ============= ADMIN COMMANDS =============

program
  .command('pause')
  .description('Pause the protocol (admin)')
  .option('-n, --network <network>', 'Network', 'devnet')
  .option('-k, --keypair <path>', 'Admin keypair', './keys/admin.json')
  .action((opts) => {
    runScript('pause-protocol', ['--network', opts.network, '--keypair', opts.keypair]);
  });

program
  .command('resume')
  .description('Resume the protocol (admin)')
  .option('-n, --network <network>', 'Network', 'devnet')
  .option('-k, --keypair <path>', 'Admin keypair', './keys/admin.json')
  .action((opts) => {
    runScript('resume-protocol', ['--network', opts.network, '--keypair', opts.keypair]);
  });

program
  .command('update-fees')
  .description('Update fee configuration (admin)')
  .option('-n, --network <network>', 'Network', 'devnet')
  .option('-k, --keypair <path>', 'Admin keypair', './keys/admin.json')
  .option('--protocol <bps>', 'Protocol fee (bps)')
  .option('--treasury <bps>', 'Treasury fee (bps)')
  .option('--buyback <bps>', 'Buyback fee (bps)')
  .option('--operations <bps>', 'Operations fee (bps)')
  .option('--dry-run', 'Simulate only')
  .action((opts) => {
    const args = ['--network', opts.network, '--keypair', opts.keypair];
    if (opts.protocol) args.push('--protocol', opts.protocol);
    if (opts.treasury) args.push('--treasury', opts.treasury);
    if (opts.buyback) args.push('--buyback', opts.buyback);
    if (opts.operations) args.push('--operations', opts.operations);
    if (opts.dryRun) args.push('--dry-run');
    runScript('update-fees', args);
  });

program
  .command('update-token')
  .description('Update token configuration (admin)')
  .requiredOption('-m, --mint <address>', 'Token mint')
  .option('-n, --network <network>', 'Network', 'devnet')
  .option('-k, --keypair <path>', 'Admin keypair', './keys/admin.json')
  .option('--ltv <bps>', 'New LTV (bps)')
  .option('--interest <bps>', 'New interest rate (bps)')
  .option('--enable', 'Enable token')
  .option('--disable', 'Disable token')
  .option('--dry-run', 'Simulate only')
  .action((opts) => {
    const args = ['--mint', opts.mint, '--network', opts.network, '--keypair', opts.keypair];
    if (opts.ltv) args.push('--ltv', opts.ltv);
    if (opts.interest) args.push('--interest', opts.interest);
    if (opts.enable) args.push('--enable');
    if (opts.disable) args.push('--disable');
    if (opts.dryRun) args.push('--dry-run');
    runScript('update-token-config', args);
  });

program
  .command('withdraw')
  .description('Withdraw from treasury (admin)')
  .requiredOption('-a, --amount <sol>', 'Amount in SOL')
  .option('-n, --network <network>', 'Network', 'devnet')
  .option('-k, --keypair <path>', 'Admin keypair', './keys/admin.json')
  .option('--dry-run', 'Simulate only')
  .action((opts) => {
    const args = ['--amount', opts.amount, '--network', opts.network, '--keypair', opts.keypair];
    if (opts.dryRun) args.push('--dry-run');
    runScript('withdraw-treasury', args);
  });

program
  .command('fund')
  .description('Fund the treasury')
  .requiredOption('-a, --amount <sol>', 'Amount in SOL')
  .option('-n, --network <network>', 'Network', 'devnet')
  .option('-k, --keypair <path>', 'Funder keypair', './keys/admin.json')
  .action((opts) => {
    runScript('fund-treasury', ['--amount', opts.amount, '--network', opts.network, '--admin-keypair', opts.keypair]);
  });

// Help with examples
program.on('--help', () => {
  console.log('');
  console.log(chalk.blue('Examples:'));
  console.log('');
  console.log(chalk.gray('  # View protocol state'));
  console.log('  $ pnpm --filter scripts mcl protocol-state --network devnet');
  console.log('');
  console.log(chalk.gray('  # List active loans'));
  console.log('  $ pnpm --filter scripts mcl loans --active --network devnet');
  console.log('');
  console.log(chalk.gray('  # Create a loan'));
  console.log('  $ pnpm --filter scripts mcl create-loan --mint <MINT> --amount 10000 --duration 24h');
  console.log('');
  console.log(chalk.gray('  # Repay a loan'));
  console.log('  $ pnpm --filter scripts mcl repay-loan --loan <LOAN_PDA>');
  console.log('');
  console.log(chalk.gray('  # Find liquidatable loans'));
  console.log('  $ pnpm --filter scripts mcl liquidate --find-liquidatable');
  console.log('');
  console.log(chalk.gray('  # Fund treasury'));
  console.log('  $ pnpm --filter scripts mcl fund --amount 100');
  console.log('');
});

// If no command, show help
if (process.argv.length === 2) {
  program.outputHelp();
}

program.parse();