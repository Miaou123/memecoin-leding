use anchor_lang::prelude::*;

#[error_code]
pub enum LendingError {
    #[msg("E6000: Protocol is currently paused")]
    ProtocolPaused = 6000,

    #[msg("E6001: Only admin can perform this action")]
    Unauthorized = 6001,

    #[msg("E6002: Invalid token tier")]
    InvalidTokenTier = 6002,

    #[msg("E6003: Token is not whitelisted")]
    TokenNotWhitelisted = 6003,

    #[msg("E6004: Token is disabled for lending")]
    TokenDisabled = 6004,

    #[msg("E6005: Loan amount is below minimum")]
    LoanAmountTooLow = 6005,

    #[msg("E6006: Loan amount exceeds maximum")]
    LoanAmountTooHigh = 6006,

    #[msg("E6007: Insufficient collateral for loan")]
    InsufficientCollateral = 6007,

    #[msg("E6008: Loan has already been repaid")]
    LoanAlreadyRepaid = 6008,

    #[msg("E6009: Loan has been liquidated")]
    LoanLiquidated = 6009,

    #[msg("E6010: Loan is not due for liquidation")]
    LoanNotLiquidatable = 6010,

    #[msg("E6011: Invalid price feed data")]
    InvalidPriceFeed = 6011,

    #[msg("E6012: Price feed is stale")]
    StalePriceFeed = 6012,

    #[msg("E6013: Math overflow")]
    MathOverflow = 6013,

    #[msg("E6014: Math underflow")]
    MathUnderflow = 6014,

    #[msg("E6015: Division by zero")]
    DivisionByZero = 6015,

    #[msg("E6016: Invalid loan duration")]
    InvalidLoanDuration = 6016,

    #[msg("E6017: LTV ratio too high")]
    LtvTooHigh = 6017,

    #[msg("E6018: Insufficient treasury balance")]
    InsufficientTreasuryBalance = 6018,

    #[msg("E6019: Invalid liquidation bonus")]
    InvalidLiquidationBonus = 6019,

    #[msg("E6020: Cannot liquidate healthy loan")]
    LoanNotUnhealthy = 6020,

    #[msg("E6021: Price deviation too high")]
    PriceDeviationTooHigh = 6021,

    #[msg("E6022: Invalid pool address")]
    InvalidPoolAddress = 6022,

    #[msg("E6023: Token already whitelisted")]
    TokenAlreadyWhitelisted = 6023,

    #[msg("E6024: Invalid admin address")]
    InvalidAdminAddress = 6024,

    #[msg("E6025: Emergency mode active")]
    EmergencyModeActive = 6025,

    #[msg("E6026: Invalid token account owner")]
    InvalidTokenAccountOwner = 6026,

    #[msg("E6027: Insufficient token balance")]
    InsufficientTokenBalance = 6027,

    #[msg("E6028: Invalid fee configuration - splits must sum to 10000")]
    InvalidFeeConfiguration = 6028,

    #[msg("E6029: Pool type mismatch")]
    PoolTypeMismatch = 6029,

    #[msg("E6030: Price is zero or invalid")]
    ZeroPrice = 6030,

    #[msg("E6031: Loan duration too short (min 12 hours)")]
    DurationTooShort = 6031,

    #[msg("E6032: Loan duration too long (max 7 days)")]
    DurationTooLong = 6032,

    #[msg("E6033: Invalid pool type")]
    InvalidPoolType = 6033,

    #[msg("E6034: Invalid loan amount")]
    InvalidLoanAmount = 6034,

    #[msg("E6035: Reentrancy detected")]
    ReentrancyDetected = 6035,

    #[msg("E6036: Minimum deposit amount not met")]
    BelowMinimumDeposit = 6036,

    #[msg("E6037: Loan not found")]
    LoanNotFound = 6037,

    #[msg("E6038: Staking pool is paused")]
    StakingPaused = 6038,

    #[msg("E6039: No rewards to claim")]
    NoRewardsToClaim = 6039,

    #[msg("E6040: Insufficient reward balance")]
    InsufficientRewardBalance = 6040,

    #[msg("E6041: Insufficient stake balance")]
    InsufficientStakeBalance = 6041,

    #[msg("E6042: Slippage tolerance exceeded")]
    SlippageExceeded = 6042,

    #[msg("E6043: Missing PumpFun accounts")]
    MissingPumpfunAccounts = 6043,

    #[msg("E6044: Missing Jupiter accounts")]
    MissingJupiterAccounts = 6044,

    #[msg("E6045: Missing Jupiter swap data")]
    MissingJupiterSwapData = 6045,

    #[msg("E6046: Invalid bonding curve")]
    InvalidBondingCurve = 6046,

    // New errors from this fix batch
    #[msg("E6047: Admin transfer timelock not expired")]
    AdminTransferTooEarly = 6047,

    #[msg("E6048: No pending admin transfer")]
    NoPendingAdminTransfer = 6048,

    #[msg("E6049: Protocol must be paused for emergency admin update")]
    ProtocolNotPaused = 6049,

    #[msg("E6050: Collateral value below minimum required")]
    CollateralValueTooLow = 6050,

    #[msg("E6051: Slippage tolerance too high")]
    SlippageTooHigh = 6051,

    #[msg("E6052: Token exposure limit exceeded (max 10% of treasury per token)")]
    TokenExposureTooHigh = 6052,

    #[msg("E6053: User exposure limit exceeded (max 30% of treasury per user)")]
    UserExposureTooHigh = 6053,

    #[msg("E6054: Single loan exceeds maximum (10% of treasury)")]
    SingleLoanTooLarge = 6054,

    #[msg("E6055: Invalid fee split configuration")]
    InvalidFeeSplit = 6055,

    #[msg("E6056: Invalid pool data")]
    InvalidPoolData = 6056,
}