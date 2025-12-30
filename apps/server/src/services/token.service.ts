import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { TokenStats, TokenTier } from '@memecoin-lending/types';
import { prisma } from '../db/client.js';
import { priceService } from './price.service.js';

class TokenService {
  async getTokenStats(mint: string): Promise<TokenStats> {
    const token = await prisma.token.findUnique({
      where: { id: mint },
    });
    
    if (!token) {
      throw new Error('Token not found');
    }
    
    // Get current price and 24h change
    const currentPrice = await priceService.getCurrentPrice(mint);
    const price24hAgo = await priceService.getPrice24hAgo(mint);
    const priceChange24h = price24hAgo 
      ? ((parseFloat(currentPrice.price) - parseFloat(price24hAgo.price)) / parseFloat(price24hAgo.price)) * 100
      : 0;
    
    // Get loan statistics
    const [totalLoans, activeLoans, loans] = await Promise.all([
      prisma.loan.count({
        where: { tokenMint: mint },
      }),
      prisma.loan.count({
        where: { 
          tokenMint: mint,
          status: 'active',
        },
      }),
      prisma.loan.findMany({
        where: { tokenMint: mint },
        select: { solBorrowed: true },
      }),
    ]);

    // Manually sum string values
    const totalBorrowed = loans.reduce((sum, loan) => {
      return sum + BigInt(loan.solBorrowed || '0');
    }, BigInt(0)).toString();
    
    // Calculate available liquidity (this would come from treasury in reality)
    // For now, use a placeholder
    const availableLiquidity = '1000000000000'; // 1000 SOL
    
    return {
      mint: token.id,
      symbol: token.symbol,
      name: token.name,
      currentPrice: currentPrice.price,
      priceChange24h,
      totalLoans,
      activeLoans,
      totalBorrowed,
      availableLiquidity,
    };
  }
  
  async getTokenLiquidity(mint: string): Promise<any> {
    const token = await prisma.token.findUnique({
      where: { id: mint },
    });
    
    if (!token) {
      throw new Error('Token not found');
    }
    
    // TODO: Implement real pool data fetching from AMM
    throw new Error('Pool data not available - real implementation required');
  }
  
  async updateTokenTier(mint: string, tier: TokenTier): Promise<void> {
    await prisma.token.update({
      where: { id: mint },
      data: { tier },
    });
  }
  
  async getWhitelistedTokens(): Promise<TokenStats[]> {
    const tokens = await prisma.token.findMany({
      where: { enabled: true },
      orderBy: { tier: 'asc' },
    });
    
    const stats = await Promise.all(
      tokens.map((token: any) => this.getTokenStats(token.id))
    );
    
    return stats;
  }
  
  async isTokenWhitelisted(mint: string): Promise<boolean> {
    const token = await prisma.token.findUnique({
      where: { id: mint },
    });
    
    return token?.enabled || false;
  }
  
  async getTokenBySymbol(symbol: string): Promise<any> {
    return prisma.token.findFirst({
      where: { 
        symbol: {
          equals: symbol,
          mode: 'insensitive',
        },
      },
    });
  }
}

export const tokenService = new TokenService();