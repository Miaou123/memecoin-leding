export class MemecoinLendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemecoinLendingError';
  }
}

export class InsufficientCollateralError extends MemecoinLendingError {
  constructor(required: string, provided: string) {
    super(`Insufficient collateral. Required: ${required}, Provided: ${provided}`);
    this.name = 'InsufficientCollateralError';
  }
}

export class TokenNotWhitelistedError extends MemecoinLendingError {
  constructor(mint: string) {
    super(`Token ${mint} is not whitelisted`);
    this.name = 'TokenNotWhitelistedError';
  }
}

export class LoanNotFoundError extends MemecoinLendingError {
  constructor(pubkey: string) {
    super(`Loan not found: ${pubkey}`);
    this.name = 'LoanNotFoundError';
  }
}

export class LoanNotActiveError extends MemecoinLendingError {
  constructor(pubkey: string, status: string) {
    super(`Loan ${pubkey} is not active. Current status: ${status}`);
    this.name = 'LoanNotActiveError';
  }
}

export class UnauthorizedError extends MemecoinLendingError {
  constructor(action: string) {
    super(`Unauthorized to perform action: ${action}`);
    this.name = 'UnauthorizedError';
  }
}

export class ProtocolPausedError extends MemecoinLendingError {
  constructor() {
    super('Protocol is currently paused');
    this.name = 'ProtocolPausedError';
  }
}

export class InvalidDurationError extends MemecoinLendingError {
  constructor(duration: number, min: number, max: number) {
    super(`Invalid loan duration: ${duration}. Must be between ${min} and ${max} seconds`);
    this.name = 'InvalidDurationError';
  }
}

export class ExceedsMaxLoanAmountError extends MemecoinLendingError {
  constructor(requested: string, max: string) {
    super(`Loan amount exceeds maximum. Requested: ${requested}, Maximum: ${max}`);
    this.name = 'ExceedsMaxLoanAmountError';
  }
}

export function parseAnchorError(error: any): MemecoinLendingError {
  const errorMsg = error.toString();
  
  if (errorMsg.includes('TokenNotWhitelisted')) {
    return new TokenNotWhitelistedError('unknown');
  }
  
  if (errorMsg.includes('InsufficientCollateral')) {
    return new InsufficientCollateralError('unknown', 'unknown');
  }
  
  if (errorMsg.includes('Unauthorized')) {
    return new UnauthorizedError('unknown');
  }
  
  if (errorMsg.includes('ProtocolPaused')) {
    return new ProtocolPausedError();
  }
  
  return new MemecoinLendingError(errorMsg);
}