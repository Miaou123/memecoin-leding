import { Connection, PublicKey, Keypair, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider, Program, Idl, Wallet } from '@coral-xyz/anchor';
import BN from 'bn.js';
import {
  ProtocolState,
  TokenConfig,
  Loan,
  LoanStatus,
  CreateLoanParams,
  LoanTermsParams,
  LoanTerms,
  TokenVerificationResult,
  GetPumpFunTokensResponse,
  CanCreateLoanResponse,
  ManualWhitelistEntry,
  CreateWhitelistEntryRequest,
  UpdateWhitelistEntryRequest,
  GetWhitelistEntriesRequest,
  GetWhitelistEntriesResponse,
  WhitelistStats,
  WhitelistAuditLog,
} from '@memecoin-lending/types';
import { PROGRAM_ID, API_ENDPOINTS } from '@memecoin-lending/config';
import * as instructions from './instructions';
import * as accounts from './accounts';
import * as pda from './pda';
import { calculateLoanTerms } from './utils';
import { PriceClient, PriceData } from './price';

export interface AnchorWallet {
  publicKey: PublicKey;
  signTransaction: any;
  signAllTransactions: any;
}

export class MemecoinLendingClient {
  readonly connection: Connection;
  readonly wallet: AnchorWallet;
  readonly programId: PublicKey;
  readonly provider: AnchorProvider;
  readonly program: Program;
  readonly priceClient: PriceClient;
  private apiEndpoint: string;

  constructor(
    connection: Connection,
    wallet: AnchorWallet,
    programId: PublicKey = PROGRAM_ID,
    idl?: Idl,
    apiEndpoint?: string
  ) {
    this.connection = connection;
    this.wallet = wallet;
    this.programId = programId;
    this.provider = new AnchorProvider(connection, wallet, {
      commitment: 'confirmed',
    });
    
    if (!idl) {
      throw new Error('IDL is required for SDK initialization');
    }
    
    this.program = new Program(idl, this.provider);
    this.apiEndpoint = apiEndpoint || API_ENDPOINTS.DEFAULT_API_BASE_URL;
    this.priceClient = new PriceClient(apiEndpoint);
  }

  // PDA derivations
  getProtocolStatePDA(): [PublicKey, number] {
    return pda.getProtocolStatePDA(this.programId);
  }

  getTreasuryPDA(): [PublicKey, number] {
    return pda.getTreasuryPDA(this.programId);
  }

  getTokenConfigPDA(mint: PublicKey): [PublicKey, number] {
    return pda.getTokenConfigPDA(mint, this.programId);
  }

  getLoanPDA(borrower: PublicKey, mint: PublicKey, index: BN): [PublicKey, number] {
    return pda.getLoanPDA(borrower, mint, index, this.programId);
  }

  // Instructions
  async initializeProtocol(
    admin?: PublicKey,
    buybackWallet?: PublicKey,
    operationsWallet?: PublicKey
  ): Promise<TransactionSignature> {
    return instructions.initializeProtocol(
      this.program,
      admin || this.wallet.publicKey,
      buybackWallet || this.wallet.publicKey,
      operationsWallet || this.wallet.publicKey
    );
  }

  async whitelistToken(params: {
    mint: PublicKey;
    tier: number;
    poolAddress: PublicKey;
    poolType: number;
    minLoanAmount: BN;
    maxLoanAmount: BN;
  }): Promise<TransactionSignature> {
    return instructions.whitelistToken(this.program, params);
  }

  async createLoan(params: CreateLoanParams): Promise<TransactionSignature> {
    const mint = new PublicKey(params.tokenMint);
    const borrower = params.borrower 
      ? new PublicKey(params.borrower) 
      : this.wallet.publicKey;
    
    return instructions.createLoan(this.program, {
      tokenMint: mint,
      collateralAmount: new BN(params.collateralAmount),
      durationSeconds: new BN(params.durationSeconds),
      borrower,
    });
  }

  async repayLoan(loanPubkey: PublicKey): Promise<TransactionSignature> {
    return instructions.repayLoan(this.program, loanPubkey);
  }

  async liquidate(loanPubkey: PublicKey): Promise<TransactionSignature> {
    return instructions.liquidate(this.program, loanPubkey);
  }

  async updateTokenConfig(params: {
    mint: PublicKey;
    enabled?: boolean;
    ltvBps?: number;
  }): Promise<TransactionSignature> {
    return instructions.updateTokenConfig(this.program, params);
  }

  async pauseProtocol(): Promise<TransactionSignature> {
    return instructions.pauseProtocol(this.program);
  }

  async resumeProtocol(): Promise<TransactionSignature> {
    return instructions.resumeProtocol(this.program);
  }

  async withdrawTreasury(amount: BN): Promise<TransactionSignature> {
    return instructions.withdrawTreasury(this.program, amount);
  }

  async fundTreasury(amount: BN): Promise<TransactionSignature> {
    return instructions.fundTreasury(this.program, amount);
  }

  async updateFees(params: {
    protocolFeeBps?: number;
    treasuryFeeBps?: number;
    buybackFeeBps?: number;
    operationsFeeBps?: number;
  }): Promise<TransactionSignature> {
    return instructions.updateFees(this.program, params);
  }

  async updateWallets(params: {
    newAdmin?: PublicKey;
    newBuybackWallet?: PublicKey;
    newOperationsWallet?: PublicKey;
  }): Promise<TransactionSignature> {
    return instructions.updateWallets(this.program, params);
  }

  async initializeStaking(
    stakingTokenMint: PublicKey,
    epochDuration: BN
  ): Promise<TransactionSignature> {
    return instructions.initializeStaking(
      this.program,
      stakingTokenMint,
      epochDuration
    );
  }

  async initializeFeeReceiver(
    treasuryWallet: PublicKey,
    operationsWallet: PublicKey,
    treasurySplitBps: number,
    stakingSplitBps: number,
    operationsSplitBps: number
  ): Promise<TransactionSignature> {
    return instructions.initializeFeeReceiver(
      this.program,
      treasuryWallet,
      operationsWallet,
      treasurySplitBps,
      stakingSplitBps,
      operationsSplitBps
    );
  }


  // Account fetchers
  async getProtocolState(): Promise<ProtocolState> {
    return accounts.getProtocolState(this.program);
  }

  async getTokenConfig(mint: PublicKey): Promise<TokenConfig | null> {
    return accounts.getTokenConfig(this.program, mint);
  }

  async getLoan(loanPubkey: PublicKey): Promise<Loan | null> {
    return accounts.getLoan(this.program, loanPubkey);
  }

  async getAllLoans(): Promise<Loan[]> {
    return accounts.getAllLoans(this.program);
  }

  async getActiveLoans(): Promise<Loan[]> {
    return accounts.getActiveLoans(this.program);
  }

  async getLoansByBorrower(borrower: PublicKey): Promise<Loan[]> {
    return accounts.getLoansByBorrower(this.program, borrower);
  }

  async getLoansByToken(mint: PublicKey): Promise<Loan[]> {
    return accounts.getLoansByToken(this.program, mint);
  }

  async getLoansByStatus(status: LoanStatus): Promise<Loan[]> {
    return accounts.getLoansByStatus(this.program, status);
  }

  async getAllTokenConfigs(): Promise<TokenConfig[]> {
    return accounts.getAllTokenConfigs(this.program);
  }

  async getWhitelistedTokens(): Promise<TokenConfig[]> {
    return accounts.getWhitelistedTokens(this.program);
  }

  // Utility methods
  calculateLoanTerms(params: LoanTermsParams): LoanTerms {
    return calculateLoanTerms(params);
  }

  async getCurrentPrice(mint: PublicKey): Promise<BN> {
    const priceData = await this.priceClient.getPrice(mint.toString());
    if (!priceData) {
      throw new Error(`Price not available for token ${mint.toString()}`);
    }
    
    // Return price in lamports (SOL price) or convert USD to lamports using SOL price
    if (priceData.solPrice) {
      // Convert SOL price to lamports (multiply by 1e9)
      return new BN(Math.round(priceData.solPrice * 1e9));
    } else {
      // Convert USD price to SOL, then to lamports
      const solToLamports = await this.priceClient.convertUsdToSol(priceData.usdPrice);
      if (!solToLamports) {
        throw new Error('Unable to convert USD price to SOL');
      }
      return new BN(Math.round(solToLamports * 1e9));
    }
  }

  // Price-related methods
  async getTokenPrice(mint: PublicKey): Promise<PriceData | null> {
    return this.priceClient.getPrice(mint.toString());
  }

  async getTokenPrices(mints: PublicKey[]): Promise<Map<string, PriceData>> {
    const mintStrings = mints.map(mint => mint.toString());
    return this.priceClient.getPrices(mintStrings);
  }

  async getSolPrice(): Promise<number | null> {
    return this.priceClient.getSolPrice();
  }

  async getAllTokenPrices(): Promise<Map<string, PriceData>> {
    return this.priceClient.getAllTokenPrices();
  }

  async getTokenValueUsd(mint: PublicKey, amount: BN, decimals?: number): Promise<number | null> {
    return this.priceClient.getTokenValueUsd(mint.toString(), amount, decimals);
  }

  async getTokenValueSol(mint: PublicKey, amount: BN, decimals?: number): Promise<number | null> {
    return this.priceClient.getTokenValueSol(mint.toString(), amount, decimals);
  }

  async estimateLoan(params: CreateLoanParams): Promise<LoanTerms> {
    const mint = new PublicKey(params.tokenMint);
    const tokenConfig = await this.getTokenConfig(mint);
    
    if (!tokenConfig) {
      throw new Error('Token not whitelisted');
    }

    const currentPrice = await this.getCurrentPrice(mint);
    
    return this.calculateLoanTerms({
      tokenMint: params.tokenMint,
      collateralAmount: params.collateralAmount,
      durationSeconds: params.durationSeconds,
      currentPrice: currentPrice.toString(),
      tokenConfig,
    });
  }

  // Helper to check if a loan is liquidatable
  async isLoanLiquidatable(loanPubkey: PublicKey): Promise<{
    liquidatable: boolean;
    reason?: 'time' | 'price';
    currentPrice?: number;
    liquidationPrice?: number;
    timeRemaining?: number;
  }> {
    const loan = await this.getLoan(loanPubkey);
    if (!loan || loan.status !== LoanStatus.Active) {
      return { liquidatable: false };
    }

    // Check time-based liquidation
    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime > loan.dueAt) {
      return { 
        liquidatable: true, 
        reason: 'time',
        timeRemaining: 0
      };
    }

    // Check price-based liquidation
    try {
      const priceData = await this.getTokenPrice(new PublicKey(loan.tokenMint));
      if (priceData?.solPrice) {
        const currentPriceLamports = priceData.solPrice * 1e9; // Convert to lamports
        const liquidationPriceLamports = parseFloat(loan.liquidationPrice);
        
        if (currentPriceLamports <= liquidationPriceLamports) {
          return { 
            liquidatable: true, 
            reason: 'price',
            currentPrice: currentPriceLamports,
            liquidationPrice: liquidationPriceLamports,
            timeRemaining: loan.dueAt - currentTime
          };
        }

        return { 
          liquidatable: false,
          currentPrice: currentPriceLamports,
          liquidationPrice: liquidationPriceLamports,
          timeRemaining: loan.dueAt - currentTime
        };
      }
    } catch (error) {
      console.error('Error checking price liquidation:', error);
    }

    return { 
      liquidatable: false,
      timeRemaining: loan.dueAt - currentTime
    };
  }

  // Enhanced liquidation risk analysis
  async analyzeLiquidationRisk(loanPubkey: PublicKey): Promise<{
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    currentLtv: number;
    liquidationLtv: number;
    priceDropToLiquidation: number;
    timeToExpiry: number;
    recommendations: string[];
  } | null> {
    const loan = await this.getLoan(loanPubkey);
    if (!loan || loan.status !== LoanStatus.Active) {
      return null;
    }

    const tokenConfig = await this.getTokenConfig(new PublicKey(loan.tokenMint));
    if (!tokenConfig) {
      return null;
    }

    const riskAnalysis = await this.priceClient.checkLiquidationRisk(
      loan.tokenMint,
      new BN(loan.collateralAmount),
      new BN(loan.solBorrowed),
      tokenConfig.ltvBps,
      9 // Assuming 9 decimals for most tokens
    );

    if (!riskAnalysis) {
      return null;
    }

    const timeToExpiry = loan.dueAt - Math.floor(Date.now() / 1000);
    const priceDropToLiquidation = ((riskAnalysis.currentLtv - riskAnalysis.liquidationLtv) / riskAnalysis.currentLtv) * 100;

    let riskLevel: 'low' | 'medium' | 'high' | 'critical';
    const recommendations: string[] = [];

    if (riskAnalysis.isAtRisk) {
      riskLevel = 'critical';
      recommendations.push('Immediate action required - loan is at liquidation risk');
      recommendations.push('Add more collateral or repay loan immediately');
    } else if (riskAnalysis.currentLtv > riskAnalysis.liquidationLtv * 0.9) {
      riskLevel = 'high';
      recommendations.push('High risk - consider adding collateral');
      recommendations.push(`Price needs to drop only ${priceDropToLiquidation.toFixed(2)}% for liquidation`);
    } else if (riskAnalysis.currentLtv > riskAnalysis.liquidationLtv * 0.75) {
      riskLevel = 'medium';
      recommendations.push('Monitor closely - moderate risk level');
    } else {
      riskLevel = 'low';
      recommendations.push('Low risk - loan is healthy');
    }

    if (timeToExpiry < 24 * 60 * 60) { // Less than 24 hours
      recommendations.push('Loan expires soon - consider repaying or extending');
    }

    return {
      riskLevel,
      currentLtv: riskAnalysis.currentLtv,
      liquidationLtv: riskAnalysis.liquidationLtv,
      priceDropToLiquidation,
      timeToExpiry,
      recommendations,
    };
  }

  // Token Verification Methods

  /**
   * Verify if a token is a valid PumpFun token with sufficient liquidity
   */
  async verifyToken(mint: string): Promise<TokenVerificationResult> {
    try {
      const response = await fetch(`${this.apiEndpoint}/api/tokens/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mint }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { success: boolean; data: TokenVerificationResult; error?: string };
      
      if (!data.success) {
        throw new Error(data.error || 'Token verification failed');
      }

      return data.data;
    } catch (error) {
      console.error('Token verification error:', error);
      throw new Error(`Failed to verify token ${mint}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get a list of verified PumpFun tokens
   */
  async getPumpFunTokens(minLiquidity?: number, limit?: number): Promise<TokenVerificationResult[]> {
    try {
      const queryParams = new URLSearchParams();
      if (minLiquidity !== undefined) queryParams.set('minLiquidity', minLiquidity.toString());
      if (limit !== undefined) queryParams.set('limit', limit.toString());

      const response = await fetch(`${this.apiEndpoint}/api/tokens/pumpfun?${queryParams.toString()}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { success: boolean; data: GetPumpFunTokensResponse; error?: string };
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch PumpFun tokens');
      }

      return data.data.tokens;
    } catch (error) {
      console.error('Get PumpFun tokens error:', error);
      throw new Error(`Failed to fetch PumpFun tokens: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if a token can be used for loan creation
   */
  async canCreateLoan(mint: string): Promise<{ allowed: boolean; reason?: string; tier?: string }> {
    try {
      const response = await fetch(`${this.apiEndpoint}/api/tokens/${mint}/can-loan`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { success: boolean; data: CanCreateLoanResponse; error?: string };
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to check loan eligibility');
      }

      return data.data;
    } catch (error) {
      console.error('Can create loan check error:', error);
      throw new Error(`Failed to check loan eligibility for ${mint}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Batch verify multiple tokens
   */
  async batchVerifyTokens(mints: string[]): Promise<TokenVerificationResult[]> {
    if (mints.length === 0) {
      return [];
    }

    if (mints.length > 10) {
      throw new Error('Maximum 10 tokens allowed for batch verification');
    }

    try {
      const response = await fetch(`${this.apiEndpoint}/api/tokens/batch-verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mints }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { success: boolean; data: { results: TokenVerificationResult[]; total: number }; error?: string };
      
      if (!data.success) {
        throw new Error(data.error || 'Batch verification failed');
      }

      return data.data.results;
    } catch (error) {
      console.error('Batch verification error:', error);
      throw new Error(`Failed to batch verify tokens: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get detailed token verification information
   */
  async getTokenVerificationInfo(mint: string): Promise<{
    verification: TokenVerificationResult;
    metadata: {
      checkedAt: string;
      cacheable: boolean;
      cacheExpiry: string;
    };
  }> {
    try {
      const response = await fetch(`${this.apiEndpoint}/api/tokens/${mint}/verify`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { 
        success: boolean; 
        data: {
          verification: TokenVerificationResult;
          metadata: {
            checkedAt: string;
            cacheable: boolean;
            cacheExpiry: string;
          };
        }; 
        error?: string 
      };
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to get token verification info');
      }

      return data.data;
    } catch (error) {
      console.error('Get token verification info error:', error);
      throw new Error(`Failed to get verification info for ${mint}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Enhanced loan creation with token verification
   */
  async createLoanWithVerification(params: CreateLoanParams): Promise<{
    transactionSignature: TransactionSignature;
    verification: TokenVerificationResult;
  }> {
    // First verify the token
    const verification = await this.verifyToken(params.tokenMint);
    
    if (!verification.isValid) {
      throw new Error(`Token verification failed: ${verification.reason}`);
    }

    // Create the loan
    const transactionSignature = await this.createLoan(params);

    return {
      transactionSignature,
      verification,
    };
  }

  /**
   * Validate token for loan creation (convenience method)
   */
  async validateTokenForLoan(mint: string): Promise<{
    isValid: boolean;
    canCreateLoan: boolean;
    verification: TokenVerificationResult;
    loanEligibility: CanCreateLoanResponse;
    errors: string[];
    warnings: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Parallel verification and loan eligibility check
      const [verification, loanEligibility] = await Promise.all([
        this.verifyToken(mint),
        this.canCreateLoan(mint),
      ]);

      // Check verification
      if (!verification.isValid) {
        errors.push(verification.reason || 'Token verification failed');
      }

      // Check loan eligibility
      if (!loanEligibility.allowed) {
        errors.push(loanEligibility.reason || 'Token not eligible for loans');
      }

      // Add warnings for low-tier tokens
      if (verification.tier === 'bronze') {
        warnings.push('Bronze tier token - higher risk, lower LTV (50%)');
      } else if (verification.tier === 'silver') {
        warnings.push('Silver tier token - moderate risk, medium LTV (60%)');
      }

      // Add liquidity warnings
      if (verification.liquidity < 100000) {
        warnings.push(`Low liquidity: $${verification.liquidity.toFixed(2)}`);
      }

      return {
        isValid: verification.isValid,
        canCreateLoan: verification.isValid && loanEligibility.allowed,
        verification,
        loanEligibility,
        errors,
        warnings,
      };
    } catch (error) {
      errors.push(`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);

      return {
        isValid: false,
        canCreateLoan: false,
        verification: {
          isValid: false,
          mint,
          liquidity: 0,
          reason: 'Validation failed',
          verifiedAt: Date.now(),
        },
        loanEligibility: {
          allowed: false,
          reason: 'Validation failed',
        },
        errors,
        warnings,
      };
    }
  }

  // Manual Whitelist Management Methods (Admin only)

  /**
   * Add a token to the manual whitelist
   */
  async addToWhitelist(
    request: CreateWhitelistEntryRequest,
    adminHeaders: Record<string, string>
  ): Promise<ManualWhitelistEntry> {
    try {
      const response = await fetch(`${this.apiEndpoint}/api/admin/whitelist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...adminHeaders,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { success: boolean; data: ManualWhitelistEntry; error?: string };

      if (!data.success) {
        throw new Error(data.error || 'Failed to add to whitelist');
      }

      return data.data;
    } catch (error) {
      console.error('Add to whitelist error:', error);
      throw new Error(`Failed to add token to whitelist: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update a whitelist entry
   */
  async updateWhitelistEntry(
    mint: string,
    request: UpdateWhitelistEntryRequest,
    adminHeaders: Record<string, string>
  ): Promise<ManualWhitelistEntry> {
    try {
      const response = await fetch(`${this.apiEndpoint}/api/admin/whitelist/${mint}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...adminHeaders,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { success: boolean; data: ManualWhitelistEntry; error?: string };

      if (!data.success) {
        throw new Error(data.error || 'Failed to update whitelist entry');
      }

      return data.data;
    } catch (error) {
      console.error('Update whitelist entry error:', error);
      throw new Error(`Failed to update whitelist entry: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Remove a token from the whitelist
   */
  async removeFromWhitelist(
    mint: string,
    reason: string,
    adminHeaders: Record<string, string>
  ): Promise<void> {
    try {
      const response = await fetch(`${this.apiEndpoint}/api/admin/whitelist/${mint}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...adminHeaders,
        },
        body: JSON.stringify({ reason }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { success: boolean; error?: string };

      if (!data.success) {
        throw new Error(data.error || 'Failed to remove from whitelist');
      }
    } catch (error) {
      console.error('Remove from whitelist error:', error);
      throw new Error(`Failed to remove token from whitelist: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Enable a whitelist entry
   */
  async enableWhitelistEntry(
    mint: string,
    adminHeaders: Record<string, string>
  ): Promise<void> {
    try {
      const response = await fetch(`${this.apiEndpoint}/api/admin/whitelist/${mint}/enable`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...adminHeaders,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { success: boolean; error?: string };

      if (!data.success) {
        throw new Error(data.error || 'Failed to enable whitelist entry');
      }
    } catch (error) {
      console.error('Enable whitelist entry error:', error);
      throw new Error(`Failed to enable whitelist entry: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Disable a whitelist entry
   */
  async disableWhitelistEntry(
    mint: string,
    reason: string,
    adminHeaders: Record<string, string>
  ): Promise<void> {
    try {
      const response = await fetch(`${this.apiEndpoint}/api/admin/whitelist/${mint}/disable`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...adminHeaders,
        },
        body: JSON.stringify({ reason }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { success: boolean; error?: string };

      if (!data.success) {
        throw new Error(data.error || 'Failed to disable whitelist entry');
      }
    } catch (error) {
      console.error('Disable whitelist entry error:', error);
      throw new Error(`Failed to disable whitelist entry: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get whitelist entries with filters
   */
  async getWhitelistEntries(
    request: GetWhitelistEntriesRequest,
    adminHeaders: Record<string, string>
  ): Promise<GetWhitelistEntriesResponse> {
    try {
      const queryParams = new URLSearchParams();
      
      if (request.filters?.mint) queryParams.set('mint', request.filters.mint);
      if (request.filters?.tier) queryParams.set('tier', request.filters.tier);
      if (request.filters?.enabled !== undefined) queryParams.set('enabled', request.filters.enabled.toString());
      if (request.filters?.addedBy) queryParams.set('addedBy', request.filters.addedBy);
      if (request.filters?.tags) queryParams.set('tags', request.filters.tags.join(','));
      if (request.filters?.search) queryParams.set('search', request.filters.search);
      if (request.sortBy) queryParams.set('sortBy', request.sortBy);
      if (request.sortOrder) queryParams.set('sortOrder', request.sortOrder);
      if (request.page) queryParams.set('page', request.page.toString());
      if (request.limit) queryParams.set('limit', request.limit.toString());

      const response = await fetch(`${this.apiEndpoint}/api/admin/whitelist?${queryParams.toString()}`, {
        headers: {
          ...adminHeaders,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { success: boolean; data: GetWhitelistEntriesResponse; error?: string };

      if (!data.success) {
        throw new Error(data.error || 'Failed to get whitelist entries');
      }

      return data.data;
    } catch (error) {
      console.error('Get whitelist entries error:', error);
      throw new Error(`Failed to get whitelist entries: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get a specific whitelist entry
   */
  async getWhitelistEntry(
    mint: string,
    adminHeaders: Record<string, string>
  ): Promise<ManualWhitelistEntry> {
    try {
      const response = await fetch(`${this.apiEndpoint}/api/admin/whitelist/${mint}`, {
        headers: {
          ...adminHeaders,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { success: boolean; data: ManualWhitelistEntry; error?: string };

      if (!data.success) {
        throw new Error(data.error || 'Failed to get whitelist entry');
      }

      return data.data;
    } catch (error) {
      console.error('Get whitelist entry error:', error);
      throw new Error(`Failed to get whitelist entry: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get whitelist statistics
   */
  async getWhitelistStats(
    adminHeaders: Record<string, string>
  ): Promise<WhitelistStats> {
    try {
      const response = await fetch(`${this.apiEndpoint}/api/admin/whitelist/stats`, {
        headers: {
          ...adminHeaders,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { success: boolean; data: WhitelistStats; error?: string };

      if (!data.success) {
        throw new Error(data.error || 'Failed to get whitelist stats');
      }

      return data.data;
    } catch (error) {
      console.error('Get whitelist stats error:', error);
      throw new Error(`Failed to get whitelist stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get audit logs for whitelist changes
   */
  async getWhitelistAuditLogs(
    mint?: string,
    adminAddress?: string,
    limit?: number,
    adminHeaders?: Record<string, string>
  ): Promise<WhitelistAuditLog[]> {
    try {
      let url = `${this.apiEndpoint}/api/admin/whitelist/audit-logs/all`;
      
      if (mint) {
        url = `${this.apiEndpoint}/api/admin/whitelist/${mint}/audit-logs`;
      }

      const queryParams = new URLSearchParams();
      if (adminAddress) queryParams.set('adminAddress', adminAddress);
      if (limit) queryParams.set('limit', limit.toString());

      if (queryParams.toString()) {
        url += `?${queryParams.toString()}`;
      }

      const response = await fetch(url, {
        headers: {
          ...(adminHeaders || {}),
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { success: boolean; data: WhitelistAuditLog[]; error?: string };

      if (!data.success) {
        throw new Error(data.error || 'Failed to get audit logs');
      }

      return data.data;
    } catch (error) {
      console.error('Get audit logs error:', error);
      throw new Error(`Failed to get audit logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Helper method to create admin authentication headers
   */
  createAdminHeaders(adminPrivateKey: string): Record<string, string> {
    // This would implement signature-based authentication
    // For now, return basic headers structure
    const adminAddress = 'ADMIN_ADDRESS_FROM_PRIVATE_KEY'; // TODO: derive from private key
    
    return {
      'x-admin-address': adminAddress,
      'x-signature': 'SIGNATURE_FROM_MESSAGE', // TODO: implement message signing
      'x-timestamp': Date.now().toString(),
    };
  }

  // ============= STAKING METHODS =============

  /**
   * Get staking pool state
   */
  async getStakingPool(): Promise<accounts.StakingPool | null> {
    return accounts.getStakingPool(this.program);
  }

  /**
   * Get user stake for a specific user
   */
  async getUserStake(user: PublicKey): Promise<accounts.UserStake | null> {
    return accounts.getUserStake(this.program, user);
  }

  /**
   * Deposit SOL rewards to the staking pool
   */
  async depositRewards(amount: BN): Promise<TransactionSignature> {
    return instructions.depositRewards(this.program, amount);
  }

  /**
   * Stake governance tokens
   */
  async stake(amount: BN): Promise<TransactionSignature> {
    return instructions.stake(this.program, amount);
  }

  /**
   * Unstake governance tokens
   */
  async unstake(amount: BN): Promise<TransactionSignature> {
    return instructions.unstake(this.program, amount);
  }

  /**
   * Claim staking rewards (SOL)
   */
  async claimRewards(): Promise<TransactionSignature> {
    return instructions.claimRewards(this.program);
  }

  /**
   * Emergency drain all SOL from staking reward vault (admin only)
   */
  async emergencyDrainRewards(): Promise<TransactionSignature> {
    return instructions.emergencyDrainRewards(this.program);
  }

  /**
   * Pause staking (admin only)
   */
  async pauseStaking(): Promise<TransactionSignature> {
    return instructions.pauseStaking(this.program);
  }

  /**
   * Resume staking (admin only)
   */
  async resumeStaking(): Promise<TransactionSignature> {
    return instructions.resumeStaking(this.program);
  }

  /**
   * Update epoch duration (admin only)
   */
  async updateEpochDuration(newDuration: BN): Promise<TransactionSignature> {
    return instructions.updateEpochDuration(this.program, newDuration);
  }

  /**
   * Force advance to next epoch (admin only)
   */
  async forceAdvanceEpoch(): Promise<TransactionSignature> {
    return instructions.forceAdvanceEpoch(this.program);
  }

  /**
   * Emergency withdraw all staking rewards (admin only)
   */
  async emergencyWithdraw(): Promise<TransactionSignature> {
    return instructions.emergencyWithdraw(this.program);
  }

}