#!/usr/bin/env tsx

import { createClient, printHeader, printSuccess, printError, printInfo, printTxLink } from './cli-utils.js';
import { validateNetwork, getNetworkConfig, updateDeployment } from './config.js';
import { PublicKey } from '@solana/web3.js';
import chalk from 'chalk';
import { Command } from 'commander';
import BN from 'bn.js';


const program = new Command();

program
  .name('whitelist-token')
  .description('Whitelist a token for lending')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --admin-keypair <path>', 'Path to admin keypair', './keys/admin.json')
  .option('-m, --mint <address>', 'Token mint address')
  .option('-t, --tier <tier>', 'Token tier (bronze, silver, gold)')
  .option('-p, --pool <address>', 'Pool address for price feeds')
  .option('--pool-type <type>', 'Pool type (raydium, orca, pumpfun, pumpswap)', 'pumpfun')
  .option('--protocol-token', 'Mark as protocol token (always 50% LTV)')
  .action(async (options) => {
    try {
      printHeader('Whitelist Token');
      
      // Validate network and options
      validateNetwork(options.network);
      const config = getNetworkConfig(options.network);
      
      printInfo('Network', options.network);
      printInfo('Program ID', config.programId);
      
      // Create client
      const { client, keypair } = await createClient(options.network, options.adminKeypair);
      
      printInfo('Admin', keypair.publicKey.toString());
      
      if (!options.mint || !options.tier) {
        console.log(chalk.yellow('Usage:'));
        console.log(chalk.gray('  --mint <address>   Token mint address (required)'));
        console.log(chalk.gray('  --tier <tier>      bronze, silver, or gold (required)'));
        console.log(chalk.gray('  --pool <address>   Pool address (optional, defaults to mint)'));
        console.log(chalk.gray('  --pool-type <type> raydium, orca, pumpfun, pumpswap (default: pumpfun)'));
        console.log(chalk.gray('  --protocol-token   Mark as protocol token (always 50% LTV)'));
        console.log(chalk.gray('\nExample:'));
        console.log(chalk.gray('  npx tsx whitelist-token.ts --mint ABC123... --tier gold --network devnet'));
        console.log(chalk.gray('  npx tsx whitelist-token.ts --mint ABC123... --tier bronze --protocol-token'));
        return;
      }
      
      const tierMap: Record<string, number> = {
        'bronze': 0,
        'silver': 1,
        'gold': 2,
      };
      
      const poolTypeMap: Record<string, number> = {
        'raydium': 0,
        'orca': 1,
        'pumpfun': 2,
        'pumpswap': 3,
      };
      
      if (!(options.tier.toLowerCase() in tierMap)) {
        throw new Error('Invalid tier. Must be bronze, silver, or gold');
      }
      
      const tier = tierMap[options.tier.toLowerCase()];
      const poolType = poolTypeMap[options.poolType?.toLowerCase() || 'pumpfun'] ?? 2;
      const mint = new PublicKey(options.mint);
      const poolAddress = new PublicKey(options.pool || options.mint);
      
      printInfo('Token Mint', options.mint);
      printInfo('Tier', `${options.tier} (${tier})`);
      printInfo('Pool Type', `${options.poolType || 'pumpfun'} (${poolType})`);
      printInfo('Pool Address', poolAddress.toString());
      if (options.protocolToken) {
        printInfo('Protocol Token', 'Yes (50% LTV override)');
      }
      
      console.log(chalk.yellow('\n🔄 Sending transaction...'));
      
      const signature = await client.whitelistToken({
        mint: mint,
        tier: tier,
        poolAddress: poolAddress,
        poolType: poolType,
        minLoanAmount: new BN(1000000),      // 0.001 SOL min
        maxLoanAmount: new BN(100000000000), // 100 SOL max
        isProtocolToken: options.protocolToken ?? false,
      });
      
      printSuccess('Token whitelisted successfully!');
      printInfo('Transaction', signature);
      printTxLink(signature, options.network);
      
      // Derive token config PDA for saving
      const [configPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('token_config'), mint.toBuffer()],
        new PublicKey(config.programId)
      );
      
      // Update deployment config with token info
      console.log(chalk.yellow('\n💾 Updating deployment config...'));
      updateDeployment(options.network, {
        tokens: {
          whitelisted: [{
            mint: mint.toString(),
            symbol: options.mint.slice(0, 8) + '...', // Truncated for display
            tier: options.tier.toLowerCase() as 'bronze' | 'silver' | 'gold',
            configPda: configPda.toString(),
            whitelistedAt: new Date().toISOString(),
            txSignature: signature,
            poolAddress: poolAddress.toString(),
            poolType: options.poolType || 'pumpfun',
            isProtocolToken: options.protocolToken ?? false,
          }]
        }
      });
      
      printSuccess('Deployment config updated with token information');
      
      // Show tier info
      const tierInfo: Record<number, { ltv: string; liquidityReq: string }> = {
        0: { ltv: '25%', liquidityReq: '> $0' },
        1: { ltv: '35%', liquidityReq: '> $100k' },
        2: { ltv: '50%', liquidityReq: '> $300k' },
      };
      
      console.log(chalk.blue('\n📊 Token Configuration:'));
      const actualLtv = options.protocolToken ? '50%' : tierInfo[tier].ltv;
      console.log(chalk.gray(`  LTV: ${actualLtv}${options.protocolToken ? ' (Protocol Token)' : ` (${tierInfo[tier].liquidityReq})`}`));
      console.log(chalk.gray(`  Protocol Fee: 2% flat`));
      
      console.log(chalk.green('\n✅ Token whitelisting complete!'));
      
    } catch (error) {
      printError(`Failed to whitelist token: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

program.parse(process.argv);