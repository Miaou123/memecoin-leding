use anchor_lang::prelude::*;

#[error_code]
pub enum LendingError {
    #[msg("Paused")]
    ProtocolPaused = 6000,

    #[msg("Unauthorized")]
    Unauthorized = 6001,

    #[msg("Invalid tier")]
    InvalidTokenTier = 6002,

    #[msg("Not whitelisted")]
    TokenNotWhitelisted = 6003,

    #[msg("Token disabled")]
    TokenDisabled = 6004,

    #[msg("Amount too low")]
    LoanAmountTooLow = 6005,

    #[msg("Amount too high")]
    LoanAmountTooHigh = 6006,

    #[msg("Insufficient collateral")]
    InsufficientCollateral = 6007,

    #[msg("Already repaid")]
    LoanAlreadyRepaid = 6008,

    #[msg("Liquidated")]
    LoanLiquidated = 6009,

    #[msg("Not liquidatable")]
    LoanNotLiquidatable = 6010,

    #[msg("Invalid price")]
    InvalidPriceFeed = 6011,

    #[msg("Stale price")]
    StalePriceFeed = 6012,

    #[msg("Overflow")]
    MathOverflow = 6013,

    #[msg("Underflow")]
    MathUnderflow = 6014,

    #[msg("Division zero")]
    DivisionByZero = 6015,

    #[msg("Invalid duration")]
    InvalidLoanDuration = 6016,

    #[msg("LTV too high")]
    LtvTooHigh = 6017,

    #[msg("Treasury insufficient")]
    InsufficientTreasuryBalance = 6018,

    #[msg("Invalid bonus")]
    InvalidLiquidationBonus = 6019,

    #[msg("Loan healthy")]
    LoanNotUnhealthy = 6020,

    #[msg("Price deviation")]
    PriceDeviationTooHigh = 6021,

    #[msg("Invalid pool")]
    InvalidPoolAddress = 6022,

    #[msg("Already whitelisted")]
    TokenAlreadyWhitelisted = 6023,

    #[msg("Invalid admin")]
    InvalidAdminAddress = 6024,

    #[msg("Emergency mode")]
    EmergencyModeActive = 6025,

    #[msg("Invalid owner")]
    InvalidTokenAccountOwner = 6026,

    #[msg("Insufficient balance")]
    InsufficientTokenBalance = 6027,

    #[msg("Invalid fee")]
    InvalidFeeConfiguration = 6028,

    #[msg("Pool mismatch")]
    PoolTypeMismatch = 6029,

    #[msg("Zero price")]
    ZeroPrice = 6030,

    #[msg("Duration short")]
    DurationTooShort = 6031,

    #[msg("Duration long")]
    DurationTooLong = 6032,

    #[msg("Invalid type")]
    InvalidPoolType = 6033,

    #[msg("Invalid amount")]
    InvalidLoanAmount = 6034,

    #[msg("Reentrancy")]
    ReentrancyDetected = 6035,

    #[msg("Below minimum")]
    BelowMinimumDeposit = 6036,

    #[msg("Not found")]
    LoanNotFound = 6037,

    #[msg("Staking paused")]
    StakingPaused = 6038,

    #[msg("No rewards")]
    NoRewardsToClaim = 6039,

    #[msg("Rewards insufficient")]
    InsufficientRewardBalance = 6040,

    #[msg("Stake insufficient")]
    InsufficientStakeBalance = 6041,

    #[msg("Slippage exceeded")]
    SlippageExceeded = 6042,

    #[msg("Missing Pumpfun")]
    MissingPumpfunAccounts = 6043,

    #[msg("Missing Jupiter")]
    MissingJupiterAccounts = 6044,

    #[msg("Missing data")]
    MissingJupiterSwapData = 6045,

    #[msg("Invalid curve")]
    InvalidBondingCurve = 6046,

    // New errors from this fix batch
    #[msg("Timelock active")]
    AdminTransferTooEarly = 6047,

    #[msg("No transfer")]
    NoPendingAdminTransfer = 6048,

    #[msg("Not paused")]
    ProtocolNotPaused = 6049,

    #[msg("Collateral low")]
    CollateralValueTooLow = 6050,

    #[msg("Slippage high")]
    SlippageTooHigh = 6051,

    #[msg("Token exposure")]
    TokenExposureTooHigh = 6052,

    #[msg("User exposure")]
    UserExposureTooHigh = 6053,

    #[msg("Loan large")]
    SingleLoanTooLarge = 6054,

    #[msg("Invalid split")]
    InvalidFeeSplit = 6055,

    #[msg("Invalid exchange data")]
    InvalidExchangeData = 6056,

    #[msg("Disabled")]
    FeatureTemporarilyDisabled = 6057,

    #[msg("Active stakes")]
    CannotChangeTokenWithActiveStakes = 6058,

    #[msg("Invalid mint")]
    InvalidTokenMint = 6059,

    #[msg("Invalid account")]
    InvalidTokenAccount = 6060,

    // Epoch-based staking errors
    #[msg("Invalid epoch")]
    InvalidEpochDuration = 6070,

    #[msg("Invalid amount")]
    InvalidAmount = 6071,

    #[msg("Insufficient stake")]
    InsufficientStakedBalance = 6072,

    #[msg("Epoch active")]
    EpochNotEnded = 6073,

    #[msg("Distribution pending")]
    DistributionNotComplete = 6074,

    #[msg("No stakers")]
    NoEligibleStakers = 6075,

    #[msg("Invalid pairs")]
    InvalidAccountPairs = 6076,
    
    #[msg("Invalid Jupiter program")]
    InvalidJupiterProgram = 6077,
    
    #[msg("Invalid vault")]
    InvalidVault = 6078,
    
    #[msg("Staking not paused")]
    StakingNotPaused = 6079,
    
    #[msg("Stake too low")]
    StakeAmountTooLow = 6080,
    
    #[msg("Max loans reached")]
    MaxLoansReached = 6081,
    
    #[msg("Invalid liquidator address")]
    InvalidLiquidatorAddress = 6082,

    #[msg("Unauthorized liquidator")]
    UnauthorizedLiquidator = 6083,
    
    #[msg("Token blacklisted")]
    TokenBlacklisted = 6084,
    
    #[msg("Invalid price authority")]
    InvalidPriceAuthority = 6085,

    #[msg("Price signature expired")]
    PriceSignatureExpired = 6086,

    // Keeping InvalidPriceSignature for potential future use
    // to avoid renumbering all subsequent error codes
    #[msg("Invalid price signature")]
    InvalidPriceSignature = 6087,
    
    #[msg("Invalid account owner")]
    InvalidAccountOwner = 6088,

    #[msg("Invalid account data")]
    InvalidAccountData = 6089,

    #[msg("Invalid discriminator")]
    InvalidDiscriminator = 6090,

    #[msg("Invalid PDA")]
    InvalidPDA = 6091,

    #[msg("Invalid stake owner")]
    InvalidStakeOwner = 6092,

    #[msg("PumpFun tokens must migrate to Raydium/PumpSwap before lending is enabled")]
    PumpfunNotMigrated = 6093,
    
    #[msg("Invalid token program - must be SPL Token or Token-2022")]
    InvalidTokenProgram = 6094,
    
    #[msg("Missing PumpSwap vault accounts")]
    MissingPumpSwapVaults = 6095,

    #[msg("Invalid PumpSwap vault address")]
    InvalidPumpSwapVault = 6096,

    #[msg("Invalid pool owner - must be PumpSwap program")]
    InvalidPoolOwner = 6097,

    #[msg("Pool token mismatch - base_mint doesn't match expected token")]
    PoolTokenMismatch = 6098,

    #[msg("Invalid quote mint - must be WSOL")]
    InvalidQuoteMint = 6099,

    #[msg("Invalid pool data structure")]
    InvalidPoolData = 6100,
}