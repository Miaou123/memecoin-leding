import { 
  ProtocolStats,
  TokenStats,
  Loan,
  UserStats,
} from '@memecoin-lending/types';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001/api';

class TelegramApiClient {
  private async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json() as { success: boolean; data: T; error?: string };
    
    if (!data.success) {
      throw new Error(data.error || 'API request failed');
    }
    
    return data.data;
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
  
  async getUserLoans(wallet: string): Promise<Loan[]> {
    return this.fetch(`/loans/user/${wallet}`);
  }
  
  async getLoan(pubkey: string): Promise<Loan> {
    return this.fetch(`/loans/${pubkey}`);
  }
  
  async getUserStats(wallet: string): Promise<UserStats> {
    return this.fetch(`/user/${wallet}/stats`);
  }
  
  async getUserByTelegramId(telegramId: string): Promise<{ walletAddress?: string } | null> {
    try {
      // This endpoint needs to be added to the backend API
      return this.fetch(`/user/telegram/${telegramId}`);
    } catch {
      return null;
    }
  }
  
  async linkTelegramAccount(
    walletAddress: string,
    telegramId: string,
    telegramUsername?: string
  ): Promise<void> {
    return this.fetch('/user/link-telegram', {
      method: 'POST',
      body: JSON.stringify({
        walletAddress,
        telegramId,
        telegramUsername,
      }),
    });
  }
  
  async updateNotificationPreferences(
    walletAddress: string,
    preferences: Record<string, unknown>
  ): Promise<void> {
    return this.fetch(`/user/${walletAddress}/preferences/notifications`, {
      method: 'PUT',
      body: JSON.stringify(preferences),
    });
  }
}

export const apiClient = new TelegramApiClient();