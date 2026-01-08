#!/usr/bin/env tsx

/**
 * Fix Token Pool Type
 * 
 * Updates the token's poolType from 'raydium' to 'PumpSwap'
 * 
 * Usage: npx tsx scripts/fix-token-pooltype.ts
 */

import { PrismaClient } from '../apps/server/node_modules/@prisma/client/index.js';
import chalk from 'chalk';

const prisma = new PrismaClient();

async function main() {
  console.log(chalk.blue.bold('\n════════════════════════════════════════════════════════════'));
  console.log(chalk.blue.bold('  🔧 Fix Token Pool Type'));
  console.log(chalk.blue.bold('════════════════════════════════════════════════════════════\n'));

  const tokenMint = 'a3W4qutoEJA4232T2gwZUfgYJTetr96pU4SJMwppump';
  const poolAddress = '4qxSqMh6iEdbdvtMp8r5MK2psAGKNk57PfGeVo2VhczQ';
  
  console.log(chalk.gray('Token to update:'), tokenMint);
  console.log(chalk.gray('Pool address:'), poolAddress);
  console.log();

  try {
    // Check current state
    const token = await prisma.token.findUnique({
      where: { id: tokenMint },
    });

    if (!token) {
      console.log(chalk.red('❌ Token not found in database'));
      process.exit(1);
    }

    console.log(chalk.yellow('Current state:'));
    console.log(chalk.gray('  Pool Type:'), token.poolType || 'null');
    console.log(chalk.gray('  Pool Address:'), token.poolAddress || 'null');
    console.log();

    // Update token
    const updated = await prisma.token.update({
      where: { id: tokenMint },
      data: {
        poolType: 'PumpSwap',
        poolAddress: poolAddress,
      },
    });

    console.log(chalk.green('✅ Token updated successfully!'));
    console.log(chalk.gray('  New Pool Type:'), updated.poolType);
    console.log(chalk.gray('  New Pool Address:'), updated.poolAddress);

  } catch (error: any) {
    console.error(chalk.red('❌ Error:'), error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);