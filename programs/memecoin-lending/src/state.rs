use anchor_lang::prelude::*;

/// Global protocol state
#[account]
#[derive(Default)]
pub struct ProtocolState {
    /// Protocol admin
    pub admin: Pubkey,
    /// Buyback wallet address for fee distribution
    pub buyback_wallet: Pubkey,
    /// Operations wallet address for fee distribution
    pub operations_wallet: Pubkey,
    /// Whether protocol is paused
    pub paused: bool,
    /// Total number of loans created
    pub total_loans_created: u64,
    /// Total SOL borrowed across all loans
    pub total_sol_borrowed: u64,
    /// Total interest earned by protocol
    pub total_interest_earned: u64,
    /// Number of currently active loans
    pub active_loans_count: u64,
    /// Protocol fee in basis points (out of 10,000)
    pub protocol_fee_bps: u16,
    /// Treasury fee split in basis points (default 9000 = 90%)
    pub treasury_fee_bps: u16,
    /// Buyback fee split in basis points (default 500 = 5%)
    pub buyback_fee_bps: u16,
    /// Operations fee split in basis points (default 500 = 5%)
    pub operations_fee_bps: u16,
    /// Bump seed for PDA
    pub bump: u8,
}

impl ProtocolState {
    pub const LEN: usize = 8 + // discriminator
        32 + // admin
        32 + // buyback_wallet
        32 + // operations_wallet
        1 + // paused
        8 + // total_loans_created
        8 + // total_sol_borrowed
        8 + // total_interest_earned
        8 + // active_loans_count
        2 + // protocol_fee_bps
        2 + // treasury_fee_bps
        2 + // buyback_fee_bps
        2 + // operations_fee_bps
        1; // bump
}

/// Token configuration for whitelisted tokens
#[account]
#[derive(Default)]
pub struct TokenConfig {
    /// Token mint address
    pub mint: Pubkey,
    /// Token tier (Bronze=0, Silver=1, Gold=2)
    pub tier: TokenTier,
    /// Whether token is enabled for lending
    pub enabled: bool,
    /// Pool address for price feeds (Raydium, Orca, etc.)
    pub pool_address: Pubkey,
    /// Pool type for price reading
    pub pool_type: PoolType,
    /// Loan-to-value ratio in basis points (7000 = 70%)
    pub ltv_bps: u16,
    /// Annual interest rate in basis points (1000 = 10%)
    pub interest_rate_bps: u16,
    /// Liquidation bonus in basis points (500 = 5%)
    pub liquidation_bonus_bps: u16,
    /// Minimum loan amount in lamports
    pub min_loan_amount: u64,
    /// Maximum loan amount in lamports
    pub max_loan_amount: u64,
    /// Number of active loans for this token
    pub active_loans_count: u64,
    /// Total trading volume for analytics
    pub total_volume: u64,
    /// Bump seed for PDA
    pub bump: u8,
}

impl TokenConfig {
    pub const LEN: usize = 8 + // discriminator
        32 + // mint
        1 + // tier
        1 + // enabled
        32 + // pool_address
        1 + // pool_type
        2 + // ltv_bps
        2 + // interest_rate_bps
        2 + // liquidation_bonus_bps
        8 + // min_loan_amount
        8 + // max_loan_amount
        8 + // active_loans_count
        8 + // total_volume
        1; // bump
}

/// Individual loan account
#[account]
#[derive(Default)]
pub struct Loan {
    /// Borrower's wallet address
    pub borrower: Pubkey,
    /// Token mint being used as collateral
    pub token_mint: Pubkey,
    /// Amount of collateral tokens deposited
    pub collateral_amount: u64,
    /// Amount of SOL borrowed
    pub sol_borrowed: u64,
    /// Token price when loan was created (in SOL per token)
    pub entry_price: u64,
    /// Price at which liquidation is triggered
    pub liquidation_price: u64,
    /// Interest rate for this loan (basis points)
    pub interest_rate_bps: u16,
    /// When the loan was created
    pub created_at: i64,
    /// When the loan is due
    pub due_at: i64,
    /// Current loan status
    pub status: LoanStatus,
    /// Loan index (for PDA generation)
    pub index: u64,
    /// Bump seed for PDA
    pub bump: u8,
}

impl Loan {
    pub const LEN: usize = 8 + // discriminator
        32 + // borrower
        32 + // token_mint
        8 + // collateral_amount
        8 + // sol_borrowed
        8 + // entry_price
        8 + // liquidation_price
        2 + // interest_rate_bps
        8 + // created_at
        8 + // due_at
        1 + // status
        8 + // index
        1; // bump
}

/// Pool type enum for different AMM protocols
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PoolType {
    Raydium = 0,
    Orca = 1,
    Pumpfun = 2,
    PumpSwap = 3,
}

impl Default for PoolType {
    fn default() -> Self {
        PoolType::Raydium
    }
}

/// Token tier enum
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum TokenTier {
    Bronze = 0,
    Silver = 1,
    Gold = 2,
}

impl Default for TokenTier {
    fn default() -> Self {
        TokenTier::Bronze
    }
}

/// Loan status enum
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum LoanStatus {
    Active = 0,
    Repaid = 1,
    LiquidatedTime = 2,
    LiquidatedPrice = 3,
}

impl Default for LoanStatus {
    fn default() -> Self {
        LoanStatus::Active
    }
}

/// Seeds for PDA derivation
pub const PROTOCOL_STATE_SEED: &[u8] = b"protocol_state";
pub const TOKEN_CONFIG_SEED: &[u8] = b"token_config";
pub const LOAN_SEED: &[u8] = b"loan";
pub const TREASURY_SEED: &[u8] = b"treasury";
pub const VAULT_SEED: &[u8] = b"vault";