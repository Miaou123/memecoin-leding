/**
 * Status of a manual verification request
 */
export enum VerificationRequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
}

/**
 * A user's request for manual token verification
 */
export interface VerificationRequest {
  id: string;
  mint: string;
  requestedBy: string;
  status: VerificationRequestStatus;
  reason?: string | null;
  adminResponse?: string | null;
  reviewedBy?: string | null;
  telegramMessageId?: string | null;
  createdAt: number;
  updatedAt: number;
  reviewedAt?: number | null;
}

/**
 * Request to create a verification request
 */
export interface CreateVerificationRequestInput {
  mint: string;
  requestedBy: string;
  reason?: string;
}

/**
 * Request to review (approve/reject) a verification request
 */
export interface ReviewVerificationRequestInput {
  requestId: string;
  action: 'approve' | 'reject';
  adminResponse?: string;
  reviewedBy: string;
  tier?: 'bronze' | 'silver' | 'gold';
}

/**
 * Response from creating a verification request
 */
export interface CreateVerificationRequestResponse {
  success: boolean;
  requestId?: string;
  error?: string;
  alreadyRequested?: boolean;
}

/**
 * Telegram notification data for a verification request
 */
export interface VerificationRequestTelegramData {
  requestId: string;
  mint: string;
  requestedBy: string;
  reason?: string;
  tokenInfo?: {
    symbol?: string;
    name?: string;
    poolAddress?: string;
  };
  createdAt: number;
}