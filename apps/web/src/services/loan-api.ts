const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002';

export interface PrepareLoanRequest {
  tokenMint: string;
  collateralAmount: string;
  durationSeconds: number;
  borrower: string;
}

export interface PrepareLoanResponse {
  transaction: string;
  price: string;
  priceInSol: string;
  timestamp: number;
  expiresAt: number;
  estimatedSolAmount: string;
  loanPda: string;
}

export async function prepareLoan(request: PrepareLoanRequest): Promise<PrepareLoanResponse> {
  const response = await fetch(`${API_URL}/api/loan/prepare`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Failed to prepare loan');
  }

  return data.data;
}

export async function getPriceAuthority(): Promise<string> {
  const response = await fetch(`${API_URL}/api/loan/price-authority`);
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.error || 'Failed to get price authority');
  }
  
  return data.data.priceAuthority;
}