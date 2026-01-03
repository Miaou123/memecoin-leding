#!/usr/bin/env tsx

import { PrismaClient } from '../apps/server/node_modules/@prisma/client/index.js';
import { Command } from 'commander';
import chalk from 'chalk';

const program = new Command();

program
  .name('clear-old-data')
  .description('Clear old loan data from database')
  .option('--confirm', 'Confirm deletion (required)')
  .option('--keep-stats', 'Keep protocol stats', false)
  .parse();

const options = program.opts();

async function clearOldData() {
  if (!options.confirm) {
    console.log(chalk.yellow('⚠️  This will DELETE all loan data from the database!'));
    console.log(chalk.yellow('   Add --confirm to proceed'));
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    console.log(chalk.blue('🗑️  Clearing old data...'));

    // Delete all notifications
    const notifications = await prisma.notification.deleteMany();
    console.log(chalk.gray(`   Deleted ${notifications.count} notifications`));

    // Delete all price history
    const priceHistory = await prisma.priceHistory.deleteMany();
    console.log(chalk.gray(`   Deleted ${priceHistory.count} price history entries`));

    // Delete all loans
    const loans = await prisma.loan.deleteMany();
    console.log(chalk.gray(`   Deleted ${loans.count} loans`));

    // Reset protocol stats
    if (!options.keepStats) {
      await prisma.protocolStats.updateMany({
        data: {
          totalValueLocked: '0',
          totalSolBorrowed: '0',
          totalLoansActive: 0,
          totalLoansCreated: 0,
          totalFeesEarned: '0',
          treasuryBalance: '0',
          volume24h: '0',
          liquidations24h: 0,
        }
      });
      console.log(chalk.gray(`   Reset protocol stats`));
    }

    console.log(chalk.green('✅ Old data cleared successfully!'));
    
    // Show remaining data
    const tokenCount = await prisma.token.count();
    const userCount = await prisma.user.count();
    console.log(chalk.gray(`\n   Preserved:`));
    console.log(chalk.gray(`   - ${tokenCount} whitelisted tokens`));
    console.log(chalk.gray(`   - ${userCount} users`));

  } catch (error) {
    console.error(chalk.red('❌ Error clearing data:'), error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

clearOldData();