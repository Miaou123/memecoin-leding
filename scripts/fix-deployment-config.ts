#!/usr/bin/env tsx

/**
 * Fix/Rebuild Deployment Config from on-chain state
 * 
 * Usage:
 *   npx tsx scripts/fix-deployment-config.ts --network devnet
 *   npx tsx scripts/fix-deployment-config.ts --network devnet --dry-run
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import chalk from 'chalk';
import { PublicKey, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient, printHeader, printInfo, printSuccess, printError } from './cli-utils.js';
import { getCurrentProgramId } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

config();

const program = new Command();

program
  .name('fix-deployment-config')
  .description('Rebuild deployment config from on-chain state')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --keypair <path>', 'Path to admin keypair', './keys/admin.json')
  .option('--dry-run', 'Show what would be saved without writing')
  .action(async (options) => {
    try {
      printHeader('🔧 Fix Deployment Config');
      
      const programId = getCurrentProgramId();
      const programPubkey = new PublicKey(programId);
      
      printInfo('Network', options.network);
      printInfo('Program ID', programId);
      
      const { client, keypair, connection } = await createClient(options.network, options.keypair);
      
      // Derive all PDAs
      console.log(chalk.blue('\n📍 Deriving PDAs...\n'));
      
      const pdas = {
        protocolState: PublicKey.findProgramAddressSync([Buffer.from('protocol_state')], programPubkey)[0],
        treasury: PublicKey.findProgramAddressSync([Buffer.from('treasury')], programPubkey)[0],
        feeReceiver: PublicKey.findProgramAddressSync([Buffer.from('fee_receiver')], programPubkey)[0],
        stakingPool: PublicKey.findProgramAddressSync([Buffer.from('staking_pool')], programPubkey)[0],
        stakingVaultAuthority: PublicKey.findProgramAddressSync([Buffer.from('staking_vault')], programPubkey)[0],
        rewardVault: PublicKey.findProgramAddressSync([Buffer.from('reward_vault')], programPubkey)[0],
      };
      
      // Check which accounts exist
      console.log(chalk.blue('🔍 Checking on-chain state...\n'));
      
      const exists: Record<string, boolean> = {};
      for (const [name, pda] of Object.entries(pdas)) {
        const info = await connection.getAccountInfo(pda);
        exists[name] = info !== null;
        printInfo(name, exists[name] ? chalk.green('✓ Exists') : chalk.red('✗ Not found'));
      }
      
      // Fetch data from existing accounts
      let protocolStateData: any = null;
      let stakingPoolData: any = null;
      
      if (exists.protocolState) {
        try {
          protocolStateData = await client.getProtocolState();
        } catch (e) {}
      }
      
      if (exists.stakingPool) {
        try {
          stakingPoolData = await client.getStakingPool();
        } catch (e) {}
      }
      
      const treasuryBalance = await connection.getBalance(pdas.treasury);
      
      // Load existing deployment
      const deploymentPath = path.join(ROOT_DIR, 'deployments', `${options.network}-latest.json`);
      let existing: any = {};
      if (fs.existsSync(deploymentPath)) {
        try {
          existing = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
        } catch (e) {}
      }
      
      // Build correct config
      const newDeployment = {
        programId,
        network: options.network,
        deployedAt: existing.deployedAt || new Date().toISOString(),
        previousProgramId: existing.previousProgramId,
        fundAmount: existing.fundAmount,
        cluster: options.network === 'mainnet' ? 'mainnet-beta' : options.network,
        
        pdas: {
          protocolState: pdas.protocolState.toString(),
          treasury: pdas.treasury.toString(),
          ...(exists.feeReceiver && { feeReceiver: pdas.feeReceiver.toString() }),
          ...(exists.stakingPool && { stakingPool: pdas.stakingPool.toString() }),
          ...(exists.stakingPool && stakingPoolData?.stakingVault && {
            stakingVault: stakingPoolData.stakingVault?.toString?.() || stakingPoolData.stakingVault,
          }),
          ...(exists.rewardVault && { rewardVault: pdas.rewardVault.toString() }),
        },
        
        initialization: {
          ...(exists.protocolState && {
            protocol: {
              txSignature: existing.initialization?.protocol?.txSignature || 'unknown',
              timestamp: existing.initialization?.protocol?.timestamp || new Date().toISOString(),
              admin: protocolStateData?.admin?.toString(),
            }
          }),
          ...(exists.feeReceiver && {
            feeReceiver: {
              txSignature: existing.initialization?.feeReceiver?.txSignature || 'unknown',
              timestamp: existing.initialization?.feeReceiver?.timestamp || new Date().toISOString(),
            }
          }),
          ...(exists.stakingPool && {
            staking: {
              txSignature: existing.initialization?.staking?.txSignature || existing.staking?.txSignature || 'unknown',
              timestamp: existing.initialization?.staking?.timestamp || existing.staking?.updatedAt || new Date().toISOString(),
              tokenMint: stakingPoolData?.stakingTokenMint?.toString() || existing.staking?.stakingTokenMint,
            }
          }),
          ...(treasuryBalance > 0 && {
            treasury: {
              txSignature: existing.initialization?.treasury?.txSignature || 'unknown',
              timestamp: existing.initialization?.treasury?.timestamp || new Date().toISOString(),
              funded: true,
              balance: treasuryBalance / LAMPORTS_PER_SOL,
            }
          }),
        },
        
        tokens: existing.tokens || { whitelisted: [] },
        metadata: existing.metadata || {},
      };
      
      console.log(chalk.blue('\n📄 New Config:\n'));
      console.log(chalk.gray(JSON.stringify(newDeployment, null, 2)));
      
      if (options.dryRun) {
        console.log(chalk.yellow('\n🔶 DRY RUN - Not saving'));
        return;
      }
      
      // Save
      const deploymentsDir = path.join(ROOT_DIR, 'deployments');
      if (!fs.existsSync(deploymentsDir)) {
        fs.mkdirSync(deploymentsDir, { recursive: true });
      }
      
      fs.writeFileSync(deploymentPath, JSON.stringify(newDeployment, null, 2));
      printSuccess(`\nSaved to: ${deploymentPath}`);
      
    } catch (error: any) {
      printError(`Failed: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();