import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../db/client.js';
import { telegramVerificationService } from './telegram-verification.service.js';
import { securityMonitor } from './security-monitor.service.js';
import { manualWhitelistService } from './manual-whitelist.service.js';
import { tokenVerificationService } from './token-verification.service.js';
import type {
  CreateVerificationRequestInput,
  CreateVerificationRequestResponse,
  ReviewVerificationRequestInput,
  VerificationRequest,
  VerificationRequestStatus,
} from '@memecoin-lending/types';
import { TokenTier } from '@memecoin-lending/types';

export class VerificationRequestService {
  // Rate limiting: 1 request per wallet per hour
  private requestRateLimit = new Map<string, number>();
  private readonly RATE_LIMIT_MS = 60 * 60 * 1000; // 1 hour
  
  // Auto-expire requests after 48 hours
  private readonly EXPIRY_MS = 48 * 60 * 60 * 1000;
  
  async createRequest(
    input: CreateVerificationRequestInput
  ): Promise<CreateVerificationRequestResponse> {
    try {
      // Check rate limit
      const lastRequest = this.requestRateLimit.get(input.requestedBy);
      if (lastRequest && Date.now() - lastRequest < this.RATE_LIMIT_MS) {
        const waitTime = Math.ceil((this.RATE_LIMIT_MS - (Date.now() - lastRequest)) / 1000 / 60);
        return {
          success: false,
          error: `Please wait ${waitTime} minutes before requesting another verification`,
        };
      }
      
      // Check if token is already whitelisted
      const isWhitelisted = await manualWhitelistService.isWhitelisted(input.mint);
      if (isWhitelisted) {
        return {
          success: false,
          error: 'This token is already whitelisted',
        };
      }
      
      // Check if there's already a pending request for this token
      const existingRequest = await prisma.verificationRequest.findFirst({
        where: {
          mint: input.mint,
          status: 'pending',
        },
      });
      
      if (existingRequest) {
        return {
          success: false,
          error: 'A verification request for this token is already pending',
          alreadyRequested: true,
        };
      }
      
      // Get token info for the Telegram notification
      let tokenInfo: any = null;
      try {
        const verificationResult = await tokenVerificationService.verifyToken(input.mint);
        if (verificationResult.isValid && verificationResult.tokenData) {
          tokenInfo = {
            symbol: verificationResult.tokenData.symbol,
            name: verificationResult.tokenData.name,
            poolAddress: verificationResult.poolInfo?.poolAddress,
            liquidity: verificationResult.poolInfo?.liquidity,
            marketCap: verificationResult.poolInfo?.marketCap,
          };
        }
      } catch (error) {
        console.error('Failed to fetch token info:', error);
      }
      
      // Create the request
      const request = await prisma.verificationRequest.create({
        data: {
          id: uuidv4(),
          mint: input.mint,
          requestedBy: input.requestedBy,
          reason: input.reason,
          status: 'pending',
        },
      });
      
      // Update rate limit
      this.requestRateLimit.set(input.requestedBy, Date.now());
      
      // Send Telegram notification
      const telegramMessageId = await telegramVerificationService.sendVerificationRequest({
        ...request,
        status: 'pending' as VerificationRequestStatus,
        createdAt: request.createdAt.getTime(),
        updatedAt: request.updatedAt.getTime(),
        reviewedAt: request.reviewedAt ? request.reviewedAt.getTime() : undefined,
        tokenInfo,
      });
      
      // Update request with Telegram message ID if sent
      if (telegramMessageId) {
        await prisma.verificationRequest.update({
          where: { id: request.id },
          data: { telegramMessageId },
        });
      }
      
      // Log security event
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'TokenVerification',
        eventType: 'VERIFICATION_REQUEST_CREATED',
        message: 'Manual token verification requested',
        details: {
          requestId: request.id,
          mint: input.mint,
          requestedBy: input.requestedBy,
          reason: input.reason,
          telegramSent: !!telegramMessageId,
        },
        source: 'verification-request-service',
        userId: input.requestedBy,
      });
      
      // Clean up old rate limit entries
      this.cleanupRateLimits();
      
      return {
        success: true,
        requestId: request.id,
      };
    } catch (error) {
      console.error('Failed to create verification request:', error);
      
      await securityMonitor.log({
        severity: 'HIGH',
        category: 'TokenVerification',
        eventType: 'VERIFICATION_REQUEST_FAILED',
        message: 'Failed to create verification request',
        details: {
          mint: input.mint,
          requestedBy: input.requestedBy,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        source: 'verification-request-service',
        userId: input.requestedBy,
      });
      
      return {
        success: false,
        error: 'Failed to create verification request',
      };
    }
  }
  
  async reviewRequest(input: ReviewVerificationRequestInput): Promise<boolean> {
    try {
      const request = await prisma.verificationRequest.findUnique({
        where: { id: input.requestId },
      });
      
      if (!request) {
        throw new Error('Request not found');
      }
      
      if (request.status !== 'pending') {
        throw new Error('Request has already been reviewed');
      }
      
      // Update the request
      const updatedRequest = await prisma.verificationRequest.update({
        where: { id: input.requestId },
        data: {
          status: input.action === 'approve' ? 'approved' : 'rejected',
          adminResponse: input.adminResponse,
          reviewedBy: input.reviewedBy,
          reviewedAt: new Date(),
        },
      });
      
      // If approved, add to manual whitelist
      if (input.action === 'approve' && input.tier) {
        const tierConfig = {
          bronze: { ltvBps: 6000, minLoan: '100000000', maxLoan: '5000000000' }, // 0.1 to 5 SOL
          silver: { ltvBps: 7000, minLoan: '100000000', maxLoan: '10000000000' }, // 0.1 to 10 SOL
          gold: { ltvBps: 8000, minLoan: '100000000', maxLoan: '20000000000' }, // 0.1 to 20 SOL
        }[input.tier as 'bronze' | 'silver' | 'gold'];
        
        if (tierConfig) {
          await manualWhitelistService.addToWhitelist({
            mint: request.mint,
            tier: input.tier as TokenTier,
            ltvBps: tierConfig.ltvBps,
            minLoanAmount: tierConfig.minLoan,
            maxLoanAmount: tierConfig.maxLoan,
            reason: `Approved via verification request: ${request.reason || 'No reason provided'}`,
            notes: input.adminResponse,
          }, input.reviewedBy);
        }
      }
      
      // Update Telegram message if exists
      if (request.telegramMessageId) {
        await telegramVerificationService.updateVerificationMessage(
          request.telegramMessageId,
          {
            ...updatedRequest,
            status: updatedRequest.status as VerificationRequestStatus,
            createdAt: updatedRequest.createdAt.getTime(),
            updatedAt: updatedRequest.updatedAt.getTime(),
            reviewedAt: updatedRequest.reviewedAt?.getTime(),
          },
          input.action,
          input.tier
        );
      }
      
      // Log security event
      await securityMonitor.log({
        severity: input.action === 'approve' ? 'MEDIUM' : 'LOW',
        category: 'TokenVerification',
        eventType: `VERIFICATION_REQUEST_${input.action.toUpperCase()}ED`,
        message: `Token verification request ${input.action}ed`,
        details: {
          requestId: input.requestId,
          mint: request.mint,
          requestedBy: request.requestedBy,
          reviewedBy: input.reviewedBy,
          tier: input.tier,
          adminResponse: input.adminResponse,
        },
        source: 'verification-request-service',
        userId: input.reviewedBy,
      });
      
      return true;
    } catch (error) {
      console.error('Failed to review verification request:', error);
      
      await securityMonitor.log({
        severity: 'HIGH',
        category: 'TokenVerification',
        eventType: 'VERIFICATION_REVIEW_FAILED',
        message: 'Failed to review verification request',
        details: {
          requestId: input.requestId,
          action: input.action,
          reviewedBy: input.reviewedBy,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        source: 'verification-request-service',
        userId: input.reviewedBy,
      });
      
      return false;
    }
  }
  
  async getPendingRequests(): Promise<VerificationRequest[]> {
    const requests = await prisma.verificationRequest.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
    
    return requests.map(r => ({
      ...r,
      status: r.status as VerificationRequestStatus,
      createdAt: r.createdAt.getTime(),
      updatedAt: r.updatedAt.getTime(),
      reviewedAt: r.reviewedAt?.getTime(),
    }));
  }
  
  async getUserRequests(wallet: string): Promise<VerificationRequest[]> {
    const requests = await prisma.verificationRequest.findMany({
      where: { requestedBy: wallet },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    
    return requests.map(r => ({
      ...r,
      status: r.status as VerificationRequestStatus,
      createdAt: r.createdAt.getTime(),
      updatedAt: r.updatedAt.getTime(),
      reviewedAt: r.reviewedAt?.getTime(),
    }));
  }
  
  async expireOldRequests(): Promise<number> {
    const expiryDate = new Date(Date.now() - this.EXPIRY_MS);
    
    const result = await prisma.verificationRequest.updateMany({
      where: {
        status: 'pending',
        createdAt: { lt: expiryDate },
      },
      data: {
        status: 'expired',
        updatedAt: new Date(),
      },
    });
    
    if (result.count > 0) {
      await securityMonitor.log({
        severity: 'LOW',
        category: 'TokenVerification',
        eventType: 'VERIFICATION_REQUESTS_EXPIRED',
        message: `Expired ${result.count} old verification requests`,
        details: {
          count: result.count,
          expiryHours: this.EXPIRY_MS / 1000 / 60 / 60,
        },
        source: 'verification-request-service',
      });
    }
    
    return result.count;
  }
  
  private cleanupRateLimits() {
    const now = Date.now();
    for (const [wallet, timestamp] of this.requestRateLimit.entries()) {
      if (now - timestamp > this.RATE_LIMIT_MS) {
        this.requestRateLimit.delete(wallet);
      }
    }
  }
}

// Export singleton instance
export const verificationRequestService = new VerificationRequestService();