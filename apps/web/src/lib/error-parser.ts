/**
 * Error Parser - Converts Solana program errors to user-friendly messages
 */

export interface ParsedError {
  code: string;
  name: string;
  title: string;
  description: string;
  suggestion?: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
}

// Error code mapping - matches programs/memecoin-lending/src/error.rs
// Anchor adds 6000 offset to custom errors, so error 6000 = first custom error
const ERROR_MAP: Record<number, Omit<ParsedError, 'code'>> = {
  // ========================================
  // Core Protocol Errors (6000-6010)
  // ========================================
  6000: {
    name: 'ProtocolPaused',
    title: 'PROTOCOL_PAUSED',
    description: 'The protocol is temporarily paused for maintenance.',
    suggestion: 'Please try again later.',
    severity: 'critical',
  },
  6001: {
    name: 'Unauthorized',
    title: 'ACCESS_DENIED',
    description: 'You are not authorized to perform this action.',
    severity: 'error',
  },
  6002: {
    name: 'InvalidTokenTier',
    title: 'INVALID_TIER',
    description: 'The token tier configuration is invalid.',
    severity: 'error',
  },
  6003: {
    name: 'TokenNotWhitelisted',
    title: 'TOKEN_NOT_SUPPORTED',
    description: 'This token is not available for lending.',
    suggestion: 'Request token verification from the dashboard.',
    severity: 'info',
  },
  6004: {
    name: 'TokenDisabled',
    title: 'TOKEN_DISABLED',
    description: 'This token has been temporarily disabled.',
    severity: 'warning',
  },
  6005: {
    name: 'LoanAmountTooLow',
    title: 'AMOUNT_TOO_LOW',
    description: 'The loan amount is below the minimum threshold.',
    suggestion: 'Increase your collateral amount.',
    severity: 'warning',
  },
  6006: {
    name: 'LoanAmountTooHigh',
    title: 'AMOUNT_TOO_HIGH',
    description: 'The loan amount exceeds the maximum allowed.',
    suggestion: 'Reduce your collateral amount.',
    severity: 'warning',
  },
  6007: {
    name: 'InsufficientCollateral',
    title: 'INSUFFICIENT_COLLATERAL',
    description: 'You don\'t have enough tokens to use as collateral.',
    suggestion: 'Reduce the loan amount or add more tokens to your wallet.',
    severity: 'warning',
  },
  6008: {
    name: 'LoanAlreadyRepaid',
    title: 'LOAN_ALREADY_REPAID',
    description: 'This loan has already been repaid or liquidated.',
    suggestion: 'Check your loan history for details.',
    severity: 'info',
  },
  6009: {
    name: 'LoanLiquidated',
    title: 'LOAN_LIQUIDATED',
    description: 'This loan has been liquidated.',
    suggestion: 'Your collateral was sold to cover the debt.',
    severity: 'warning',
  },
  6010: {
    name: 'LoanNotLiquidatable',
    title: 'NOT_LIQUIDATABLE',
    description: 'This loan cannot be liquidated yet.',
    severity: 'info',
  },

  // ========================================
  // Price & Math Errors (6011-6015)
  // ========================================
  6011: {
    name: 'InvalidPriceFeed',
    title: 'PRICE_ERROR',
    description: 'Unable to fetch a valid price for this token.',
    suggestion: 'Try again in a few moments.',
    severity: 'error',
  },
  6012: {
    name: 'StalePriceFeed',
    title: 'STALE_PRICE',
    description: 'The price data is too old to use safely.',
    suggestion: 'Wait a moment and try again.',
    severity: 'warning',
  },
  6013: {
    name: 'MathOverflow',
    title: 'CALCULATION_ERROR',
    description: 'A calculation error occurred (overflow).',
    suggestion: 'Try a smaller amount.',
    severity: 'error',
  },
  6014: {
    name: 'MathUnderflow',
    title: 'CALCULATION_ERROR',
    description: 'A calculation error occurred (underflow).',
    suggestion: 'Try a different amount.',
    severity: 'error',
  },
  6015: {
    name: 'DivisionByZero',
    title: 'CALCULATION_ERROR',
    description: 'A calculation error occurred (division by zero).',
    severity: 'error',
  },

  // ========================================
  // Loan Configuration Errors (6016-6020)
  // ========================================
  6016: {
    name: 'InvalidLoanDuration',
    title: 'INVALID_DURATION',
    description: 'The selected loan duration is not valid.',
    suggestion: 'Select a duration between 1 hour and 7 days.',
    severity: 'warning',
  },
  6017: {
    name: 'LtvTooHigh',
    title: 'LTV_TOO_HIGH',
    description: 'The loan-to-value ratio is too high.',
    severity: 'warning',
  },
  6018: {
    name: 'InsufficientTreasuryBalance',
    title: 'TREASURY_LOW',
    description: 'The protocol treasury has insufficient funds.',
    suggestion: 'Try a smaller loan amount.',
    severity: 'warning',
  },
  6019: {
    name: 'InvalidLiquidationBonus',
    title: 'CONFIG_ERROR',
    description: 'Invalid liquidation bonus configuration.',
    severity: 'error',
  },
  6020: {
    name: 'LoanNotUnhealthy',
    title: 'LOAN_HEALTHY',
    description: 'This loan is still healthy and cannot be liquidated.',
    severity: 'info',
  },

  // ========================================
  // Pool & Token Errors (6021-6030)
  // ========================================
  6021: {
    name: 'PriceDeviationTooHigh',
    title: 'PRICE_DEVIATION',
    description: 'Price deviation between sources is too high.',
    suggestion: 'Wait for prices to stabilize.',
    severity: 'warning',
  },
  6022: {
    name: 'InvalidPoolAddress',
    title: 'INVALID_POOL',
    description: 'The pool address is invalid.',
    severity: 'error',
  },
  6023: {
    name: 'TokenAlreadyWhitelisted',
    title: 'ALREADY_WHITELISTED',
    description: 'This token is already whitelisted.',
    severity: 'info',
  },
  6024: {
    name: 'InvalidAdminAddress',
    title: 'INVALID_ADMIN',
    description: 'Invalid admin address provided.',
    severity: 'error',
  },
  6025: {
    name: 'EmergencyModeActive',
    title: 'EMERGENCY_MODE',
    description: 'The protocol is in emergency mode.',
    suggestion: 'Please wait for normal operations to resume.',
    severity: 'critical',
  },
  6026: {
    name: 'InvalidTokenAccountOwner',
    title: 'INVALID_ACCOUNT',
    description: 'The token account owner is invalid.',
    severity: 'error',
  },
  6027: {
    name: 'InsufficientTokenBalance',
    title: 'INSUFFICIENT_BALANCE',
    description: 'You don\'t have enough tokens in your wallet.',
    suggestion: 'Add more tokens to your wallet.',
    severity: 'warning',
  },
  6028: {
    name: 'InvalidFeeConfiguration',
    title: 'CONFIG_ERROR',
    description: 'Invalid fee configuration.',
    severity: 'error',
  },
  6029: {
    name: 'PoolTypeMismatch',
    title: 'POOL_MISMATCH',
    description: 'The pool type does not match expected.',
    severity: 'error',
  },
  6030: {
    name: 'ZeroPrice',
    title: 'ZERO_PRICE',
    description: 'Token price is zero or unavailable.',
    suggestion: 'Try again later.',
    severity: 'error',
  },

  // ========================================
  // Duration & Validation Errors (6031-6037)
  // ========================================
  6031: {
    name: 'DurationTooShort',
    title: 'DURATION_TOO_SHORT',
    description: 'The loan duration is too short.',
    suggestion: 'Select a longer duration (minimum 1 hour).',
    severity: 'warning',
  },
  6032: {
    name: 'DurationTooLong',
    title: 'DURATION_TOO_LONG',
    description: 'The loan duration exceeds the maximum allowed.',
    suggestion: 'Select a shorter duration (maximum 7 days).',
    severity: 'warning',
  },
  6033: {
    name: 'InvalidPoolType',
    title: 'INVALID_POOL_TYPE',
    description: 'The pool type is not supported.',
    severity: 'error',
  },
  6034: {
    name: 'InvalidLoanAmount',
    title: 'INVALID_AMOUNT',
    description: 'The loan amount is invalid.',
    severity: 'warning',
  },
  6035: {
    name: 'ReentrancyDetected',
    title: 'SECURITY_ERROR',
    description: 'A security check failed. Please try again.',
    severity: 'error',
  },
  6036: {
    name: 'BelowMinimumDeposit',
    title: 'BELOW_MINIMUM',
    description: 'The amount is below the minimum required.',
    severity: 'warning',
  },
  6037: {
    name: 'LoanNotFound',
    title: 'LOAN_NOT_FOUND',
    description: 'The loan could not be found.',
    severity: 'error',
  },

  // ========================================
  // Staking Errors (6038-6041)
  // ========================================
  6038: {
    name: 'StakingPaused',
    title: 'STAKING_PAUSED',
    description: 'Staking is temporarily paused.',
    suggestion: 'Please try again later.',
    severity: 'warning',
  },
  6039: {
    name: 'NoRewardsToClaim',
    title: 'NO_REWARDS',
    description: 'You have no rewards to claim.',
    severity: 'info',
  },
  6040: {
    name: 'InsufficientRewardBalance',
    title: 'REWARDS_LOW',
    description: 'Insufficient rewards in the pool.',
    severity: 'warning',
  },
  6041: {
    name: 'InsufficientStakeBalance',
    title: 'STAKE_LOW',
    description: 'Insufficient staked balance.',
    severity: 'warning',
  },

  // ========================================
  // Swap & Liquidation Errors (6042-6046)
  // ========================================
  6042: {
    name: 'SlippageExceeded',
    title: 'SLIPPAGE_EXCEEDED',
    description: 'The price moved too much during the transaction.',
    suggestion: 'Try again - prices are volatile.',
    severity: 'warning',
  },
  6043: {
    name: 'MissingPumpfunAccounts',
    title: 'MISSING_ACCOUNTS',
    description: 'Required PumpFun accounts are missing.',
    severity: 'error',
  },
  6044: {
    name: 'MissingJupiterAccounts',
    title: 'MISSING_ACCOUNTS',
    description: 'Required Jupiter accounts are missing.',
    severity: 'error',
  },
  6045: {
    name: 'MissingJupiterSwapData',
    title: 'MISSING_DATA',
    description: 'Jupiter swap data is missing.',
    severity: 'error',
  },
  6046: {
    name: 'InvalidBondingCurve',
    title: 'INVALID_CURVE',
    description: 'The bonding curve is invalid.',
    severity: 'error',
  },

  // ========================================
  // Admin & Transfer Errors (6047-6049)
  // ========================================
  6047: {
    name: 'AdminTransferTooEarly',
    title: 'TIMELOCK_ACTIVE',
    description: 'Admin transfer timelock is still active.',
    severity: 'warning',
  },
  6048: {
    name: 'NoPendingAdminTransfer',
    title: 'NO_TRANSFER',
    description: 'No pending admin transfer found.',
    severity: 'info',
  },
  6049: {
    name: 'ProtocolNotPaused',
    title: 'NOT_PAUSED',
    description: 'The protocol is not paused.',
    severity: 'info',
  },

  // ========================================
  // Risk Management Errors (6050-6060)
  // ========================================
  6050: {
    name: 'CollateralValueTooLow',
    title: 'COLLATERAL_TOO_LOW',
    description: 'The collateral value is too low for a loan.',
    suggestion: 'Add more collateral.',
    severity: 'warning',
  },
  6051: {
    name: 'SlippageTooHigh',
    title: 'SLIPPAGE_HIGH',
    description: 'The configured slippage is too high.',
    severity: 'warning',
  },
  6052: {
    name: 'TokenExposureTooHigh',
    title: 'TOKEN_LIMIT_REACHED',
    description: 'The protocol has reached its limit for this token.',
    suggestion: 'Try again later or use a different token.',
    severity: 'warning',
  },
  6053: {
    name: 'UserExposureTooHigh',
    title: 'USER_LIMIT_REACHED',
    description: 'You have reached your maximum exposure limit.',
    suggestion: 'Repay existing loans before taking new ones.',
    severity: 'warning',
  },
  6054: {
    name: 'SingleLoanTooLarge',
    title: 'LOAN_TOO_LARGE',
    description: 'This loan exceeds the maximum single loan size.',
    suggestion: 'Reduce your collateral amount.',
    severity: 'warning',
  },
  6055: {
    name: 'InvalidFeeSplit',
    title: 'CONFIG_ERROR',
    description: 'Invalid fee split configuration.',
    severity: 'error',
  },
  6056: {
    name: 'InvalidPoolData',
    title: 'INVALID_DATA',
    description: 'The pool data is invalid or corrupted.',
    severity: 'error',
  },
  6057: {
    name: 'FeatureTemporarilyDisabled',
    title: 'FEATURE_DISABLED',
    description: 'This feature is temporarily disabled.',
    suggestion: 'Please try again later.',
    severity: 'warning',
  },
  6058: {
    name: 'CannotChangeTokenWithActiveStakes',
    title: 'ACTIVE_STAKES',
    description: 'Cannot modify token with active stakes.',
    severity: 'warning',
  },
  6059: {
    name: 'InvalidTokenMint',
    title: 'INVALID_MINT',
    description: 'The token mint is invalid.',
    severity: 'error',
  },
  6060: {
    name: 'InvalidTokenAccount',
    title: 'INVALID_ACCOUNT',
    description: 'The token account is invalid.',
    severity: 'error',
  },

  // ========================================
  // Epoch-based Staking Errors (6070-6080)
  // ========================================
  6070: {
    name: 'InvalidEpochDuration',
    title: 'INVALID_EPOCH',
    description: 'The epoch duration is invalid.',
    severity: 'error',
  },
  6071: {
    name: 'InvalidAmount',
    title: 'INVALID_AMOUNT',
    description: 'The amount is invalid.',
    severity: 'warning',
  },
  6072: {
    name: 'InsufficientStakedBalance',
    title: 'STAKE_INSUFFICIENT',
    description: 'You don\'t have enough staked balance.',
    severity: 'warning',
  },
  6073: {
    name: 'EpochNotEnded',
    title: 'EPOCH_ACTIVE',
    description: 'The current epoch has not ended yet.',
    suggestion: 'Wait for the epoch to end.',
    severity: 'info',
  },
  6074: {
    name: 'DistributionNotComplete',
    title: 'DISTRIBUTION_PENDING',
    description: 'Reward distribution is not complete.',
    severity: 'info',
  },
  6075: {
    name: 'NoEligibleStakers',
    title: 'NO_STAKERS',
    description: 'No eligible stakers found.',
    severity: 'info',
  },
  6076: {
    name: 'InvalidAccountPairs',
    title: 'INVALID_PAIRS',
    description: 'Invalid account pairs provided.',
    severity: 'error',
  },
  6077: {
    name: 'InvalidJupiterProgram',
    title: 'INVALID_PROGRAM',
    description: 'Invalid Jupiter program address.',
    severity: 'error',
  },
  6078: {
    name: 'InvalidVault',
    title: 'INVALID_VAULT',
    description: 'Invalid vault account.',
    severity: 'error',
  },
  6079: {
    name: 'StakingNotPaused',
    title: 'STAKING_ACTIVE',
    description: 'Staking is not paused.',
    severity: 'info',
  },
  6080: {
    name: 'StakeAmountTooLow',
    title: 'STAKE_TOO_LOW',
    description: 'The stake amount is below minimum.',
    suggestion: 'Increase your stake amount.',
    severity: 'warning',
  },

  // ========================================
  // Liquidator & Blacklist Errors (6081-6096)
  // ========================================
  6081: {
    name: 'MaxLoansReached',
    title: 'MAX_LOANS_REACHED',
    description: 'You have reached the maximum number of active loans.',
    suggestion: 'Repay existing loans before taking new ones.',
    severity: 'warning',
  },
  6082: {
    name: 'InvalidLiquidatorAddress',
    title: 'INVALID_LIQUIDATOR',
    description: 'Invalid liquidator address.',
    severity: 'error',
  },
  6083: {
    name: 'UnauthorizedLiquidator',
    title: 'UNAUTHORIZED_LIQUIDATOR',
    description: 'You are not authorized to liquidate loans.',
    severity: 'error',
  },
  6084: {
    name: 'TokenBlacklisted',
    title: 'TOKEN_BLACKLISTED',
    description: 'This token has been blacklisted.',
    suggestion: 'This token is no longer available for lending.',
    severity: 'error',
  },
  6085: {
    name: 'InvalidPriceAuthority',
    title: 'INVALID_AUTHORITY',
    description: 'Invalid price authority.',
    severity: 'error',
  },
  6086: {
    name: 'PriceSignatureExpired',
    title: 'SIGNATURE_EXPIRED',
    description: 'The price signature has expired.',
    suggestion: 'Please try again.',
    severity: 'warning',
  },
  6087: {
    name: 'InvalidPriceSignature',
    title: 'INVALID_SIGNATURE',
    description: 'Invalid price signature.',
    severity: 'error',
  },
  6088: {
    name: 'InvalidAccountOwner',
    title: 'INVALID_OWNER',
    description: 'Invalid account owner.',
    severity: 'error',
  },
  6089: {
    name: 'InvalidAccountData',
    title: 'INVALID_DATA',
    description: 'Invalid account data.',
    severity: 'error',
  },
  6090: {
    name: 'InvalidDiscriminator',
    title: 'INVALID_DISCRIMINATOR',
    description: 'Invalid account discriminator.',
    severity: 'error',
  },
  6091: {
    name: 'InvalidPDA',
    title: 'INVALID_PDA',
    description: 'Invalid program derived address.',
    severity: 'error',
  },
  6092: {
    name: 'InvalidStakeOwner',
    title: 'INVALID_STAKE_OWNER',
    description: 'You don\'t own this stake.',
    severity: 'error',
  },
  6093: {
    name: 'PumpfunNotMigrated',
    title: 'TOKEN_NOT_MIGRATED',
    description: 'PumpFun tokens must migrate to Raydium/PumpSwap before lending.',
    suggestion: 'Wait for the token to migrate or use a different token.',
    severity: 'warning',
  },
  6094: {
    name: 'InvalidTokenProgram',
    title: 'INVALID_PROGRAM',
    description: 'Invalid token program.',
    severity: 'error',
  },
  6095: {
    name: 'MissingPumpSwapVaults',
    title: 'MISSING_VAULTS',
    description: 'Missing PumpSwap vault accounts.',
    severity: 'error',
  },
  6096: {
    name: 'InvalidPumpSwapVault',
    title: 'INVALID_VAULT',
    description: 'Invalid PumpSwap vault address.',
    severity: 'error',
  },
};

/**
 * Parse error message and extract error code
 */
export function parseError(error: Error | string): ParsedError {
  const errorString = typeof error === 'string' ? error : error.message;
  
  // Check for API/Network errors first
  if (errorString.includes('Failed to prepare loan transaction')) {
    return {
      code: 'API_ERROR',
      name: 'LoanPreparationFailed',
      title: 'LOAN_PREPARATION_FAILED',
      description: 'Failed to prepare the loan transaction on the server.',
      suggestion: 'Check if the token is properly configured and try again.',
      severity: 'error',
    };
  }
  
  // Token not whitelisted error
  if (errorString.includes('Token not whitelisted') || errorString.includes('account not found')) {
    return {
      code: 'TOKEN_CONFIG_ERROR',
      name: 'TokenNotConfigured',
      title: 'TOKEN_NOT_CONFIGURED',
      description: 'This token is not properly configured for lending.',
      suggestion: 'Make sure the token is whitelisted and has a valid pool configuration.',
      severity: 'error',
    };
  }
  
  // Price fetch errors
  if (errorString.includes('Unable to fetch token price')) {
    return {
      code: 'PRICE_ERROR',
      name: 'PriceFetchFailed',
      title: 'PRICE_UNAVAILABLE',
      description: 'Could not fetch the current price for this token.',
      suggestion: 'The token may not have sufficient liquidity. Try again in a moment.',
      severity: 'error',
    };
  }
  
  // Rate limit errors
  if (errorString.includes('Rate limit exceeded')) {
    return {
      code: 'RATE_LIMIT',
      name: 'RateLimitExceeded',
      title: 'TOO_MANY_REQUESTS',
      description: 'You have made too many requests.',
      suggestion: 'Please wait a moment before trying again.',
      severity: 'warning',
    };
  }
  
  // Circuit breaker errors
  if (errorString.includes('Circuit breaker')) {
    return {
      code: 'CIRCUIT_BREAKER',
      name: 'SystemProtection',
      title: 'SYSTEM_PROTECTION_ACTIVE',
      description: 'The system is temporarily limiting new loans for safety.',
      suggestion: 'Please try again in a few minutes.',
      severity: 'warning',
    };
  }
  
  if (errorString.includes('500') || errorString.includes('Internal Server Error')) {
    return {
      code: 'SERVER_ERROR',
      name: 'ServerError',
      title: 'SERVER_ERROR',
      description: 'The server encountered an error processing your request.',
      suggestion: 'Please try again. If the problem persists, contact support.',
      severity: 'error',
    };
  }
  
  if (errorString.includes('fetch failed') || errorString.includes('Failed to fetch')) {
    return {
      code: 'NETWORK_ERROR',
      name: 'NetworkError',
      title: 'NETWORK_ERROR',
      description: 'Unable to connect to the server.',
      suggestion: 'Check your internet connection and try again.',
      severity: 'error',
    };
  }
  
  // Try to extract hex error code (e.g., 0x2ee8)
  const hexMatch = errorString.match(/custom program error: (0x[a-fA-F0-9]+)/);
  if (hexMatch) {
    const errorCode = parseInt(hexMatch[1], 16);
    const mapped = ERROR_MAP[errorCode];
    if (mapped) {
      return {
        code: hexMatch[1],
        ...mapped,
      };
    }
  }
  
  // Try to extract decimal error code
  const decimalMatch = errorString.match(/Error Number: (\d+)/);
  if (decimalMatch) {
    const errorCode = parseInt(decimalMatch[1], 10);
    const mapped = ERROR_MAP[errorCode];
    if (mapped) {
      return {
        code: `0x${errorCode.toString(16)}`,
        ...mapped,
      };
    }
  }
  
  // Try to extract error name directly
  const nameMatch = errorString.match(/Error Code: (\w+)/);
  if (nameMatch) {
    const errorName = nameMatch[1];
    const entry = Object.entries(ERROR_MAP).find(([_, v]) => v.name === errorName);
    if (entry) {
      return {
        code: `0x${parseInt(entry[0]).toString(16)}`,
        ...entry[1],
      };
    }
  }
  
  // Check for common Solana/wallet errors
  if (errorString.includes('User rejected')) {
    return {
      code: 'USER_REJECTED',
      name: 'UserRejected',
      title: 'TRANSACTION_CANCELLED',
      description: 'You cancelled the transaction.',
      severity: 'info',
    };
  }
  
  if (errorString.includes('insufficient funds') || errorString.includes('Insufficient')) {
    return {
      code: 'INSUFFICIENT_SOL',
      name: 'InsufficientSOL',
      title: 'INSUFFICIENT_SOL',
      description: 'You don\'t have enough SOL to pay for transaction fees.',
      suggestion: 'Add more SOL to your wallet.',
      severity: 'warning',
    };
  }
  
  if (errorString.includes('blockhash') || errorString.includes('expired')) {
    return {
      code: 'TX_EXPIRED',
      name: 'TransactionExpired',
      title: 'TRANSACTION_EXPIRED',
      description: 'The transaction took too long and expired.',
      suggestion: 'Please try again.',
      severity: 'warning',
    };
  }
  
  if (errorString.includes('timeout') || errorString.includes('Timeout')) {
    return {
      code: 'TIMEOUT',
      name: 'Timeout',
      title: 'CONNECTION_TIMEOUT',
      description: 'The network request timed out.',
      suggestion: 'Check your connection and try again.',
      severity: 'warning',
    };
  }
  
  // Solana simulation errors
  if (errorString.includes('Simulation failed') || errorString.includes('simulation failed')) {
    // Extract specific error from logs
    if (errorString.includes('panicked at')) {
      const panicMatch = errorString.match(/panicked at ([^"]+)/);
      const panicMessage = panicMatch ? panicMatch[1] : 'Program panic';
      return {
        code: 'PROGRAM_PANIC',
        name: 'ProgramPanic',
        title: 'PROGRAM_ERROR',
        description: `The on-chain program encountered an error: ${panicMessage}`,
        suggestion: 'This is a program bug. Please report this issue.',
        severity: 'critical',
      };
    }
    
    if (errorString.includes('custom program error')) {
      // Try to parse the custom error
      return parseError(errorString); // Recursive call to handle custom errors
    }
    
    return {
      code: 'SIMULATION_FAILED',
      name: 'SimulationFailed',
      title: 'TRANSACTION_SIMULATION_FAILED',
      description: 'The transaction failed during simulation.',
      suggestion: 'Check your inputs and try again.',
      severity: 'error',
    };
  }
  
  // Default fallback
  return {
    code: 'UNKNOWN',
    name: 'UnknownError',
    title: 'TRANSACTION_FAILED',
    description: 'An unexpected error occurred.',
    suggestion: 'Please try again or contact support.',
    severity: 'error',
  };
}

/**
 * Check if error is a "protocol paused" error
 */
export function isProtocolPausedError(error: Error | string): boolean {
  const parsed = parseError(error);
  return parsed.name === 'ProtocolPaused';
}