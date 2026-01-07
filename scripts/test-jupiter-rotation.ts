#!/usr/bin/env tsx
/**
 * Test script to seed fake loans and verify Jupiter API rotation
 */

import { PrismaClient } from '../apps/server/node_modules/@prisma/client/index.js';

const prisma = new PrismaClient();

// Popular tokens for testing (real Solana mints)
const TEST_TOKENS = [
  {
    id: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
    symbol: 'BONK',
    name: 'Bonk',
    decimals: 5,
    tier: 'bronze',
  },
  {
    id: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', // WIF
    symbol: 'WIF',
    name: 'dogwifhat',
    decimals: 6,
    tier: 'bronze',
  },
  {
    id: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP
    symbol: 'JUP',
    name: 'Jupiter',
    decimals: 6,
    tier: 'silver',
  },
  {
    id: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof', // RENDER
    symbol: 'RENDER',
    name: 'Render Token',
    decimals: 8,
    tier: 'silver',
  },
  {
    id: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', // PYTH
    symbol: 'PYTH',
    name: 'Pyth Network',
    decimals: 6,
    tier: 'gold',
  },
];

// Generate a fake Solana address
function fakePubkey(): string {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 44; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function seedTestData() {
  console.log('🌱 Seeding test data for Jupiter rotation test...\n');

  // 1. Create/update test tokens
  console.log('📦 Creating test tokens...');
  for (const token of TEST_TOKENS) {
    await prisma.token.upsert({
      where: { id: token.id },
      update: { enabled: true },
      create: {
        id: token.id,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        tier: token.tier,
        poolAddress: fakePubkey(),
        enabled: true,
      },
    });
    console.log(`   ✅ ${token.symbol} (${token.id.slice(0, 8)}...)`);
  }

  // 2. Create fake loans (one per token)
  console.log('\n💰 Creating test loans...');
  
  const now = new Date();
  const dueAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
  
  for (const token of TEST_TOKENS) {
    const loanId = fakePubkey();
    const borrower = fakePubkey();
    
    // Random loan parameters
    const collateralAmount = (Math.random() * 1000000 + 100000).toFixed(0);
    const solBorrowed = (Math.random() * 5 + 0.5).toFixed(9);
    const entryPrice = (Math.random() * 0.001 + 0.0001).toFixed(12);
    const liquidationPrice = (parseFloat(entryPrice) * 0.7).toFixed(12);
    
    try {
      await prisma.loan.create({
        data: {
          id: loanId,
          borrower,
          tokenMint: token.id,
          collateralAmount,
          solBorrowed,
          entryPrice,
          liquidationPrice,
          status: 'active',
          createdAt: now,
          dueAt,
        },
      });
      console.log(`   ✅ Loan for ${token.symbol}: ${loanId.slice(0, 8)}...`);
    } catch (error: any) {
      if (error.code === 'P2002') {
        console.log(`   ⏭️  Loan already exists for ${token.symbol}`);
      } else {
        throw error;
      }
    }
  }

  // 3. Show summary
  const loanCount = await prisma.loan.count({ where: { status: 'active' } });
  const tokenCount = await prisma.token.count({ where: { enabled: true } });
  
  console.log('\n📊 Summary:');
  console.log(`   Tokens: ${tokenCount}`);
  console.log(`   Active Loans: ${loanCount}`);
  
  console.log('\n✅ Test data seeded successfully!');
}

async function cleanup() {
  console.log('\n🧹 Cleaning up test data...');
  
  const deleted = await prisma.loan.deleteMany({
    where: {
      tokenMint: { in: TEST_TOKENS.map(t => t.id) },
    },
  });
  console.log(`   Deleted ${deleted.count} test loans`);
  
  console.log('✅ Cleanup complete');
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--cleanup')) {
    await cleanup();
  } else {
    await seedTestData();
  }
  
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});