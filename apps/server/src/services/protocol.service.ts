import { PublicKey, Connection, Keypair } from '@solana/web3.js';
import BN from 'bn.js';
import fs from 'fs';
import path from 'path';
import { ProtocolStats } from '@memecoin-lending/types';
import { MemecoinLendingClient } from '@memecoin-lending/sdk';
import { PROGRAM_ID, getNetworkConfig, getCurrentNetwork, NetworkType } from '@memecoin-lending/config';
import { prisma } from '../db/client.js';

class ProtocolService {
  private client: MemecoinLendingClient | null = null;
  
  private async getClient(): Promise<MemecoinLendingClient> {
    if (!this.client) {
      const networkConfig = getNetworkConfig(getCurrentNetwork());
      const connection = new Connection(networkConfig.rpcUrl, 'confirmed');
      
      // Load wallet from file
      const keypairPath = path.resolve(process.env.ADMIN_KEYPAIR_PATH || '../../scripts/keys/admin.json');
      const keyData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
      const wallet = Keypair.fromSecretKey(Uint8Array.from(keyData));
      
      // Load IDL from target folder
      const idlPath = path.resolve('../../target/idl/memecoin_lending.json');
      const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
      
      const programId = typeof PROGRAM_ID === 'string' 
        ? new PublicKey(PROGRAM_ID) 
        : PROGRAM_ID;
      
      this.client = new MemecoinLendingClient(
        connection,
        wallet as any,
        programId,
        idl
      );
    }
    return this.client;
  }
  
  async getProtocolStats(): Promise<ProtocolStats> {
    const client = await this.getClient();
    
    // Get on-chain protocol state
    const protocolState = await client.getProtocolState();
    
    // Get treasury balance separately (no longer on ProtocolState)
    const treasuryBalance = await this.getTreasuryBalance();
    
    // Get 24h volume
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const loans24h = await prisma.loan.findMany({
      where: {
        createdAt: { gte: yesterday },
      },
      select: { solBorrowed: true },
    });

    // Manually sum string values
    const volume24h = loans24h.reduce((sum, loan) => {
      return sum + BigInt(loan.solBorrowed || '0');
    }, BigInt(0)).toString();
    
    // Get 24h liquidations
    const liquidations24h = await prisma.loan.count({
      where: {
        liquidatedAt: { gte: yesterday },
      },
    });
    
    // Get active loans count
    const totalLoansActive = await prisma.loan.count({
      where: { status: 'active' },
    });
    
    // Update cached stats
    await prisma.protocolStats.upsert({
      where: { id: 'current' },
      create: {
        id: 'current',
        totalValueLocked: treasuryBalance,
        totalLoansActive,
        totalLoansCreated: parseInt(protocolState.totalLoansCreated),
        totalInterestEarned: protocolState.totalInterestEarned,
        treasuryBalance: treasuryBalance,
        volume24h: volume24h,
        liquidations24h,
      },
      update: {
        totalValueLocked: treasuryBalance,
        totalLoansActive,
        totalLoansCreated: parseInt(protocolState.totalLoansCreated),
        totalInterestEarned: protocolState.totalInterestEarned,
        treasuryBalance: treasuryBalance,
        volume24h: volume24h,
        liquidations24h,
      },
    });
    
    return {
      totalValueLocked: treasuryBalance,
      totalLoansActive,
      totalLoansCreated: parseInt(protocolState.totalLoansCreated),
      totalInterestEarned: protocolState.totalInterestEarned,
      treasuryBalance: treasuryBalance,
      volume24h: volume24h,
      liquidations24h,
    };
  }
  
  async getTreasuryBalance(): Promise<string> {
    const client = await this.getClient();
    const [treasury] = client.getTreasuryPDA();
    
    const balance = await client.connection.getBalance(treasury);
    return balance.toString();
  }
  
  async getProtocolConfig(): Promise<any> {
    const client = await this.getClient();
    const protocolState = await client.getProtocolState();
    
    return {
      admin: protocolState.admin,
      paused: protocolState.paused,
      programId: PROGRAM_ID.toString(),
      fees: {
        protocolFeeBps: protocolState.protocolFeeBps,
        treasuryFeeBps: protocolState.treasuryFeeBps,
        buybackFeeBps: protocolState.buybackFeeBps,
        operationsFeeBps: protocolState.operationsFeeBps,
      },
    };
  }
  
  async pauseProtocol(): Promise<void> {
    const client = await this.getClient();
    await client.pauseProtocol();
  }
  
  async resumeProtocol(): Promise<void> {
    const client = await this.getClient();
    await client.resumeProtocol();
  }
  
  async whitelistToken(params: {
    mint: string;
    tier: string;
    poolAddress: string;
    poolType?: number;
    minLoanAmount?: string;
    maxLoanAmount?: string;
    symbol: string;
    name: string;
    decimals: number;
  }): Promise<void> {
    const client = await this.getClient();
    
    // Whitelist on-chain
    const tierMap = {
      bronze: 0,
      silver: 1,
      gold: 2,
    };
    
    // Pool type: 0=Raydium, 1=Orca, 2=Pumpfun, 3=PumpSwap
    const poolType = params.poolType ?? 0;
    
    // Default loan amounts (in lamports)
    const minLoanAmount = new BN(params.minLoanAmount || String(0.1 * 1e9)); // 0.1 SOL
    const maxLoanAmount = new BN(params.maxLoanAmount || String(100 * 1e9)); // 100 SOL
    
    await client.whitelistToken({
      mint: new PublicKey(params.mint),
      tier: tierMap[params.tier as keyof typeof tierMap],
      poolAddress: new PublicKey(params.poolAddress),
      poolType,
      minLoanAmount,
      maxLoanAmount,
    });
    
    // Save to database
    await prisma.token.upsert({
      where: { id: params.mint },
      create: {
        id: params.mint,
        symbol: params.symbol,
        name: params.name,
        decimals: params.decimals,
        tier: params.tier,
        poolAddress: params.poolAddress,
        enabled: true,
      },
      update: {
        tier: params.tier,
        poolAddress: params.poolAddress,
        enabled: true,
      },
    });
  }
  
  async updateTokenConfig(params: {
    mint: string;
    enabled?: boolean;
    ltvBps?: number;
    interestRateBps?: number;
  }): Promise<void> {
    const client = await this.getClient();
    
    // Update on-chain
    await client.updateTokenConfig({
      mint: new PublicKey(params.mint),
      enabled: params.enabled,
      ltvBps: params.ltvBps,
      interestRateBps: params.interestRateBps,
    });
    
    // Update database if enabled status changed
    if (params.enabled !== undefined) {
      await prisma.token.update({
        where: { id: params.mint },
        data: { enabled: params.enabled },
      });
    }
  }
  
  async withdrawTreasury(amount: string): Promise<string> {
    const client = await this.getClient();
    const txSignature = await client.withdrawTreasury(new BN(amount));
    return txSignature;
  }
}

export const protocolService = new ProtocolService();