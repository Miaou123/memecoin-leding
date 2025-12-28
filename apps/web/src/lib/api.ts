import { 
  ApiResponse,
  ProtocolStats,
  TokenStats,
  Loan,
  LoanEstimate,
  CreateLoanRequest,
  PaginatedResponse,
  UserStats,
} from '@memecoin-lending/types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

class ApiClient {
  private async fetch<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    
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
  
  async getTokens(): Promise<TokenStats[]> {
    return this.fetch('/tokens');
  }
  
  async getToken(mint: string): Promise<TokenStats> {
    return this.fetch(`/tokens/${mint}`);
  }
  
  async getTokenPrice(mint: string): Promise<{ price: string; timestamp: number }> {
    return this.fetch(`/tokens/${mint}/price`);
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
  ): Promise<Loan> {
    return this.fetch('/loans', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(params),
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
  
  async getUserStats(wallet: string): Promise<UserStats> {
    return this.fetch(`/user/${wallet}/stats`);
  }
}

export const api = new ApiClient();