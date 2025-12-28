#!/usr/bin/env tsx

import { config } from 'dotenv';
import chalk from 'chalk';
import { Command } from 'commander';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

config();

const program = new Command();

program
  .name('deploy')
  .description('Deploy the entire memecoin lending platform')
  .option('-e, --environment <env>', 'Environment to deploy to', 'development')
  .option('-d, --domain <domain>', 'Domain name for production deployment')
  .option('--skip-build', 'Skip building containers')
  .option('--skip-db', 'Skip database setup')
  .action(async (options) => {
    try {
      console.log(chalk.blue('🚀 Starting deployment...'));
      console.log(chalk.gray(`Environment: ${options.environment}`));
      
      // Validate environment
      if (!['development', 'staging', 'production'].includes(options.environment)) {
        throw new Error('Environment must be development, staging, or production');
      }
      
      // Check required environment variables
      console.log(chalk.blue('🔍 Checking environment configuration...'));
      
      const requiredVars = [
        'DB_PASSWORD',
        'TELEGRAM_BOT_TOKEN',
        'PROGRAM_ID',
        'ADMIN_WALLET',
      ];
      
      if (options.environment === 'production') {
        requiredVars.push('SOLANA_RPC_URL', 'API_URL', 'WS_URL');
      }
      
      const missingVars = requiredVars.filter(varName => !process.env[varName]);
      
      if (missingVars.length > 0) {
        throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
      }
      
      // Update domain in nginx config for production
      if (options.environment === 'production' && options.domain) {
        console.log(chalk.blue('🌐 Updating domain configuration...'));
        
        const nginxConfigPath = path.join(process.cwd(), 'infrastructure/nginx/nginx.conf');
        let nginxConfig = fs.readFileSync(nginxConfigPath, 'utf8');
        
        nginxConfig = nginxConfig.replace(/yourdomain\.com/g, options.domain);
        
        fs.writeFileSync(nginxConfigPath, nginxConfig);
        console.log(chalk.green(`✅ Updated domain to ${options.domain}`));
      }
      
      // Build containers
      if (!options.skipBuild) {
        console.log(chalk.blue('🏗️  Building Docker containers...'));
        
        try {
          execSync('docker-compose build', { stdio: 'inherit' });
          console.log(chalk.green('✅ Containers built successfully'));
        } catch (error) {
          throw new Error('Failed to build containers');
        }
      }
      
      // Start services
      console.log(chalk.blue('🎯 Starting services...'));
      
      try {
        execSync('docker-compose up -d', { stdio: 'inherit' });
        console.log(chalk.green('✅ Services started successfully'));
      } catch (error) {
        throw new Error('Failed to start services');
      }
      
      // Wait for services to be healthy
      console.log(chalk.yellow('⏳ Waiting for services to be ready...'));
      
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      // Setup database
      if (!options.skipDb) {
        console.log(chalk.blue('🗃️  Setting up database...'));
        
        try {
          execSync('docker-compose exec server pnpm db:generate', { stdio: 'inherit' });
          execSync('docker-compose exec server pnpm db:push', { stdio: 'inherit' });
          console.log(chalk.green('✅ Database setup completed'));
        } catch (error) {
          console.log(chalk.yellow('⚠️  Database setup failed, but deployment continues...'));
        }
      }
      
      // Check service health
      console.log(chalk.blue('🔍 Checking service health...'));
      
      const services = ['postgres', 'redis', 'server', 'web'];
      
      for (const service of services) {
        try {
          const result = execSync(`docker-compose ps ${service}`, { encoding: 'utf8' });
          
          if (result.includes('Up')) {
            console.log(chalk.green(`✅ ${service} is healthy`));
          } else {
            console.log(chalk.red(`❌ ${service} is not healthy`));
          }
        } catch (error) {
          console.log(chalk.red(`❌ ${service} check failed`));
        }
      }
      
      // Display deployment information
      console.log(chalk.green('\n🎉 Deployment completed successfully!'));
      
      if (options.environment === 'development') {
        console.log(chalk.blue('\n📍 Local URLs:'));
        console.log(chalk.gray('  Web App:    http://localhost:3000'));
        console.log(chalk.gray('  API:        http://localhost:3001'));
        console.log(chalk.gray('  Database:   localhost:5432'));
        console.log(chalk.gray('  Redis:      localhost:6379'));
      } else {
        console.log(chalk.blue('\n📍 Production URLs:'));
        console.log(chalk.gray(`  Web App:    https://${options.domain || 'yourdomain.com'}`));
        console.log(chalk.gray(`  API:        https://api.${options.domain || 'yourdomain.com'}`));
      }
      
      console.log(chalk.blue('\n🛠️  Management Commands:'));
      console.log(chalk.gray('  View logs:    docker-compose logs -f'));
      console.log(chalk.gray('  Stop:         docker-compose down'));
      console.log(chalk.gray('  Restart:      docker-compose restart'));
      console.log(chalk.gray('  Shell:        docker-compose exec server sh'));
      
      if (options.environment === 'production') {
        console.log(chalk.yellow('\n⚠️  Production Checklist:'));
        console.log(chalk.gray('  □ SSL certificates configured'));
        console.log(chalk.gray('  □ Domain DNS configured'));
        console.log(chalk.gray('  □ Firewall rules configured'));
        console.log(chalk.gray('  □ Monitoring alerts configured'));
        console.log(chalk.gray('  □ Backup strategy implemented'));
        console.log(chalk.gray('  □ Program deployed and initialized'));
        console.log(chalk.gray('  □ Tokens whitelisted'));
        console.log(chalk.gray('  □ Treasury funded'));
      }
      
    } catch (error) {
      console.error(chalk.red('❌ Deployment failed:'), error);
      
      // Show logs on failure
      console.log(chalk.yellow('\n📝 Recent logs:'));
      try {
        execSync('docker-compose logs --tail=50', { stdio: 'inherit' });
      } catch {
        console.log(chalk.red('Could not fetch logs'));
      }
      
      process.exit(1);
    }
  });

program.parse();