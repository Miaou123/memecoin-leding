#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { PublicKey } from '@solana/web3.js';

// This script updates the deployment JSON with staking configuration

const network = process.argv[2] || 'mainnet';
const stakingTokenMint = process.argv[3];

if (!stakingTokenMint) {
  console.error('Usage: ts-node update-deployment-staking.ts <network> <staking-token-mint>');
  console.error('Example: ts-node update-deployment-staking.ts mainnet YOUR_TOKEN_MINT_ADDRESS');
  process.exit(1);
}

// Validate the mint address
try {
  new PublicKey(stakingTokenMint);
} catch (e) {
  console.error('Invalid token mint address:', stakingTokenMint);
  process.exit(1);
}

const deploymentPath = path.join(__dirname, '..', 'deployments', `${network}-latest.json`);

if (!fs.existsSync(deploymentPath)) {
  console.error(`Deployment file not found: ${deploymentPath}`);
  process.exit(1);
}

// Load existing deployment
const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));

// Add staking configuration
deployment.staking = {
  stakingTokenMint,
  stakingPool: null, // Will be set when staking is initialized
  stakingVault: null, // Will be set when staking is initialized
  stakingVaultAuthority: null, // Will be derived from PDA
  rewardVault: deployment.pdas?.rewardVault || null,
  initialized: false,
  epochDuration: 300, // 5 minutes default
};

// Save updated deployment
fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));

console.log(`✅ Updated ${network} deployment with staking token: ${stakingTokenMint}`);
console.log('Note: You still need to initialize the staking pool on-chain');
console.log('The stakingPool and stakingVault addresses will be populated after initialization');