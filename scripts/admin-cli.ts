#!/usr/bin/env tsx

/**
 * Memecoin Lending Protocol - Interactive Admin CLI
 * 
 * A full interactive menu-based CLI for managing all protocol operations.
 * 
 * Usage:
 *   npx tsx scripts/admin-cli.ts
 *   pnpm --filter scripts admin
 */

import { config } from 'dotenv';
import { execSync, spawn } from 'child_process';
import * as readline from 'readline';
import chalk from 'chalk';
import path from 'path';
import { fileURLToPath } from 'url';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

interface CLIConfig {
  network: string;
  keypair: string;
}

let globalConfig: CLIConfig = {
  network: 'devnet',
  keypair: './keys/admin.json',
};

// ═══════════════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════════════

function clearScreen(): void {
  console.clear();
}

function printBanner(): void {
  console.log(chalk.cyan.bold(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                                                                               ║
║   🪙  MEMECOIN LENDING PROTOCOL - ADMIN CLI                                   ║
║                                                                               ║
║   Network: ${chalk.yellow(globalConfig.network.padEnd(12))}  Keypair: ${chalk.gray(globalConfig.keypair.slice(0, 25))}...       ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`));
}

function printHeader(title: string): void {
  console.log(chalk.blue.bold('\n' + '═'.repeat(60)));
  console.log(chalk.blue.bold(`  ${title}`));
  console.log(chalk.blue.bold('═'.repeat(60) + '\n'));
}

function printMenu(title: string, options: { key: string; label: string; desc?: string }[]): void {
  console.log(chalk.yellow.bold(`\n  ${title}\n`));
  for (const opt of options) {
    const keyPart = chalk.cyan.bold(`  [${opt.key}]`);
    const labelPart = chalk.white(` ${opt.label}`);
    const descPart = opt.desc ? chalk.gray(` - ${opt.desc}`) : '';
    console.log(`${keyPart}${labelPart}${descPart}`);
  }
  console.log(chalk.gray('\n  [b] Back  [q] Quit\n'));
}

function waitForKey(): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(chalk.cyan('  ➤ Enter choice: '), (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function prompt(question: string, defaultValue?: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const defaultStr = defaultValue ? chalk.gray(` [${defaultValue}]`) : '';
    rl.question(chalk.cyan(`  ${question}${defaultStr}: `), (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function confirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(chalk.yellow(`  ⚠️  ${question} (y/n): `), (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

function pressEnterToContinue(): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(chalk.gray('\n  Press Enter to continue...'), () => {
      rl.close();
      resolve();
    });
  });
}

function runScript(scriptName: string, args: string[] = []): void {
  const scriptPath = path.join(__dirname, `${scriptName}.ts`);
  const command = `npx tsx ${scriptPath} ${args.join(' ')}`;
  
  console.log(chalk.gray(`\n  Running: ${scriptName} ${args.join(' ')}\n`));
  console.log(chalk.blue('─'.repeat(60)));
  
  try {
    execSync(command, { stdio: 'inherit', cwd: __dirname });
  } catch (error: any) {
    // Script already printed its error
  }
  
  console.log(chalk.blue('─'.repeat(60)));
}

function runShellScript(scriptPath: string, args: string[] = []): void {
  console.log(chalk.gray(`\n  Running: ${scriptPath} ${args.join(' ')}\n`));
  console.log(chalk.blue('─'.repeat(60)));
  
  try {
    execSync(`bash ${scriptPath} ${args.join(' ')}`, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  } catch (error: any) {
    // Script already printed its error
  }
  
  console.log(chalk.blue('─'.repeat(60)));
}

// ═══════════════════════════════════════════════════════════════════════════
// Menu Handlers
// ═══════════════════════════════════════════════════════════════════════════

async function viewMenu(): Promise<void> {
  while (true) {
    clearScreen();
    printBanner();
    printMenu('📊 VIEW & QUERY', [
      { key: '1', label: 'Protocol State', desc: 'View protocol stats, treasury, fees' },
      { key: '2', label: 'All Loans', desc: 'List all loans in the protocol' },
      { key: '3', label: 'Active Loans', desc: 'Show only active loans' },
      { key: '4', label: 'Loans by Borrower', desc: 'Filter loans by wallet address' },
      { key: '5', label: 'Specific Loan', desc: 'View details of a specific loan' },
      { key: '6', label: 'Whitelisted Tokens', desc: 'View all token configurations' },
      { key: '7', label: 'Specific Token', desc: 'View a specific token config' },
      { key: '8', label: 'Deployment Status', desc: 'Check deployment initialization status' },
    ]);

    const choice = await waitForKey();

    switch (choice) {
      case '1':
        runScript('get-protocol-state', ['--network', globalConfig.network, '--keypair', globalConfig.keypair]);
        await pressEnterToContinue();
        break;
      case '2':
        runScript('get-loans', ['--network', globalConfig.network, '--keypair', globalConfig.keypair]);
        await pressEnterToContinue();
        break;
      case '3':
        runScript('get-loans', ['--network', globalConfig.network, '--keypair', globalConfig.keypair, '--active']);
        await pressEnterToContinue();
        break;
      case '4': {
        const borrower = await prompt('Enter borrower wallet address');
        if (borrower) {
          runScript('get-loans', ['--network', globalConfig.network, '--keypair', globalConfig.keypair, '--borrower', borrower]);
        }
        await pressEnterToContinue();
        break;
      }
      case '5': {
        const loan = await prompt('Enter loan pubkey');
        if (loan) {
          runScript('get-loans', ['--network', globalConfig.network, '--keypair', globalConfig.keypair, '--loan', loan]);
        }
        await pressEnterToContinue();
        break;
      }
      case '6':
        runScript('get-token-configs', ['--network', globalConfig.network, '--keypair', globalConfig.keypair]);
        await pressEnterToContinue();
        break;
      case '7': {
        const mint = await prompt('Enter token mint address');
        if (mint) {
          runScript('get-token-configs', ['--network', globalConfig.network, '--keypair', globalConfig.keypair, '--mint', mint]);
        }
        await pressEnterToContinue();
        break;
      }
      case '8':
        runScript('deployment-status', ['--network', globalConfig.network, '--verbose']);
        await pressEnterToContinue();
        break;
      case 'b':
        return;
      case 'q':
        process.exit(0);
    }
  }
}

async function loansMenu(): Promise<void> {
  while (true) {
    clearScreen();
    printBanner();
    printMenu('💰 LOAN OPERATIONS', [
      { key: '1', label: 'Create Loan', desc: 'Create a new loan with collateral' },
      { key: '2', label: 'Repay Loan', desc: 'Repay an existing loan' },
      { key: '3', label: 'Find Liquidatable', desc: 'Scan for loans ready to liquidate' },
      { key: '4', label: 'Liquidate Loan', desc: 'Execute liquidation on a specific loan' },
      { key: '5', label: 'Estimate Loan', desc: 'Estimate loan terms before creating' },
    ]);

    const choice = await waitForKey();

    switch (choice) {
      case '1': {
        console.log(chalk.yellow('\n  📝 Create New Loan\n'));
        const mint = await prompt('Token mint address');
        const amount = await prompt('Collateral amount (tokens)');
        const duration = await prompt('Duration (e.g., 12h, 24h, 7d)', '24h');
        const dryRun = await confirm('Dry run first (simulate)?');
        
        if (mint && amount) {
          const args = [
            '--mint', mint,
            '--amount', amount,
            '--duration', duration,
            '--network', globalConfig.network,
            '--keypair', globalConfig.keypair,
          ];
          if (dryRun) args.push('--dry-run');
          runScript('create-loan', args);
        }
        await pressEnterToContinue();
        break;
      }
      case '2': {
        console.log(chalk.yellow('\n  💵 Repay Loan\n'));
        const loan = await prompt('Loan pubkey');
        const dryRun = await confirm('Dry run first (simulate)?');
        
        if (loan) {
          const args = [
            '--loan', loan,
            '--network', globalConfig.network,
            '--keypair', globalConfig.keypair,
          ];
          if (dryRun) args.push('--dry-run');
          runScript('repay-loan', args);
        }
        await pressEnterToContinue();
        break;
      }
      case '3':
        runScript('liquidate-loan', ['--find-liquidatable', '--network', globalConfig.network, '--keypair', globalConfig.keypair]);
        await pressEnterToContinue();
        break;
      case '4': {
        console.log(chalk.yellow('\n  ⚡ Liquidate Loan\n'));
        const loan = await prompt('Loan pubkey to liquidate');
        const dryRun = await confirm('Dry run first (simulate)?');
        
        if (loan) {
          const args = [
            '--loan', loan,
            '--network', globalConfig.network,
            '--keypair', globalConfig.keypair,
          ];
          if (dryRun) args.push('--dry-run');
          runScript('liquidate-loan', args);
        }
        await pressEnterToContinue();
        break;
      }
      case '5': {
        console.log(chalk.yellow('\n  📊 Estimate Loan Terms\n'));
        const mint = await prompt('Token mint address');
        const amount = await prompt('Collateral amount (tokens)');
        const duration = await prompt('Duration (e.g., 12h, 24h, 7d)', '24h');
        
        if (mint && amount) {
          runScript('create-loan', [
            '--mint', mint,
            '--amount', amount,
            '--duration', duration,
            '--network', globalConfig.network,
            '--keypair', globalConfig.keypair,
            '--dry-run',
          ]);
        }
        await pressEnterToContinue();
        break;
      }
      case 'b':
        return;
      case 'q':
        process.exit(0);
    }
  }
}

async function adminMenu(): Promise<void> {
  while (true) {
    clearScreen();
    printBanner();
    printMenu('🔐 ADMIN CONTROLS', [
      { key: '1', label: 'Pause Protocol', desc: 'Emergency pause - stops new loans' },
      { key: '2', label: 'Resume Protocol', desc: 'Resume normal operations' },
      { key: '3', label: 'Update Fees', desc: 'Modify protocol fee configuration' },
      { key: '4', label: 'Update Token Config', desc: 'Modify token LTV, enable/disable' },
      { key: '5', label: 'Update Wallets', desc: 'Change admin/buyback/operations wallets' },
    ]);

    const choice = await waitForKey();

    switch (choice) {
      case '1': {
        const confirmed = await confirm('Are you sure you want to PAUSE the protocol?');
        if (confirmed) {
          runScript('pause-protocol', ['--network', globalConfig.network, '--keypair', globalConfig.keypair]);
        }
        await pressEnterToContinue();
        break;
      }
      case '2': {
        const confirmed = await confirm('Are you sure you want to RESUME the protocol?');
        if (confirmed) {
          runScript('resume-protocol', ['--network', globalConfig.network, '--keypair', globalConfig.keypair]);
        }
        await pressEnterToContinue();
        break;
      }
      case '3': {
        console.log(chalk.yellow('\n  💸 Update Fees\n'));
        console.log(chalk.gray('  Leave blank to keep current value\n'));
        
        const protocolFee = await prompt('Protocol fee (bps, e.g., 200 = 2%)');
        const treasuryFee = await prompt('Treasury fee for liquidations (bps)');
        const buybackFee = await prompt('Buyback fee for liquidations (bps)');
        const operationsFee = await prompt('Operations fee for liquidations (bps)');
        const dryRun = await confirm('Dry run first?');
        
        const args = ['--network', globalConfig.network, '--keypair', globalConfig.keypair];
        if (protocolFee) args.push('--protocol', protocolFee);
        if (treasuryFee) args.push('--treasury', treasuryFee);
        if (buybackFee) args.push('--buyback', buybackFee);
        if (operationsFee) args.push('--operations', operationsFee);
        if (dryRun) args.push('--dry-run');
        
        if (protocolFee || treasuryFee || buybackFee || operationsFee) {
          runScript('update-fees', args);
        } else {
          console.log(chalk.yellow('\n  No changes specified.'));
        }
        await pressEnterToContinue();
        break;
      }
      case '4': {
        console.log(chalk.yellow('\n  🏷️  Update Token Config\n'));
        
        const mint = await prompt('Token mint address');
        if (!mint) {
          await pressEnterToContinue();
          break;
        }
        
        console.log(chalk.gray('  Leave blank to keep current value\n'));
        const ltv = await prompt('New LTV (bps, e.g., 5000 = 50%)');
        const enableDisable = await prompt('Enable/Disable (e/d/blank)');
        const dryRun = await confirm('Dry run first?');
        
        const args = ['--mint', mint, '--network', globalConfig.network, '--keypair', globalConfig.keypair];
        if (ltv) args.push('--ltv', ltv);
        if (enableDisable === 'e') args.push('--enable');
        if (enableDisable === 'd') args.push('--disable');
        if (dryRun) args.push('--dry-run');
        
        runScript('update-token-config', args);
        await pressEnterToContinue();
        break;
      }
      case '5': {
        console.log(chalk.yellow('\n  👤 Update Wallets\n'));
        console.log(chalk.red('  ⚠️  Be very careful! Changing admin will transfer control.\n'));
        
        const newAdmin = await prompt('New admin wallet (leave blank to skip)');
        const newBuyback = await prompt('New buyback wallet (leave blank to skip)');
        const newOperations = await prompt('New operations wallet (leave blank to skip)');
        
        if (newAdmin || newBuyback || newOperations) {
          const confirmed = await confirm('Are you sure you want to update these wallets?');
          if (confirmed) {
            // This would need a custom script - leaving as placeholder
            console.log(chalk.yellow('\n  Note: Use update-wallets.ts script directly for this operation.'));
          }
        }
        await pressEnterToContinue();
        break;
      }
      case 'b':
        return;
      case 'q':
        process.exit(0);
    }
  }
}

async function tokensMenu(): Promise<void> {
  while (true) {
    clearScreen();
    printBanner();
    printMenu('🪙 TOKEN MANAGEMENT', [
      { key: '1', label: 'View All Tokens', desc: 'List all whitelisted tokens' },
      { key: '2', label: 'Whitelist Token', desc: 'Add a new token to the protocol' },
      { key: '3', label: 'Update Token', desc: 'Modify token configuration' },
      { key: '4', label: 'Enable Token', desc: 'Enable a disabled token' },
      { key: '5', label: 'Disable Token', desc: 'Disable a token (no new loans)' },
    ]);

    const choice = await waitForKey();

    switch (choice) {
      case '1':
        runScript('get-token-configs', ['--network', globalConfig.network, '--keypair', globalConfig.keypair]);
        await pressEnterToContinue();
        break;
      case '2': {
        console.log(chalk.yellow('\n  ➕ Whitelist New Token\n'));
        
        const mint = await prompt('Token mint address');
        if (!mint) {
          await pressEnterToContinue();
          break;
        }
        
        console.log(chalk.gray('\n  Tiers: bronze (25% LTV), silver (35% LTV), gold (50% LTV)\n'));
        const tier = await prompt('Token tier (bronze/silver/gold)', 'bronze');
        const pool = await prompt('Pool address (for price feeds)', mint);
        const poolType = await prompt('Pool type (pumpfun/pumpswap/raydium/orca)', 'pumpfun');
        const isProtocolToken = await confirm('Is this the protocol token (always 50% LTV)?');
        
        const args = [
          '--mint', mint,
          '--tier', tier,
          '--pool', pool,
          '--pool-type', poolType,
          '--network', globalConfig.network,
          '--admin-keypair', globalConfig.keypair,
        ];
        if (isProtocolToken) args.push('--protocol-token');
        
        runScript('whitelist-token', args);
        await pressEnterToContinue();
        break;
      }
      case '3': {
        console.log(chalk.yellow('\n  ✏️  Update Token Config\n'));
        
        const mint = await prompt('Token mint address');
        if (!mint) {
          await pressEnterToContinue();
          break;
        }
        
        const ltv = await prompt('New LTV (bps, e.g., 5000 = 50%)');
        const dryRun = await confirm('Dry run first?');
        
        const args = ['--mint', mint, '--network', globalConfig.network, '--keypair', globalConfig.keypair];
        if (ltv) args.push('--ltv', ltv);
        if (dryRun) args.push('--dry-run');
        
        runScript('update-token-config', args);
        await pressEnterToContinue();
        break;
      }
      case '4': {
        const mint = await prompt('Token mint address to ENABLE');
        if (mint) {
          runScript('update-token-config', ['--mint', mint, '--enable', '--network', globalConfig.network, '--keypair', globalConfig.keypair]);
        }
        await pressEnterToContinue();
        break;
      }
      case '5': {
        const mint = await prompt('Token mint address to DISABLE');
        if (mint) {
          const confirmed = await confirm('Are you sure? Users won\'t be able to create new loans with this token.');
          if (confirmed) {
            runScript('update-token-config', ['--mint', mint, '--disable', '--network', globalConfig.network, '--keypair', globalConfig.keypair]);
          }
        }
        await pressEnterToContinue();
        break;
      }
      case 'b':
        return;
      case 'q':
        process.exit(0);
    }
  }
}

async function treasuryMenu(): Promise<void> {
  while (true) {
    clearScreen();
    printBanner();
    printMenu('🏦 TREASURY OPERATIONS', [
      { key: '1', label: 'View Treasury', desc: 'Check treasury balance and stats' },
      { key: '2', label: 'Fund Treasury', desc: 'Add SOL to the treasury' },
      { key: '3', label: 'Withdraw Treasury', desc: 'Withdraw SOL from treasury (admin)' },
    ]);

    const choice = await waitForKey();

    switch (choice) {
      case '1':
        runScript('get-protocol-state', ['--network', globalConfig.network, '--keypair', globalConfig.keypair]);
        await pressEnterToContinue();
        break;
      case '2': {
        console.log(chalk.yellow('\n  💰 Fund Treasury\n'));
        
        const amount = await prompt('Amount of SOL to fund');
        if (!amount) {
          await pressEnterToContinue();
          break;
        }
        
        const confirmed = await confirm(`Fund treasury with ${amount} SOL?`);
        if (confirmed) {
          runScript('fund-treasury', ['--amount', amount, '--network', globalConfig.network, '--admin-keypair', globalConfig.keypair]);
        }
        await pressEnterToContinue();
        break;
      }
      case '3': {
        console.log(chalk.yellow('\n  💸 Withdraw from Treasury\n'));
        console.log(chalk.red('  ⚠️  This withdraws SOL from the protocol treasury!\n'));
        
        const amount = await prompt('Amount of SOL to withdraw');
        if (!amount) {
          await pressEnterToContinue();
          break;
        }
        
        const dryRun = await confirm('Dry run first?');
        
        const args = ['--amount', amount, '--network', globalConfig.network, '--keypair', globalConfig.keypair];
        if (dryRun) args.push('--dry-run');
        
        if (!dryRun) {
          const confirmed = await confirm(`CONFIRM: Withdraw ${amount} SOL from treasury?`);
          if (!confirmed) {
            await pressEnterToContinue();
            break;
          }
        }
        
        runScript('withdraw-treasury', args);
        await pressEnterToContinue();
        break;
      }
      case 'b':
        return;
      case 'q':
        process.exit(0);
    }
  }
}

async function stakingMenu(): Promise<void> {
  while (true) {
    clearScreen();
    printBanner();
    printMenu('🥩 STAKING & FEES', [
      { key: '1', label: 'Initialize Staking', desc: 'Setup staking pool (required for loans)' },
      { key: '2', label: 'Initialize Fee Receiver', desc: 'Setup fee distribution (40/40/20)' },
      { key: '3', label: 'View Staking Status', desc: 'Check staking pool configuration' },
      { key: '4', label: 'Update Protocol Fee', desc: 'Set protocol fee percentage' },
    ]);

    const choice = await waitForKey();

    switch (choice) {
      case '1': {
        console.log(chalk.yellow('\n  🥩 Initialize Staking Pool\n'));
        console.log(chalk.red('  ⚠️  This is required before loan repayments can work!\n'));
        
        const tokenMint = await prompt('Governance token mint address');
        if (!tokenMint) {
          await pressEnterToContinue();
          break;
        }
        
        const targetBalance = await prompt('Target pool balance in SOL', '50');
        const baseRate = await prompt('Base emission rate (lamports/sec)', '1000000');
        const maxRate = await prompt('Max emission rate (lamports/sec)', '10000000');
        const minRate = await prompt('Min emission rate (lamports/sec)', '100000');
        
        runScript('initialize-staking', [
          '--network', globalConfig.network,
          '--token-mint', tokenMint,
          '--target-balance', targetBalance,
          '--base-rate', baseRate,
          '--max-rate', maxRate,
          '--min-rate', minRate,
        ]);
        await pressEnterToContinue();
        break;
      }
      case '2': {
        console.log(chalk.yellow('\n  💸 Initialize Fee Receiver\n'));
        
        const treasurySplit = await prompt('Treasury split (bps)', '4000');
        const stakingSplit = await prompt('Staking split (bps)', '4000');
        const operationsSplit = await prompt('Operations split (bps)', '2000');
        
        const total = parseInt(treasurySplit) + parseInt(stakingSplit) + parseInt(operationsSplit);
        if (total !== 10000) {
          console.log(chalk.red(`\n  ❌ Splits must sum to 10000 (100%). Got: ${total}`));
          await pressEnterToContinue();
          break;
        }
        
        runScript('initialize-fee-receiver', [
          '--network', globalConfig.network,
          '--admin-keypair', globalConfig.keypair,
          '--treasury-split', treasurySplit,
          '--staking-split', stakingSplit,
          '--operations-split', operationsSplit,
        ]);
        await pressEnterToContinue();
        break;
      }
      case '3':
        // Show protocol state which includes staking info
        runScript('get-protocol-state', ['--network', globalConfig.network, '--keypair', globalConfig.keypair]);
        await pressEnterToContinue();
        break;
      case '4': {
        console.log(chalk.yellow('\n  💸 Update Protocol Fee\n'));
        
        const protocolFee = await prompt('New protocol fee (bps, e.g., 200 = 2%)');
        if (!protocolFee) {
          await pressEnterToContinue();
          break;
        }
        
        runScript('update-fees', ['--protocol', protocolFee, '--network', globalConfig.network, '--keypair', globalConfig.keypair]);
        await pressEnterToContinue();
        break;
      }
      case 'b':
        return;
      case 'q':
        process.exit(0);
    }
  }
}

async function deploymentMenu(): Promise<void> {
  while (true) {
    clearScreen();
    printBanner();
    printMenu('🚀 DEPLOYMENT', [
      { key: '1', label: 'Full Deploy', desc: 'Complete deployment pipeline' },
      { key: '2', label: 'Fresh Deploy', desc: 'Deploy with new program ID' },
      { key: '3', label: 'Deployment Status', desc: 'Check what\'s initialized' },
      { key: '4', label: 'Initialize All', desc: 'Run all initialization steps' },
    ]);

    const choice = await waitForKey();

    switch (choice) {
      case '1': {
        console.log(chalk.yellow('\n  🚀 Full Deployment\n'));
        
        const fundAmount = await prompt('Treasury fund amount (SOL)', '0.5');
        const stakingToken = await prompt('Staking token mint (optional)');
        
        const args = ['--network', globalConfig.network, '--fund', fundAmount];
        if (stakingToken) args.push('--staking-token', stakingToken);
        
        const confirmed = await confirm(`Deploy to ${globalConfig.network}?`);
        if (confirmed) {
          runScript('deploy-full', args);
        }
        await pressEnterToContinue();
        break;
      }
      case '2': {
        console.log(chalk.yellow('\n  🆕 Fresh Deployment\n'));
        console.log(chalk.red('  ⚠️  This will create a new program ID and reset all state!\n'));
        
        const confirmed = await confirm('Are you sure you want a FRESH deployment?');
        if (confirmed) {
          runShellScript('scripts/deploy-fresh.sh');
        }
        await pressEnterToContinue();
        break;
      }
      case '3':
        runScript('deployment-status', ['--network', globalConfig.network, '--verbose']);
        await pressEnterToContinue();
        break;
      case '4': {
        console.log(chalk.yellow('\n  ⚙️  Initialize All Components\n'));
        
        const stakingToken = await prompt('Staking token mint (required for staking init)');
        
        console.log(chalk.blue('\n  Running initialization sequence...\n'));
        
        // Initialize staking if token provided
        if (stakingToken) {
          console.log(chalk.gray('\n  1. Initializing staking pool...'));
          runScript('initialize-staking', [
            '--network', globalConfig.network,
            '--token-mint', stakingToken,
          ]);
        }
        
        // Initialize fee receiver
        console.log(chalk.gray('\n  2. Initializing fee receiver...'));
        runScript('initialize-fee-receiver', ['--network', globalConfig.network, '--admin-keypair', globalConfig.keypair]);
        
        // Set protocol fee to 2%
        console.log(chalk.gray('\n  3. Setting protocol fee to 2%...'));
        runScript('update-fees', ['--protocol', '200', '--network', globalConfig.network, '--keypair', globalConfig.keypair]);
        
        await pressEnterToContinue();
        break;
      }
      case 'b':
        return;
      case 'q':
        process.exit(0);
    }
  }
}

async function testsMenu(): Promise<void> {
  while (true) {
    clearScreen();
    printBanner();
    printMenu('🧪 TESTING', [
      { key: '1', label: 'Smoke Tests', desc: 'Quick validation tests' },
      { key: '2', label: 'Integration Tests', desc: 'Full devnet integration tests' },
      { key: '3', label: 'Anchor Tests', desc: 'Run anchor test suite' },
      { key: '4', label: 'Specific Test Category', desc: 'Run tests for specific category' },
    ]);

    const choice = await waitForKey();

    switch (choice) {
      case '1': {
        const verbose = await confirm('Verbose output?');
        const args = ['--network', globalConfig.network];
        if (verbose) args.push('--verbose');
        runShellScript('tests/smoke-test.sh', args);
        await pressEnterToContinue();
        break;
      }
      case '2': {
        const verbose = await confirm('Verbose output?');
        const args = ['--network', globalConfig.network];
        if (verbose) args.push('--verbose');
        runScript('devnet-integration-tests', args);
        await pressEnterToContinue();
        break;
      }
      case '3': {
        console.log(chalk.yellow('\n  Running anchor tests...\n'));
        try {
          execSync('anchor test', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
        } catch (error) {
          // Test output already shown
        }
        await pressEnterToContinue();
        break;
      }
      case '4': {
        console.log(chalk.gray('\n  Categories: protocol, admin, treasury, tokens, loans, staking, security, view, liquidation\n'));
        const category = await prompt('Test category');
        if (category) {
          runScript('devnet-integration-tests', ['--network', globalConfig.network, '--test-only', category]);
        }
        await pressEnterToContinue();
        break;
      }
      case 'b':
        return;
      case 'q':
        process.exit(0);
    }
  }
}

async function settingsMenu(): Promise<void> {
  while (true) {
    clearScreen();
    printBanner();
    
    console.log(chalk.yellow.bold('\n  ⚙️  SETTINGS\n'));
    console.log(chalk.white(`  Current Network: ${chalk.cyan(globalConfig.network)}`));
    console.log(chalk.white(`  Current Keypair: ${chalk.cyan(globalConfig.keypair)}`));
    
    printMenu('', [
      { key: '1', label: 'Change Network', desc: 'Switch between devnet/mainnet/localnet' },
      { key: '2', label: 'Change Keypair', desc: 'Set a different admin keypair path' },
    ]);

    const choice = await waitForKey();

    switch (choice) {
      case '1': {
        console.log(chalk.gray('\n  Available: devnet, mainnet, localnet\n'));
        const network = await prompt('Network', globalConfig.network);
        if (['devnet', 'mainnet', 'localnet', 'localhost'].includes(network)) {
          globalConfig.network = network;
          console.log(chalk.green(`\n  ✅ Network changed to: ${network}`));
        } else {
          console.log(chalk.red('\n  ❌ Invalid network'));
        }
        await pressEnterToContinue();
        break;
      }
      case '2': {
        const keypair = await prompt('Keypair path', globalConfig.keypair);
        globalConfig.keypair = keypair;
        console.log(chalk.green(`\n  ✅ Keypair changed to: ${keypair}`));
        await pressEnterToContinue();
        break;
      }
      case 'b':
        return;
      case 'q':
        process.exit(0);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Menu
// ═══════════════════════════════════════════════════════════════════════════

async function mainMenu(): Promise<void> {
  while (true) {
    clearScreen();
    printBanner();
    
    console.log(chalk.yellow.bold('  MAIN MENU\n'));
    console.log(chalk.cyan.bold('  [1]') + chalk.white(' 📊 View & Query') + chalk.gray('      - Protocol state, loans, tokens'));
    console.log(chalk.cyan.bold('  [2]') + chalk.white(' 💰 Loan Operations') + chalk.gray('  - Create, repay, liquidate'));
    console.log(chalk.cyan.bold('  [3]') + chalk.white(' 🔐 Admin Controls') + chalk.gray('   - Pause, resume, update fees'));
    console.log(chalk.cyan.bold('  [4]') + chalk.white(' 🪙 Token Management') + chalk.gray(' - Whitelist, configure tokens'));
    console.log(chalk.cyan.bold('  [5]') + chalk.white(' 🏦 Treasury') + chalk.gray('         - Fund, withdraw, view balance'));
    console.log(chalk.cyan.bold('  [6]') + chalk.white(' 🥩 Staking & Fees') + chalk.gray('   - Initialize, configure'));
    console.log(chalk.cyan.bold('  [7]') + chalk.white(' 🚀 Deployment') + chalk.gray('       - Deploy, initialize protocol'));
    console.log(chalk.cyan.bold('  [8]') + chalk.white(' 🧪 Testing') + chalk.gray('          - Smoke tests, integration tests'));
    console.log(chalk.cyan.bold('  [9]') + chalk.white(' ⚙️  Settings') + chalk.gray('         - Network, keypair configuration'));
    console.log('');
    console.log(chalk.gray('  [q] Quit'));
    console.log('');

    const choice = await waitForKey();

    switch (choice) {
      case '1':
        await viewMenu();
        break;
      case '2':
        await loansMenu();
        break;
      case '3':
        await adminMenu();
        break;
      case '4':
        await tokensMenu();
        break;
      case '5':
        await treasuryMenu();
        break;
      case '6':
        await stakingMenu();
        break;
      case '7':
        await deploymentMenu();
        break;
      case '8':
        await testsMenu();
        break;
      case '9':
        await settingsMenu();
        break;
      case 'q':
        console.log(chalk.cyan('\n  👋 Goodbye!\n'));
        process.exit(0);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Entry Point
// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  // Parse command line args for initial config
  const args = process.argv.slice(2);
  const networkIdx = args.findIndex(a => a === '--network' || a === '-n');
  if (networkIdx !== -1 && args[networkIdx + 1]) {
    globalConfig.network = args[networkIdx + 1];
  }
  
  const keypairIdx = args.findIndex(a => a === '--keypair' || a === '-k');
  if (keypairIdx !== -1 && args[keypairIdx + 1]) {
    globalConfig.keypair = args[keypairIdx + 1];
  }

  // If --help, show usage
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
${chalk.cyan.bold('Memecoin Lending Protocol - Interactive Admin CLI')}

${chalk.yellow('Usage:')}
  npx tsx scripts/admin-cli.ts [options]
  pnpm --filter scripts admin [options]

${chalk.yellow('Options:')}
  -n, --network <network>  Network to use (devnet, mainnet, localnet) [default: devnet]
  -k, --keypair <path>     Path to admin keypair [default: ./keys/admin.json]
  -h, --help               Show this help message

${chalk.yellow('Examples:')}
  npx tsx scripts/admin-cli.ts
  npx tsx scripts/admin-cli.ts --network mainnet
  npx tsx scripts/admin-cli.ts -n devnet -k ./my-keypair.json
`);
    process.exit(0);
  }

  await mainMenu();
}

main().catch((error) => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});