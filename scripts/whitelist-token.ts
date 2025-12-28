#!/usr/bin/env tsx

import { config } from 'dotenv';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { MemecoinLendingClient } from '@memecoin-lending/sdk';
import { TokenTier } from '@memecoin-lending/types';
import { PROGRAM_ID, getNetworkConfig, WHITELISTED_TOKENS } from '@memecoin-lending/config';
import chalk from 'chalk';
import { Command } from 'commander';
import fs from 'fs';

config();

const program = new Command();

program
  .name('whitelist-token')
  .description('Whitelist a token for lending')
  .option('-n, --network <network>', 'Network to use', 'devnet')
  .option('-k, --admin-keypair <path>', 'Path to admin keypair', './keys/admin.json')
  .option('-m, --mint <address>', 'Token mint address')
  .option('-t, --tier <tier>', 'Token tier (bronze, silver, gold)')
  .option('-p, --pool <address>', 'Pool address for price feeds')
  .option('-s, --symbol <symbol>', 'Token symbol')
  .option('-N, --name <name>', 'Token name')
  .option('-d, --decimals <number>', 'Token decimals', '9')
  .option('--all', 'Whitelist all default tokens')
  .action(async (options) => {
    try {
      console.log(chalk.blue('📝 Whitelisting token(s)...'));
      
      // Load network configuration
      process.env.SOLANA_NETWORK = options.network;
      const networkConfig = getNetworkConfig(options.network);
      
      console.log(chalk.gray(`Network: ${options.network}`));
      
      // Create connection
      const connection = new Connection(networkConfig.rpcUrl, 'confirmed');
      
      // Load admin keypair
      if (!fs.existsSync(options.adminKeypair)) {
        throw new Error(`Admin keypair not found: ${options.adminKeypair}`);
      }
      
      const adminKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(options.adminKeypair, 'utf8')))
      );
      
      console.log(chalk.gray(`Admin: ${adminKeypair.publicKey.toString()}`));
      
      // Create SDK client
      const idl = {}; // Load from target/idl/memecoin_lending.json
      const client = new MemecoinLendingClient(
        connection,
        adminKeypair as any,
        PROGRAM_ID,
        idl as any
      );
      
      if (options.all) {
        // Whitelist all default tokens
        console.log(chalk.blue('📦 Whitelisting all default tokens...'));
        
        for (const [mint, tokenData] of Object.entries(WHITELISTED_TOKENS)) {
          try {
            console.log(chalk.gray(`Whitelisting ${tokenData.symbol}...`));
            
            const tierMap = {
              [TokenTier.Bronze]: 0,
              [TokenTier.Silver]: 1,
              [TokenTier.Gold]: 2,
            };
            
            await client.whitelistToken({
              mint: new PublicKey(mint),
              tier: tierMap[tokenData.tier],
              poolAddress: new PublicKey(tokenData.poolAddress || mint), // Use mint as fallback
            });
            
            console.log(chalk.green(`✅ ${tokenData.symbol} whitelisted`));
            
          } catch (error) {
            console.error(chalk.red(`❌ Failed to whitelist ${tokenData.symbol}:`), error);
          }
          
          // Small delay to avoid overwhelming the network
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
      } else {
        // Whitelist single token
        if (!options.mint || !options.tier) {
          throw new Error('Must specify --mint and --tier for single token whitelisting');
        }
        
        const tierMap = {
          'bronze': 0,
          'silver': 1,
          'gold': 2,
        };
        
        if (!(options.tier in tierMap)) {
          throw new Error('Invalid tier. Must be bronze, silver, or gold');
        }
        
        console.log(chalk.blue(`📝 Whitelisting ${options.symbol || options.mint}...`));
        
        await client.whitelistToken({
          mint: new PublicKey(options.mint),
          tier: tierMap[options.tier as keyof typeof tierMap],
          poolAddress: new PublicKey(options.pool || options.mint),
        });
        
        console.log(chalk.green('✅ Token whitelisted successfully!'));
        console.log(chalk.gray(`Mint: ${options.mint}`));
        console.log(chalk.gray(`Tier: ${options.tier}`));
        console.log(chalk.gray(`Pool: ${options.pool || options.mint}`));
      }
      
      // List all whitelisted tokens
      console.log(chalk.blue('\n📊 Current whitelisted tokens:'));
      
      try {
        const tokens = await client.getWhitelistedTokens();
        
        if (tokens.length === 0) {
          console.log(chalk.yellow('No tokens whitelisted yet'));
        } else {
          tokens.forEach((token, index) => {
            console.log(chalk.gray(`${index + 1}. ${token.mint} (${token.tier})`));
          });
        }
      } catch (error) {
        console.log(chalk.yellow('Could not fetch whitelisted tokens'));
      }
      
      console.log(chalk.green('\n✅ Token whitelisting completed!'));
      
    } catch (error) {
      console.error(chalk.red('❌ Whitelisting failed:'), error);
      process.exit(1);
    }
  });

program.parse();