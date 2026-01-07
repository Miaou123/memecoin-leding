#!/usr/bin/env tsx

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { Command } from 'commander';
import { createInitialDeployment, saveDeploymentConfig, updateDeployment, getRpcUrl, getDeploymentStatus } from './config.js';
import { loadDeployment } from './deployment-store.js';

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

interface DeployConfig {
  network: 'devnet' | 'mainnet' | 'localnet';
  skipKeygen: boolean;
  skipInit: boolean;
  fundAmount: number;
  adminKeypair: string;
  stakingTokenMint?: string;
}

function exec(cmd: string, options: { cwd?: string; silent?: boolean } = {}): string {
  const { cwd = ROOT_DIR, silent = false } = options;
  if (!silent) {
    console.log(chalk.gray(`$ ${cmd}`));
  }
  try {
    return execSync(cmd, { 
      cwd, 
      encoding: 'utf8',
      stdio: silent ? 'pipe' : 'inherit'
    }) as string;
  } catch (error: any) {
    if (silent) {
      return error.stdout || '';
    }
    throw error;
  }
}

function execCapture(cmd: string, cwd = ROOT_DIR): string {
  console.log(chalk.gray(`$ ${cmd}`));
  return execSync(cmd, { cwd, encoding: 'utf8' }).toString().trim();
}

function updateProgramId(oldId: string, newId: string) {
  console.log(chalk.blue(`\n📝 Updating program ID: ${oldId} → ${newId}\n`));
  
  const filesToUpdate = [
    'packages/config/src/constants.ts',
    'packages/config/src/networks.ts',
    'Anchor.toml',
    'programs/memecoin-lending/src/lib.rs',
    'apps/web/.env',
    'apps/web/.env.local',
    'apps/server/.env',
    'apps/server/.env.local',
    '.env',
  ];
  
  for (const file of filesToUpdate) {
    const filePath = path.join(ROOT_DIR, file);
    if (fs.existsSync(filePath)) {
      let content = fs.readFileSync(filePath, 'utf8');
      if (content.includes(oldId)) {
        content = content.replace(new RegExp(oldId, 'g'), newId);
        fs.writeFileSync(filePath, content);
        console.log(chalk.green(`  ✓ Updated ${file}`));
      }
    }
  }
  
  // Also update any occurrence of placeholder ID
  const placeholderId = 'MCLend1111111111111111111111111111111111111';
  for (const file of filesToUpdate) {
    const filePath = path.join(ROOT_DIR, file);
    if (fs.existsSync(filePath)) {
      let content = fs.readFileSync(filePath, 'utf8');
      if (content.includes(placeholderId)) {
        content = content.replace(new RegExp(placeholderId, 'g'), newId);
        fs.writeFileSync(filePath, content);
        console.log(chalk.green(`  ✓ Updated placeholder in ${file}`));
      }
    }
  }
}

function getExistingProgramId(): string | null {
  const keypairPath = path.join(ROOT_DIR, 'target/deploy/memecoin_lending-keypair.json');
  if (fs.existsSync(keypairPath)) {
    try {
      return execCapture(`solana address -k ${keypairPath}`);
    } catch {
      return null;
    }
  }
  return null;
}

function closeExistingProgram(programId: string, network: string): boolean {
  console.log(chalk.blue(`\n🗑️  Attempting to close existing program: ${programId}\n`));
  try {
    exec(`solana program close ${programId} --url ${network} --bypass-warning`, { silent: true });
    console.log(chalk.green(`  ✓ Closed program and recovered SOL`));
    return true;
  } catch {
    console.log(chalk.yellow(`  ⚠ Could not close program (may not exist or already closed)`));
    return false;
  }
}

async function syncAppConfigs(network: string, programId: string) {
  console.log(chalk.gray('  Reading deployment configuration...'));
  
  // Read deployment config
  const deploymentPath = path.join(ROOT_DIR, 'deployments', `${network}-latest.json`);
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`Deployment config not found: ${deploymentPath}`);
  }
  
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  
  console.log(chalk.gray('  Updating frontend (.env.local)...'));
  
  // Update frontend .env.local
  const frontendEnvPath = path.join(ROOT_DIR, 'apps', 'web', '.env.local');
  let frontendEnv = '';
  
  if (fs.existsSync(frontendEnvPath)) {
    frontendEnv = fs.readFileSync(frontendEnvPath, 'utf8');
  }
  
  // Update or add environment variables
  const envVars = {
    'VITE_PROGRAM_ID': programId,
    'VITE_SOLANA_NETWORK': network,
  };
  
  // Add protocol addresses if available
  if (deployment.pdas?.protocolState) {
    envVars['VITE_PROTOCOL_STATE'] = deployment.pdas.protocolState;
  }
  if (deployment.pdas?.treasury) {
    envVars['VITE_TREASURY'] = deployment.pdas.treasury;
  }
  if (deployment.pdas?.feeReceiver) {
    envVars['VITE_FEE_RECEIVER'] = deployment.pdas.feeReceiver;
  }
  if (deployment.pdas?.stakingPool) {
    envVars['VITE_STAKING_POOL'] = deployment.pdas.stakingPool;
  }
  
  for (const [key, value] of Object.entries(envVars)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (frontendEnv.match(regex)) {
      frontendEnv = frontendEnv.replace(regex, `${key}=${value}`);
    } else {
      frontendEnv += `\n${key}=${value}`;
    }
  }
  
  fs.writeFileSync(frontendEnvPath, frontendEnv.trim() + '\n');
  console.log(chalk.green(`    ✓ Updated ${frontendEnvPath}`));
  
  console.log(chalk.gray('  Updating backend (.env)...'));
  
  // Update backend .env
  const serverEnvPath = path.join(ROOT_DIR, 'apps', 'server', '.env');
  let serverEnv = '';
  
  if (fs.existsSync(serverEnvPath)) {
    serverEnv = fs.readFileSync(serverEnvPath, 'utf8');
  }
  
  // Update backend environment variables
  const serverEnvVars = {
    'PROGRAM_ID': `"${programId}"`,
    'SOLANA_NETWORK': `"${network}"`,
  };
  
  for (const [key, value] of Object.entries(serverEnvVars)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (serverEnv.match(regex)) {
      serverEnv = serverEnv.replace(regex, `${key}=${value}`);
    } else {
      serverEnv += `\n${key}=${value}`;
    }
  }
  
  fs.writeFileSync(serverEnvPath, serverEnv.trim() + '\n');
  console.log(chalk.green(`    ✓ Updated ${serverEnvPath}`));
  
  console.log(chalk.gray('  Rebuilding packages...'));
  
  // Rebuild config package to pick up changes
  try {
    exec('pnpm build', { cwd: path.join(ROOT_DIR, 'packages', 'config') });
    console.log(chalk.green('    ✓ Rebuilt config package'));
  } catch (error) {
    console.log(chalk.yellow('    ⚠ Could not rebuild config package'));
  }
}

async function deploy(config: DeployConfig): Promise<boolean> {
  const startTime = Date.now();
  
  console.log(chalk.blue.bold('\n🚀 FULL DEPLOYMENT SCRIPT\n'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log(chalk.white(`  Network:      ${config.network}`));
  console.log(chalk.white(`  Skip Keygen:  ${config.skipKeygen}`));
  console.log(chalk.white(`  Skip Init:    ${config.skipInit}`));
  console.log(chalk.white(`  Fund Amount:  ${config.fundAmount} SOL`));
  console.log(chalk.gray('─'.repeat(60)));

  const networkUrl = {
    devnet: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
    mainnet: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    localnet: 'http://localhost:8899',
  }[config.network];

  // Ensure keys directory and admin keypair exist
  const keysDir = path.join(ROOT_DIR, 'keys');
  const adminKeypairPath = path.join(keysDir, 'admin.json');

  if (!fs.existsSync(keysDir)) {
    fs.mkdirSync(keysDir, { recursive: true });
  }

  if (!fs.existsSync(adminKeypairPath)) {
    console.log(chalk.blue('\n🔑 Creating admin keypair...\n'));
    exec(`solana-keygen new -o ${adminKeypairPath} --no-bip39-passphrase`);
    
    // Airdrop some SOL for devnet
    if (config.network === 'devnet') {
      const adminAddress = execCapture(`solana address -k ${adminKeypairPath}`);
      console.log(chalk.yellow(`  Airdropping 2 SOL to admin: ${adminAddress}`));
      try {
        exec(`solana airdrop 2 ${adminAddress} --url devnet`, { silent: true });
      } catch {
        console.log(chalk.yellow('  ⚠ Airdrop failed, you may need to fund manually'));
      }
    }
  }

  // Step 1: Get current program ID (if exists)
  const oldProgramId = getExistingProgramId();
  console.log(chalk.blue(`\n📍 Current Program ID: ${oldProgramId || 'None'}\n`));

  // Step 2: Close existing program (optional, to recover SOL)
  if (oldProgramId && !config.skipKeygen && config.network !== 'mainnet') {
    closeExistingProgram(oldProgramId, networkUrl);
  }

  // Step 3: Generate new keypair
  let newProgramId: string;
  if (config.skipKeygen && oldProgramId) {
    newProgramId = oldProgramId;
    console.log(chalk.yellow(`\n⏭️  Skipping keygen, using existing: ${newProgramId}\n`));
  } else {
    console.log(chalk.blue('\n🔑 Generating new program keypair...\n'));
    exec('solana-keygen new -o target/deploy/memecoin_lending-keypair.json --force --no-bip39-passphrase');
    newProgramId = execCapture('solana address -k target/deploy/memecoin_lending-keypair.json');
    console.log(chalk.green(`  ✓ New Program ID: ${newProgramId}`));
  }

  // Step 4: Sync anchor keys
  console.log(chalk.blue('\n🔄 Syncing Anchor keys...\n'));
  exec('anchor keys sync');

  // Step 5: Update program ID in all files
  if (oldProgramId && oldProgramId !== newProgramId) {
    updateProgramId(oldProgramId, newProgramId);
  }

  // Step 6: Build the program
  console.log(chalk.blue('\n🔨 Building Anchor program...\n'));
  exec('anchor build');

  // Step 7: Build packages
  console.log(chalk.blue('\n📦 Building TypeScript packages...\n'));
  exec('pnpm build', { cwd: path.join(ROOT_DIR, 'packages/config') });
  exec('pnpm build', { cwd: path.join(ROOT_DIR, 'packages/sdk') });

  // Step 8: Deploy
  console.log(chalk.blue(`\n🚀 Deploying to ${config.network}...\n`));
  try {
    exec(`anchor deploy --provider.cluster ${config.network}`);
  } catch (error: any) {
    // Check if it's just an IDL error (program deployed successfully)
    if (error.message?.includes('IDL') || error.message?.includes('already in use')) {
      console.log(chalk.yellow('  ⚠ Program deployed but IDL upload failed (may already exist)'));
    } else {
      throw error; // Re-throw if it's a real deployment failure
    }
  }

  // Step 9: Verify deployment
  console.log(chalk.blue('\n✅ Verifying deployment...\n'));
  try {
    const result = execCapture(`solana program show ${newProgramId} --url ${networkUrl}`);
    console.log(chalk.green('  ✓ Program deployed successfully'));
    console.log(chalk.gray(result));
  } catch {
    console.log(chalk.red('  ✗ Could not verify deployment'));
  }

  // Step 9.5: Create initial deployment record (ONLY if it doesn't exist)
  console.log(chalk.blue('\n💾 Creating initial deployment record...\n'));
  try {
    const existingDeployment = loadDeployment(config.network);
    
    if (!existingDeployment || existingDeployment.programId !== newProgramId) {
      // Only create fresh if program ID changed or no deployment exists
      const deploymentConfig = createInitialDeployment({
        network: config.network,
        programId: newProgramId,
        deploySignature: 'TBD',
        deployerAddress: 'TBD',
      });
      
      saveDeploymentConfig(config.network, deploymentConfig);
      console.log(chalk.green('  ✓ Initial deployment config created'));
    } else {
      // Just update the program ID if it changed
      updateDeployment(config.network, {
        programId: newProgramId,
        deployedAt: new Date().toISOString(),
      });
      console.log(chalk.green('  ✓ Deployment config updated with new program ID'));
    }
  } catch (error) {
    console.log(chalk.yellow(`  ⚠ Could not save deployment config: ${error}`));
  }

  // Step 10: Initialize protocol
  if (!config.skipInit) {
    console.log(chalk.blue('\n🔧 Initializing protocol...\n'));
    try {
      exec(`npx tsx scripts/initialize-protocol.ts --network ${config.network}`, {
        cwd: ROOT_DIR,
      });
    } catch (error) {
      console.log(chalk.yellow('  ⚠ Protocol may already be initialized'));
    }
  }

  // Step 11: Initialize Staking (if governance token mint is provided)
  if (config.stakingTokenMint) {
    console.log(chalk.blue('\n🎯 Initializing staking pool...\n'));
    try {
      exec(`npx tsx scripts/initialize-staking-epoch.ts --network ${config.network} --token-mint ${config.stakingTokenMint}`, {
        cwd: ROOT_DIR,
      });
    } catch (error) {
      console.log(chalk.yellow('  ⚠ Staking pool initialization failed or already initialized'));
    }
  }

  // Step 12: Initialize Fee Receiver
  console.log(chalk.blue('\n💰 Initializing fee receiver...\n'));
  try {
    exec(`npx tsx scripts/initialize-fee-receiver.ts --network ${config.network}`, {
      cwd: ROOT_DIR,
    });
  } catch (error) {
    console.log(chalk.yellow('  ⚠ Fee receiver initialization failed or already initialized'));
  }

  // Step 13: Update Protocol Fee to 2%
  console.log(chalk.blue('\n⚙️  Setting protocol fee to 2%...\n'));
  try {
    exec(`npx tsx scripts/update-protocol-fees.ts --network ${config.network} --protocol-fee 200`, {
      cwd: ROOT_DIR,
    });
  } catch (error) {
    console.log(chalk.yellow('  ⚠ Fee update failed'));
  }

  // Step 14: Fund treasury
  if (config.fundAmount > 0) {
    console.log(chalk.blue(`\n💰 Funding treasury with ${config.fundAmount} SOL...\n`));
    try {
      exec(`npx tsx scripts/fund-treasury.ts --network ${config.network} --amount ${config.fundAmount}`, {
        cwd: ROOT_DIR,
      });
    } catch (error) {
      console.log(chalk.yellow('  ⚠ Could not fund treasury'));
    }
  }

  // Step 15: Update deployment info (merge with existing, don't overwrite)
  console.log(chalk.blue('\n💾 Updating deployment metadata...\n'));

  // Use updateDeployment to MERGE, not overwrite
  // This preserves PDAs and initialization data saved by previous steps
  const currentDeployment = loadDeployment(config.network);
  updateDeployment(config.network, {
    metadata: {
      ...currentDeployment?.metadata,
      deployerAddress: currentDeployment?.metadata?.deployerAddress || 'TBD',
    },
  });

  console.log(chalk.green('  ✓ Deployment metadata updated (PDAs preserved)'));

  // Update deployment history
  const deploymentsDir = path.join(ROOT_DIR, 'deployments');
  const historyFile = path.join(deploymentsDir, `${config.network}-history.json`);
  let history: any[] = [];
  if (fs.existsSync(historyFile)) {
    history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
  }
  
  const historyEntry = {
    programId: newProgramId,
    network: config.network,
    deployedAt: new Date().toISOString(),
    previousProgramId: oldProgramId,
    fundAmount: config.fundAmount,
  };
  
  history.push(historyEntry);
  fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));

  // Step 16: Sync frontend and backend configs
  console.log(chalk.blue('\n📝 Syncing frontend/backend configs...\n'));
  try {
    await syncAppConfigs(config.network, newProgramId);
    console.log(chalk.green('✅ Frontend and backend configs synced!'));
  } catch (error) {
    console.log(chalk.yellow(`⚠️  Could not sync configs: ${error}`));
  }

  // Final deployment status check
  console.log(chalk.blue('\n📊 Deployment Status Summary...\n'));
  try {
    const status = getDeploymentStatus(config.network);
    console.log(chalk.white(`  Program Deployed:      ${status.deployed ? '✅' : '❌'}`));
    console.log(chalk.white(`  Protocol Initialized:  ${status.protocolInitialized ? '✅' : '❌'}`));
    console.log(chalk.white(`  Fee Receiver Setup:    ${status.feeReceiverInitialized ? '✅' : '❌'}`));
    console.log(chalk.white(`  Staking Initialized:   ${status.stakingInitialized ? '✅' : '❌'}`));
    console.log(chalk.white(`  Treasury Funded:       ${status.treasuryFunded ? '✅' : '❌'}`));
    console.log(chalk.white(`  Whitelisted Tokens:    ${status.whitelistedTokensCount}`));
  } catch (error) {
    console.log(chalk.yellow(`  Could not check status: ${error}`));
  }

  // Summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log(chalk.blue.bold('\n' + '═'.repeat(60)));
  console.log(chalk.green.bold('  ✅ DEPLOYMENT COMPLETE'));
  console.log(chalk.blue.bold('═'.repeat(60)));
  console.log('');
  console.log(chalk.white(`  Program ID:    ${newProgramId}`));
  console.log(chalk.white(`  Network:       ${config.network}`));
  console.log(chalk.white(`  Duration:      ${duration}s`));
  console.log('');
  console.log(chalk.gray('  Explorer:'));
  console.log(chalk.cyan(`  https://explorer.solana.com/address/${newProgramId}?cluster=${config.network}`));
  console.log('');
  console.log(chalk.blue.bold('═'.repeat(60) + '\n'));

  // Return success
  return true;
}

// CLI
const program = new Command();

program
  .name('deploy-full')
  .description('Full deployment script for memecoin-lending protocol')
  .option('-n, --network <network>', 'Network: devnet, mainnet, localnet', 'devnet')
  .option('--skip-keygen', 'Skip keypair generation, use existing', false)
  .option('--skip-init', 'Skip protocol initialization', false)
  .option('--fund <amount>', 'Amount of SOL to fund treasury', '0.5')
  .option('--no-fund', 'Skip treasury funding')
  .option('-k, --admin-keypair <path>', 'Path to admin keypair', './keys/admin.json')
  .option('--staking-token <mint>', 'Governance token mint for staking (optional)')
  .option('--confirm-mainnet', 'Confirm mainnet deployment', false) 
  .action(async (options) => {
    // Safety check for mainnet
    if (options.network === 'mainnet') {
      console.log(chalk.red.bold('\n⚠️  WARNING: You are deploying to MAINNET!\n'));
      console.log(chalk.yellow('This will use real SOL. Are you sure?'));
      console.log(chalk.gray('Add --confirm-mainnet to proceed\n'));
      
      if (!process.argv.includes('--confirm-mainnet')) {
        process.exit(1);
      }
    }

    try {
      await deploy({
        network: options.network,
        skipKeygen: options.skipKeygen,
        skipInit: options.skipInit,
        fundAmount: options.fund === false ? 0 : parseFloat(options.fund),
        adminKeypair: options.adminKeypair,
        stakingTokenMint: options.stakingToken,
      });
    } catch (error) {
      console.error(chalk.red('\n❌ Deployment failed:'), error);
      process.exit(1);
    }
  });

program.parse();