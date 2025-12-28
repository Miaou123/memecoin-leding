export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface CreateLoanRequest {
  tokenMint: string;
  collateralAmount: string;
  durationSeconds: number;
}

export interface LoanEstimate {
  solAmount: string;
  interestRate: number;
  totalOwed: string;
  liquidationPrice: string;
  ltv: number;
  fees: {
    protocolFee: string;
    interest: string;
  };
}

export interface ProtocolStats {
  totalValueLocked: string;
  totalLoansActive: number;
  totalLoansCreated: number;
  totalInterestEarned: string;
  treasuryBalance: string;
  volume24h: string;
  liquidations24h: number;
}

export interface TokenStats {
  mint: string;
  symbol: string;
  name: string;
  currentPrice: string;
  priceChange24h: number;
  totalLoans: number;
  activeLoans: number;
  totalBorrowed: string;
  availableLiquidity: string;
}

export interface UserStats {
  wallet: string;
  totalLoans: number;
  activeLoans: number;
  totalBorrowed: string;
  totalRepaid: string;
  totalInterestPaid: string;
  liquidations: number;
}

export interface PriceData {
  tokenMint: string;
  price: string;
  timestamp: number;
  source: 'raydium' | 'orca' | 'jupiter';
}

export interface LoanHistory {
  action: 'created' | 'repaid' | 'liquidated';
  timestamp: number;
  txSignature: string;
  details: Record<string, any>;
}

export interface NotificationPreferences {
  loanCreated: boolean;
  loanDueSoon: boolean;
  loanLiquidated: boolean;
  priceAlerts: boolean;
}