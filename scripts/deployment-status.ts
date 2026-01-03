#!/usr/bin/env tsx

import { 
  getDeploymentStatus, 
  getProtocolAddresses, 
  getInitializationInfo,
  getWhitelistedTokens,
  validateNetwork 
} from './config.js';
import { loadDeployment } from './deployment-store.js';
import { printHeader, printInfo } from './cli-utils.js';
import chalk from 'chalk';
import { Command } from 'commander';

const program = new Command();

program
  .name('deployment-status')
  .description('Check comprehensive deployment status for a network')
  .requiredOption('--network <network>', 'Solana network (devnet, mainnet, localnet)')
  .option('--verbose', 'Show detailed information')
  .action(async (options) => {
    try {
      printHeader(`Deployment Status - ${options.network.toUpperCase()}`);
      
      // Validate network
      validateNetwork(options.network);
      
      // Get deployment data
      const deployment = loadDeployment(options.network);
      const status = getDeploymentStatus(options.network);
      
      if (!deployment) {
        console.log(chalk.red('❌ No deployment found for this network'));
        console.log(chalk.yellow('💡 Run: npm run deploy:full --network ' + options.network));
        process.exit(1);
      }
      
      // Basic deployment info
      console.log(chalk.blue('📦 Deployment Information'));
      printInfo('Program ID', deployment.programId);
      printInfo('Network', deployment.network);
      printInfo('Cluster', deployment.cluster);
      printInfo('Deployed At', new Date(deployment.deployedAt).toLocaleString());
      
      if (deployment.deploySignature && options.verbose) {
        printInfo('Deploy Signature', deployment.deploySignature);
      }
      
      if (deployment.metadata?.deployerAddress && options.verbose) {
        printInfo('Deployed By', deployment.metadata.deployerAddress);
      }
      
      // Deployment status overview
      console.log(chalk.blue('\\n🎯 Status Overview'));
      console.log(`  Program Deployed:      ${status.deployed ? '✅' : '❌'}`);
      console.log(`  Protocol Initialized:  ${status.protocolInitialized ? '✅' : '❌'}`);
      console.log(`  Fee Receiver Setup:    ${status.feeReceiverInitialized ? '✅' : '❌'}`);
      console.log(`  Staking Initialized:   ${status.stakingInitialized ? '✅' : '❌'}`);
      console.log(`  Treasury Funded:       ${status.treasuryFunded ? '✅' : '❌'}`);
      console.log(`  Whitelisted Tokens:    ${status.whitelistedTokensCount}`);
      
      // Protocol addresses
      const addresses = getProtocolAddresses(options.network);
      if (Object.keys(addresses).length > 0) {
        console.log(chalk.blue('\\n🏛️  Protocol Addresses (PDAs)'));
        if (addresses.protocolState) {
          printInfo('Protocol State', addresses.protocolState);
        }
        if (addresses.treasury) {
          printInfo('Treasury', addresses.treasury);
        }
        if (addresses.feeReceiver) {
          printInfo('Fee Receiver', addresses.feeReceiver);
        }
        if (addresses.stakingPool) {
          printInfo('Staking Pool', addresses.stakingPool);
        }
        if (addresses.stakingVault) {
          printInfo('Staking Vault', addresses.stakingVault);
        }
        if (addresses.rewardVault) {
          printInfo('Reward Vault', addresses.rewardVault);
        }
      }
      
      // Initialization details (verbose mode)
      if (options.verbose) {
        console.log(chalk.blue('\\n🔧 Initialization History'));
        
        const protocolInit = getInitializationInfo(options.network, 'protocol');
        if (protocolInit) {
          console.log(chalk.green('  Protocol:'));
          printInfo('    Transaction', protocolInit.txSignature);
          printInfo('    Timestamp', new Date(protocolInit.timestamp).toLocaleString());
          if (protocolInit.admin) {
            printInfo('    Admin', protocolInit.admin);
          }
        }
        
        const feeReceiverInit = getInitializationInfo(options.network, 'feeReceiver');
        if (feeReceiverInit) {
          console.log(chalk.green('  Fee Receiver:'));
          printInfo('    Transaction', feeReceiverInit.txSignature);
          printInfo('    Timestamp', new Date(feeReceiverInit.timestamp).toLocaleString());
        }
        
        const stakingInit = getInitializationInfo(options.network, 'staking');
        if (stakingInit) {
          console.log(chalk.green('  Staking:'));
          printInfo('    Transaction', stakingInit.txSignature);
          printInfo('    Timestamp', new Date(stakingInit.timestamp).toLocaleString());
          if (stakingInit.tokenMint) {
            printInfo('    Token Mint', stakingInit.tokenMint);
          }
        }
        
        const treasuryInit = getInitializationInfo(options.network, 'treasury');
        if (treasuryInit) {
          console.log(chalk.green('  Treasury:'));
          printInfo('    Transaction', treasuryInit.txSignature);
          printInfo('    Timestamp', new Date(treasuryInit.timestamp).toLocaleString());
          printInfo('    Funded', treasuryInit.funded ? 'Yes' : 'No');
          if (treasuryInit.balance !== undefined) {
            printInfo('    Balance', `${treasuryInit.balance} SOL`);
          }
        }
      }
      
      // Whitelisted tokens
      const tokens = getWhitelistedTokens(options.network);
      if (tokens.length > 0) {
        console.log(chalk.blue('\\n🪙  Whitelisted Tokens'));
        tokens.forEach((token, index) => {
          console.log(chalk.white(`  ${index + 1}. ${token.symbol || 'Unknown'} (${token.tier})`));
          printInfo('    Mint', token.mint);
          printInfo('    Config PDA', token.configPda);
          if (options.verbose) {
            printInfo('    Whitelisted', new Date(token.whitelistedAt).toLocaleString());
            printInfo('    Transaction', token.txSignature);
          }
        });
      }
      
      // Explorer links
      console.log(chalk.blue('\\n🔍 Explorer Links'));
      const baseUrl = options.network === 'mainnet' 
        ? 'https://explorer.solana.com' 
        : `https://explorer.solana.com?cluster=${options.network}`;
      
      console.log(chalk.cyan(`  Program: ${baseUrl}/address/${deployment.programId}`));
      if (addresses.protocolState) {
        console.log(chalk.cyan(`  Protocol: ${baseUrl}/address/${addresses.protocolState}`));
      }
      if (addresses.treasury) {
        console.log(chalk.cyan(`  Treasury: ${baseUrl}/address/${addresses.treasury}`));
      }
      
      // Summary
      const completionPercentage = Math.round(
        (Number(status.deployed) + 
         Number(status.protocolInitialized) + 
         Number(status.feeReceiverInitialized) + 
         Number(status.stakingInitialized) + 
         Number(status.treasuryFunded)) / 5 * 100
      );
      
      console.log(chalk.blue('\\n📊 Deployment Completion'));
      console.log(`  Overall Progress: ${completionPercentage}% (${completionPercentage === 100 ? '✅ Complete' : '🔄 In Progress'})`);
      
      if (completionPercentage < 100) {
        console.log(chalk.yellow('\\n💡 Next Steps:'));
        if (!status.protocolInitialized) {
          console.log('  - Run: npx tsx scripts/initialize-protocol.ts --network ' + options.network);
        }
        if (!status.feeReceiverInitialized) {
          console.log('  - Run: npx tsx scripts/initialize-fee-receiver.ts --network ' + options.network);
        }
        if (!status.stakingInitialized) {
          console.log('  - Run: npx tsx scripts/initialize-staking.ts --network ' + options.network);
        }
        if (!status.treasuryFunded) {
          console.log('  - Run: npx tsx scripts/fund-treasury.ts --network ' + options.network + ' --amount 1.0');
        }
      }
      
    } catch (error) {
      console.error(chalk.red(`❌ Failed to check deployment status: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse(process.argv);