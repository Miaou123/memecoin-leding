import { 
  ApiResponse,
  ProtocolStats,
  TokenStats,
  Loan,
  LoanEstimate,
  CreateLoanRequest,
  PaginatedResponse,
  UserStats,
  ManualWhitelistEntry,
  CreateWhitelistEntryRequest,
  UpdateWhitelistEntryRequest,
  GetWhitelistEntriesRequest,
  GetWhitelistEntriesResponse,
  WhitelistStats,
  WhitelistAuditLog,
  TokenVerificationResult,
  StakingStats,
  UserStake,
  RecentLoanResponse,
} from '@memecoin-lending/types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

class ApiClient {
  private async fetch<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${API_BASE_URL}/api${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    
    const data: ApiResponse<T> = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'API request failed');
    }
    
    return data.data as T;
  }
  
  async getProtocolStats(): Promise<ProtocolStats> {
    return this.fetch('/protocol/stats');
  }
  
  async getProtocolStatus(): Promise<{ paused: boolean; pauseReason?: string; version: string; treasury: string }> {
    return this.fetch('/protocol/status');
  }
  
  async getTokens(): Promise<TokenStats[]> {
    return this.fetch('/tokens');
  }
  
  async getToken(mint: string): Promise<TokenStats> {
    return this.fetch(`/tokens/${mint}`);
  }
  
  async getTokenPrice(mint: string): Promise<{ price: string; timestamp: number }> {
    return this.fetch(`/tokens/${mint}/price`);
  }
  
  async getBatchPrices(mints: string[]): Promise<Record<string, { price: string; timestamp: number }>> {
    if (mints.length === 0) return {};
    
    const query = new URLSearchParams({ mints: mints.join(',') });
    return this.fetch(`/prices?${query.toString()}`);
  }
  
  async getLoans(params: {
    page?: number;
    pageSize?: number;
    status?: string;
    tokenMint?: string;
    borrower?: string;
  } = {}): Promise<PaginatedResponse<Loan>> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        query.append(key, value.toString());
      }
    });
    
    return this.fetch(`/loans?${query.toString()}`);
  }
  
  async getLoan(pubkey: string): Promise<Loan> {
    return this.fetch(`/loans/${pubkey}`);
  }
  
  async getUserLoans(wallet: string): Promise<Loan[]> {
    return this.fetch(`/loans/user/${wallet}`);
  }
  
  async estimateLoan(params: CreateLoanRequest): Promise<LoanEstimate> {
    return this.fetch('/loans/estimate', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }
  
  async createLoan(
    params: CreateLoanRequest,
    authHeaders: Record<string, string>
  ): Promise<{ transaction: string }> {
    return this.fetch('/loans', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(params),
    });
  }

  async createLoanUnsigned(
    params: CreateLoanRequest & { borrower: string }
  ): Promise<{ transaction: string }> {
    return this.fetch('/loans/unsigned', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async repayLoanUnsigned(
    loanPubkey: string,
    borrower: string
  ): Promise<{ transaction: string }> {
    return this.fetch(`/loans/${loanPubkey}/repay/unsigned`, {
      method: 'POST',
      body: JSON.stringify({ borrower }),
    });
  }
  
  async repayLoan(
    loanPubkey: string,
    authHeaders: Record<string, string>
  ): Promise<Loan> {
    return this.fetch(`/loans/${loanPubkey}/repay`, {
      method: 'POST',
      headers: authHeaders,
    });
  }
  
  async liquidateLoan(
    loanPubkey: string,
    authHeaders: Record<string, string>
  ): Promise<Loan> {
    return this.fetch(`/loans/${loanPubkey}/liquidate`, {
      method: 'POST',
      headers: authHeaders,
    });
  }

  async trackLoan(params: {
    loanPubkey: string;
    txSignature: string;
    borrower: string;
    tokenMint: string;
  }): Promise<Loan> {
    return this.fetch('/loans/track', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async confirmRepayment(
    loanPubkey: string,
    txSignature: string
  ): Promise<Loan> {
    return this.fetch(`/loans/${loanPubkey}/repay/confirm`, {
      method: 'POST',
      body: JSON.stringify({ txSignature }),
    });
  }

  /**
   * Sync loan status from on-chain state.
   * Used when we detect LoanAlreadyRepaid error to fix DB inconsistency.
   */
  async syncLoanStatus(loanPubkey: string): Promise<Loan> {
    return this.fetch(`/loans/${loanPubkey}/sync-status`, {
      method: 'POST',
    });
  }
  
  async getUserStats(wallet: string): Promise<UserStats> {
    return this.fetch(`/user/${wallet}/stats`);
  }

  // Dashboard-specific methods
  async getRecentLoans(params: { limit?: number } = {}): Promise<RecentLoanResponse[]> {
    const query = new URLSearchParams();
    if (params.limit) query.append('limit', params.limit.toString());
    
    return this.fetch(`/loans/recent?${query.toString()}`);
  }

  async getTopCollateralToken(): Promise<TokenStats> {
    return this.fetch('/tokens/top-collateral');
  }

  // Token Verification Methods
  async verifyToken(mint: string): Promise<TokenVerificationResult> {
    return this.fetch('/tokens/verify', {
      method: 'POST',
      body: JSON.stringify({ mint }),
    });
  }

  async getPumpFunTokens(minLiquidity?: number, limit?: number): Promise<TokenVerificationResult[]> {
    const query = new URLSearchParams();
    if (minLiquidity !== undefined) query.append('minLiquidity', minLiquidity.toString());
    if (limit !== undefined) query.append('limit', limit.toString());
    
    const response = await this.fetch<{ tokens: TokenVerificationResult[] }>(`/tokens/pumpfun?${query.toString()}`);
    return response.tokens;
  }

  async canCreateLoan(mint: string): Promise<{ allowed: boolean; reason?: string; tier?: string }> {
    return this.fetch(`/tokens/${mint}/can-loan`);
  }

  async checkWhitelisted(mints: string[]): Promise<{
    whitelistedMints: string[];
    tokens: Array<{
      id: string;
      symbol: string;
      name: string;
      tier: string;
    }>;
    total: number;
  }> {
    return this.fetch('/tokens/check-whitelisted', {
      method: 'POST',
      body: JSON.stringify({ mints }),
    });
  }

  // Staking Methods
  async getStakingPool(): Promise<StakingStats> {
    return this.fetch('/staking/pool');
  }

  async getStakingStats(): Promise<StakingStats> {
    return this.fetch('/staking/stats');
  }

  async getUserStake(address: string): Promise<{
    stake: UserStake | null;
    pendingRewards: string;
    pendingRewardsSol: number;
  }> {
    return this.fetch(`/staking/user/${address}`);
  }

  async getPendingRewards(address: string): Promise<{
    pending: string;
    pendingSol: number;
  }> {
    return this.fetch(`/staking/rewards/${address}`);
  }

  async prepareStakeTransaction(params: {
    userAddress: string;
    amount: string;
    tokenMint: string;
  }): Promise<{ transaction: string }> {
    return this.fetch('/staking/stake', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async prepareUnstakeTransaction(params: {
    userAddress: string;
    amount: string;
    tokenMint: string;
  }): Promise<{ transaction: string }> {
    return this.fetch('/staking/unstake', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async prepareClaimTransaction(params: {
    userAddress: string;
  }): Promise<{ transaction: string }> {
    return this.fetch('/staking/claim', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  // Admin Methods
  admin = {
    // Helper to create admin headers
    createHeaders: (adminPrivateKey: string): Record<string, string> => {
      // TODO: Implement proper signature-based authentication
      // For now, return basic headers
      return {
        'x-admin-address': 'ADMIN_ADDRESS_PLACEHOLDER',
        'x-signature': 'SIGNATURE_PLACEHOLDER',
        'x-timestamp': Date.now().toString(),
      };
    },

    // Whitelist Management
    addToWhitelist: async (
      request: CreateWhitelistEntryRequest,
      adminPrivateKey: string
    ): Promise<ManualWhitelistEntry> => {
      return this.fetch('/admin/whitelist', {
        method: 'POST',
        headers: this.admin.createHeaders(adminPrivateKey),
        body: JSON.stringify(request),
      });
    },

    updateWhitelistEntry: async (
      mint: string,
      request: UpdateWhitelistEntryRequest,
      adminPrivateKey: string
    ): Promise<ManualWhitelistEntry> => {
      return this.fetch(`/admin/whitelist/${mint}`, {
        method: 'PUT',
        headers: this.admin.createHeaders(adminPrivateKey),
        body: JSON.stringify(request),
      });
    },

    removeFromWhitelist: async (
      mint: string,
      reason: string,
      adminPrivateKey: string
    ): Promise<void> => {
      return this.fetch(`/admin/whitelist/${mint}`, {
        method: 'DELETE',
        headers: this.admin.createHeaders(adminPrivateKey),
        body: JSON.stringify({ reason }),
      });
    },

    enableWhitelistEntry: async (
      mint: string,
      adminPrivateKey: string
    ): Promise<void> => {
      return this.fetch(`/admin/whitelist/${mint}/enable`, {
        method: 'POST',
        headers: this.admin.createHeaders(adminPrivateKey),
      });
    },

    disableWhitelistEntry: async (
      mint: string,
      reason: string,
      adminPrivateKey: string
    ): Promise<void> => {
      return this.fetch(`/admin/whitelist/${mint}/disable`, {
        method: 'POST',
        headers: this.admin.createHeaders(adminPrivateKey),
        body: JSON.stringify({ reason }),
      });
    },

    getWhitelistEntries: async (
      request: GetWhitelistEntriesRequest
    ): Promise<GetWhitelistEntriesResponse> => {
      const query = new URLSearchParams();
      
      if (request.filters?.mint) query.append('mint', request.filters.mint);
      if (request.filters?.tier) query.append('tier', request.filters.tier);
      if (request.filters?.enabled !== undefined) query.append('enabled', request.filters.enabled.toString());
      if (request.filters?.addedBy) query.append('addedBy', request.filters.addedBy);
      if (request.filters?.tags) query.append('tags', request.filters.tags.join(','));
      if (request.filters?.search) query.append('search', request.filters.search);
      if (request.sortBy) query.append('sortBy', request.sortBy);
      if (request.sortOrder) query.append('sortOrder', request.sortOrder);
      if (request.page) query.append('page', request.page.toString());
      if (request.limit) query.append('limit', request.limit.toString());

      return this.fetch(`/admin/whitelist?${query.toString()}`, {
        headers: this.admin.createHeaders(''), // Empty key for read operations
      });
    },

    getWhitelistEntry: async (
      mint: string,
      adminPrivateKey: string
    ): Promise<ManualWhitelistEntry> => {
      return this.fetch(`/admin/whitelist/${mint}`, {
        headers: this.admin.createHeaders(adminPrivateKey),
      });
    },

    getWhitelistStats: async (): Promise<WhitelistStats> => {
      return this.fetch('/admin/whitelist/stats', {
        headers: this.admin.createHeaders(''), // Empty key for read operations
      });
    },

    getWhitelistAuditLogs: async (
      mint?: string,
      adminAddress?: string,
      limit?: number
    ): Promise<WhitelistAuditLog[]> => {
      let url = '/admin/whitelist/audit-logs/all';
      
      if (mint) {
        url = `/admin/whitelist/${mint}/audit-logs`;
      }

      const query = new URLSearchParams();
      if (adminAddress) query.append('adminAddress', adminAddress);
      if (limit) query.append('limit', limit.toString());

      if (query.toString()) {
        url += `?${query.toString()}`;
      }

      return this.fetch(url, {
        headers: this.admin.createHeaders(''), // Empty key for read operations
      });
    },
  };
}

export const api = new ApiClient();