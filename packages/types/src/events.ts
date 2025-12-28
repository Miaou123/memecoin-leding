export enum WebSocketEvent {
  // Server to client
  LOAN_CREATED = 'loan:created',
  LOAN_REPAID = 'loan:repaid',
  LOAN_LIQUIDATED = 'loan:liquidated',
  PRICE_UPDATE = 'price:update',
  PROTOCOL_UPDATE = 'protocol:update',
  
  // Client to server
  SUBSCRIBE_LOANS = 'subscribe:loans',
  SUBSCRIBE_PRICES = 'subscribe:prices',
  SUBSCRIBE_USER = 'subscribe:user',
  UNSUBSCRIBE = 'unsubscribe',
}

export interface WebSocketMessage<T = any> {
  event: WebSocketEvent;
  data: T;
  timestamp: number;
}

export interface LoanCreatedEvent {
  loan: import('./protocol').Loan;
  txSignature: string;
}

export interface LoanRepaidEvent {
  loanPubkey: string;
  borrower: string;
  totalRepaid: string;
  txSignature: string;
}

export interface LoanLiquidatedEvent {
  loanPubkey: string;
  borrower: string;
  liquidator: string;
  reason: 'time' | 'price';
  txSignature: string;
}

export interface PriceUpdateEvent {
  tokenMint: string;
  price: string;
  previousPrice: string;
  timestamp: number;
}

export interface ProtocolUpdateEvent {
  field: string;
  oldValue: any;
  newValue: any;
}

export interface SubscriptionParams {
  loans?: {
    userWallet?: string;
    tokenMint?: string;
    status?: import('./protocol').LoanStatus;
  };
  prices?: {
    tokenMints: string[];
  };
  user?: {
    wallet: string;
  };
}