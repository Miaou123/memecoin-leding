import { TokenTier } from './protocol';

export interface ManualWhitelistEntry {
  id: string;
  mint: string;
  symbol?: string;
  name?: string;
  tier: TokenTier;
  ltvBps: number;
  interestRateBps: number;
  minLoanAmount: string;
  maxLoanAmount: string;
  enabled: boolean;
  addedBy: string;
  addedAt: number;
  updatedAt: number;
  reason?: string;
  notes?: string;
  externalUrl?: string;
  logoUrl?: string;
  tags?: string[];
}

export interface CreateWhitelistEntryRequest {
  mint: string;
  symbol?: string;
  name?: string;
  tier: TokenTier;
  ltvBps?: number;
  interestRateBps?: number;
  minLoanAmount?: string;
  maxLoanAmount?: string;
  reason?: string;
  notes?: string;
  externalUrl?: string;
  logoUrl?: string;
  tags?: string[];
}

export interface UpdateWhitelistEntryRequest {
  symbol?: string;
  name?: string;
  tier?: TokenTier;
  ltvBps?: number;
  interestRateBps?: number;
  minLoanAmount?: string;
  maxLoanAmount?: string;
  enabled?: boolean;
  reason?: string;
  notes?: string;
  externalUrl?: string;
  logoUrl?: string;
  tags?: string[];
}

export interface WhitelistEntryFilters {
  mint?: string;
  tier?: TokenTier;
  enabled?: boolean;
  addedBy?: string;
  tags?: string[];
  search?: string;
}

export interface GetWhitelistEntriesRequest {
  filters?: WhitelistEntryFilters;
  sortBy?: 'addedAt' | 'updatedAt' | 'symbol' | 'tier';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface GetWhitelistEntriesResponse {
  entries: ManualWhitelistEntry[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface WhitelistStats {
  totalEntries: number;
  enabledEntries: number;
  entriesByTier: {
    bronze: number;
    silver: number;
    gold: number;
  };
  recentlyAdded: number; // Added in last 7 days
}

export enum WhitelistAction {
  ADD = 'add',
  UPDATE = 'update',
  ENABLE = 'enable',
  DISABLE = 'disable',
  REMOVE = 'remove',
}

export interface WhitelistAuditLog {
  id: string;
  entryId: string;
  action: WhitelistAction;
  adminAddress: string;
  changes?: Record<string, any>;
  timestamp: number;
  reason?: string;
}