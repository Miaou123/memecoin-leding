#!/usr/bin/env tsx

import { config } from 'dotenv';
import chalk from 'chalk';
import { Command } from 'commander';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { Keypair } from '@solana/web3.js';

config();

const program = new Command();

program
  .name('setup-dev')
  .description('Set up development environment')
  .option('--clean', 'Clean existing setup')
  .action(async (options) => {
    try {
      console.log(chalk.blue('🛠️  Setting up development environment...'));
      
      // Clean existing setup if requested
      if (options.clean) {
        console.log(chalk.yellow('🧹 Cleaning existing setup...'));
        try {
          execSync('docker-compose down -v', { stdio: 'inherit' });
          console.log(chalk.green('✅ Existing containers and volumes removed'));
        } catch (error) {
          console.log(chalk.yellow('⚠️  No existing containers to clean'));
        }
      }
      
      // Create keys directory
      console.log(chalk.blue('🔑 Generating keypairs...'));
      
      const keysDir = path.join(process.cwd(), 'keys');
      if (!fs.existsSync(keysDir)) {
        fs.mkdirSync(keysDir, { recursive: true });
      }
      
      // Generate keypairs if they don't exist
      const keypairs = ['admin', 'deployer', 'program', 'liquidator'];
      
      for (const name of keypairs) {
        const keyPath = path.join(keysDir, `${name}.json`);
        
        if (!fs.existsSync(keyPath)) {
          const keypair = Keypair.generate();
          fs.writeFileSync(
            keyPath,
            JSON.stringify(Array.from(keypair.secretKey), null, 2)
          );
          console.log(chalk.green(`✅ Generated ${name} keypair: ${keypair.publicKey.toString()}`));
        } else {
          const existingKeypair = Keypair.fromSecretKey(
            Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, 'utf8')))
          );
          console.log(chalk.gray(`📄 Using existing ${name} keypair: ${existingKeypair.publicKey.toString()}`));
        }
      }
      
      // Set file permissions
      execSync('chmod 600 keys/*.json', { stdio: 'inherit' });
      
      // Create .env file if it doesn't exist
      const envPath = path.join(process.cwd(), '.env');
      
      if (!fs.existsSync(envPath)) {
        console.log(chalk.blue('📝 Creating .env file...'));
        
        const adminKeypair = Keypair.fromSecretKey(
          Uint8Array.from(JSON.parse(fs.readFileSync(path.join(keysDir, 'admin.json'), 'utf8')))
        );
        
        const liquidatorKeypair = Keypair.fromSecretKey(
          Uint8Array.from(JSON.parse(fs.readFileSync(path.join(keysDir, 'liquidator.json'), 'utf8')))
        );
        
        const programKeypair = Keypair.fromSecretKey(
          Uint8Array.from(JSON.parse(fs.readFileSync(path.join(keysDir, 'program.json'), 'utf8')))
        );
        
        const envContent = `# Development Environment Configuration

# Database
DB_USER=memecoin
DB_PASSWORD=${generatePassword()}
DATABASE_URL=postgresql://memecoin:${generatePassword()}@localhost:5432/memecoin_lending

# Redis
REDIS_URL=redis://localhost:6379

# Solana
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
PROGRAM_ID=${programKeypair.publicKey.toString()}
ADMIN_WALLET=${adminKeypair.publicKey.toString()}
ADMIN_WALLET_PRIVATE_KEY=${JSON.stringify(Array.from(adminKeypair.secretKey))}
LIQUIDATOR_WALLET=${liquidatorKeypair.publicKey.toString()}

# API
API_URL=http://localhost:3001/api
WS_URL=ws://localhost:3001/ws
CORS_ORIGIN=http://localhost:3000

# Telegram (add your bot token)
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# Frontend
VITE_API_URL=http://localhost:3001/api
VITE_WS_URL=ws://localhost:3001/ws
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
VITE_PROGRAM_ID=${programKeypair.publicKey.toString()}
VITE_SOLANA_NETWORK=devnet

# Web App
WEB_APP_URL=http://localhost:3000
`;
        
        fs.writeFileSync(envPath, envContent);
        console.log(chalk.green('✅ Created .env file'));
      } else {
        console.log(chalk.gray('📄 Using existing .env file'));
      }
      
      // Install dependencies
      console.log(chalk.blue('📦 Installing dependencies...'));
      
      try {
        execSync('pnpm install', { stdio: 'inherit' });
        console.log(chalk.green('✅ Dependencies installed'));
      } catch (error) {
        throw new Error('Failed to install dependencies');
      }
      
      // Build packages
      console.log(chalk.blue('🏗️  Building packages...'));
      
      try {
        execSync('pnpm run build', { stdio: 'inherit' });
        console.log(chalk.green('✅ Packages built'));
      } catch (error) {
        console.log(chalk.yellow('⚠️  Some packages failed to build, but setup continues...'));
      }
      
      // Start development services
      console.log(chalk.blue('🎯 Starting development services...'));
      
      try {
        execSync('docker-compose up -d postgres redis', { stdio: 'inherit' });
        console.log(chalk.green('✅ Database and Redis started'));
      } catch (error) {
        throw new Error('Failed to start development services');
      }
      
      // Wait for services
      console.log(chalk.yellow('⏳ Waiting for services to be ready...'));
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Setup database
      console.log(chalk.blue('🗃️  Setting up database...'));
      
      try {
        execSync('pnpm --filter @memecoin-lending/server db:generate', { stdio: 'inherit' });
        execSync('pnpm --filter @memecoin-lending/server db:push', { stdio: 'inherit' });
        console.log(chalk.green('✅ Database schema created'));
      } catch (error) {
        console.log(chalk.yellow('⚠️  Database setup failed, you may need to run it manually'));
      }
      
      console.log(chalk.green('\n🎉 Development environment setup completed!'));
      
      console.log(chalk.blue('\n📍 Next Steps:'));
      console.log(chalk.gray('1. Update TELEGRAM_BOT_TOKEN in .env file'));
      console.log(chalk.gray('2. Get devnet SOL: solana airdrop 2 --keypair keys/admin.json'));
      console.log(chalk.gray('3. Deploy program: pnpm --filter scripts deploy-program'));
      console.log(chalk.gray('4. Initialize protocol: pnpm --filter scripts initialize-protocol'));
      console.log(chalk.gray('5. Start development servers:'));
      console.log(chalk.gray('   - Backend: pnpm --filter @memecoin-lending/server dev'));
      console.log(chalk.gray('   - Frontend: pnpm --filter @memecoin-lending/web dev'));
      console.log(chalk.gray('   - Bot: pnpm --filter @memecoin-lending/telegram-bot dev'));
      
      console.log(chalk.blue('\n🔧 Development URLs:'));
      console.log(chalk.gray('  Web App:    http://localhost:3000'));
      console.log(chalk.gray('  API:        http://localhost:3001'));
      console.log(chalk.gray('  Database:   postgresql://memecoin:password@localhost:5432/memecoin_lending'));
      console.log(chalk.gray('  Redis:      redis://localhost:6379'));
      
      console.log(chalk.blue('\n🛠️  Useful Commands:'));
      console.log(chalk.gray('  Build all:       pnpm run build'));
      console.log(chalk.gray('  Start all dev:   pnpm run dev'));
      console.log(chalk.gray('  Database reset:  pnpm --filter @memecoin-lending/server db:push --force-reset'));
      console.log(chalk.gray('  View logs:       docker-compose logs -f'));
      
    } catch (error) {
      console.error(chalk.red('❌ Development setup failed:'), error);
      process.exit(1);
    }
  });

function generatePassword(length: number = 16): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

program.parse();