use anchor_lang::prelude::*;

#[error_code]
pub enum LendingError {
    #[msg("Protocol is currently paused")]
    ProtocolPaused,

    #[msg("Only admin can perform this action")]
    Unauthorized,

    #[msg("Invalid token tier")]
    InvalidTokenTier,

    #[msg("Token is not whitelisted")]
    TokenNotWhitelisted,

    #[msg("Token is disabled for lending")]
    TokenDisabled,

    #[msg("Loan amount is below minimum")]
    LoanAmountTooLow,

    #[msg("Loan amount exceeds maximum")]
    LoanAmountTooHigh,

    #[msg("Insufficient collateral for loan")]
    InsufficientCollateral,

    #[msg("Loan has already been repaid")]
    LoanAlreadyRepaid,

    #[msg("Loan has been liquidated")]
    LoanLiquidated,

    #[msg("Loan is not due for liquidation")]
    LoanNotLiquidatable,

    #[msg("Invalid price feed data")]
    InvalidPriceFeed,

    #[msg("Price feed is stale")]
    StalePriceFeed,

    #[msg("Math overflow")]
    MathOverflow,

    #[msg("Math underflow")]
    MathUnderflow,

    #[msg("Division by zero")]
    DivisionByZero,

    #[msg("Invalid loan duration")]
    InvalidLoanDuration,

    #[msg("Interest rate too high")]
    InterestRateTooHigh,

    #[msg("LTV ratio too high")]
    LtvTooHigh,

    #[msg("Insufficient treasury balance")]
    InsufficientTreasuryBalance,

    #[msg("Invalid liquidation bonus")]
    InvalidLiquidationBonus,

    #[msg("Cannot liquidate healthy loan")]
    LoanNotUnhealthy,

    #[msg("Price deviation too high")]
    PriceDeviationTooHigh,

    #[msg("Invalid pool address")]
    InvalidPoolAddress,

    #[msg("Token already whitelisted")]
    TokenAlreadyWhitelisted,

    #[msg("Invalid admin address")]
    InvalidAdminAddress,

    #[msg("Emergency mode active")]
    EmergencyModeActive,

    #[msg("Invalid token account owner")]
    InvalidTokenAccountOwner,

    #[msg("Insufficient token balance")]
    InsufficientTokenBalance,

    #[msg("Invalid fee configuration - splits must sum to 10000")]
    InvalidFeeConfiguration,
    
    #[msg("Pool type mismatch")]
    PoolTypeMismatch,
    
    #[msg("Price is zero or invalid")]
    ZeroPrice,
    
    #[msg("Loan duration too short (min 12 hours)")]
    DurationTooShort,
    
    #[msg("Loan duration too long (max 7 days)")]
    DurationTooLong,

    #[msg("Invalid pool type")]
    InvalidPoolType,

    #[msg("Invalid loan amount")]
    InvalidLoanAmount,

    #[msg("Reentrancy detected")]
    ReentrancyDetected,
    
    #[msg("Minimum deposit amount not met")]
    BelowMinimumDeposit,
    
    #[msg("Loan not found")]
    LoanNotFound,
    
    #[msg("Price too volatile for safe lending")]
    PriceTooVolatile,
    
    #[msg("Cooldown period not elapsed")]
    CooldownNotElapsed,
    
    #[msg("Maximum loans per user exceeded")]
    MaxLoansExceeded,
    
    #[msg("Treasury utilization too high")]
    TreasuryUtilizationTooHigh,
}