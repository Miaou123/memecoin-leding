use anchor_lang::prelude::*;

// === SEEDS ===
pub const PROTOCOL_STATE_SEED: &[u8] = b"protocol_state";
pub const TREASURY_SEED: &[u8] = b"treasury";
pub const TOKEN_CONFIG_SEED: &[u8] = b"token_config";
pub const LOAN_SEED: &[u8] = b"loan";
pub const VAULT_SEED: &[u8] = b"vault";
pub const STAKING_POOL_SEED: &[u8] = b"staking_pool";
pub const STAKING_VAULT_SEED: &[u8] = b"staking_vault";
pub const REWARD_VAULT_SEED: &[u8] = b"reward_vault";
pub const USER_STAKE_SEED: &[u8] = b"user_stake";
pub const FEE_RECEIVER_SEED: &[u8] = b"fee_receiver";
pub const USER_EXPOSURE_SEED: &[u8] = b"user_exposure";  // NEW!

// === PROTOCOL PARAMETERS ===
pub const PROTOCOL_FEE_BPS: u16 = 200;           // 2% flat fee
pub const DEFAULT_LTV_BPS: u16 = 5000;           // 50% LTV
pub const LIQUIDATION_THRESHOLD_BPS: u16 = 4000; // 40% drop triggers liquidation

// === EXPOSURE LIMITS ===
pub const MAX_TOKEN_EXPOSURE_BPS: u16 = 1000;    // 10% of treasury per token
pub const MAX_USER_EXPOSURE_BPS: u16 = 3000;     // 30% of treasury per user
pub const MAX_SINGLE_LOAN_BPS: u16 = 1000;       // 10% of treasury per loan

// === SLIPPAGE ===
pub const DEFAULT_SLIPPAGE_BPS: u16 = 300;       // 3% default slippage
pub const MAX_SLIPPAGE_BPS: u16 = 1500;          // 15% max slippage
pub const SLIPPAGE_INCREMENT_BPS: u16 = 200;     // 2% increment per retry

// === STAKING ===
/// Precision for reward calculations (1e12)
pub const REWARD_PRECISION: u128 = 1_000_000_000_000;

// === LTV RATIOS BY TIER (in basis points) ===
pub const LTV_BRONZE_BPS: u16 = 2500;  // 25%
pub const LTV_SILVER_BPS: u16 = 3500;  // 35%
pub const LTV_GOLD_BPS: u16 = 5000;    // 50%

// === LIQUIDITY THRESHOLDS (in USD) ===
pub const LIQUIDITY_THRESHOLD_SILVER_USD: u64 = 100_000;
pub const LIQUIDITY_THRESHOLD_GOLD_USD: u64 = 300_000;

// === BASIS POINTS ===
pub const BPS_DIVISOR: u64 = 10000;

// === ADMIN TRANSFER ===
pub const ADMIN_TRANSFER_DELAY: i64 = 48 * 60 * 60; // 48 hours in seconds

// === LOAN FEE DISTRIBUTION (out of 10000) ===
// These define how the 2% loan fee is split
pub const LOAN_FEE_TREASURY_BPS: u16 = 5000;     // 50% of fee → Treasury (1.0% of loan)
pub const LOAN_FEE_STAKING_BPS: u16 = 2500;      // 25% of fee → Staking (0.5% of loan)
pub const LOAN_FEE_OPERATIONS_BPS: u16 = 2500;   // 25% of fee → Operations (0.5% of loan)

// === CREATOR FEE DISTRIBUTION (out of 10000) ===
// Staker-focused split for PumpFun creator fees
pub const CREATOR_FEE_TREASURY_BPS: u16 = 4000;     // 40%
pub const CREATOR_FEE_STAKING_BPS: u16 = 4000;      // 40%
pub const CREATOR_FEE_OPERATIONS_BPS: u16 = 2000;   // 20%

// === LIQUIDATION FEE DISTRIBUTION (out of 10000) ===
pub const LIQUIDATION_TREASURY_BPS: u16 = 9500;     // 95%
pub const LIQUIDATION_OPERATIONS_BPS: u16 = 500;    // 5%

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
    /// Total fees earned by protocol
    pub total_fees_earned: u64,
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
    /// Track SOL in treasury
    pub treasury_balance: u64,
    /// Deprecated field - kept for account compatibility
    pub _deprecated_liquidation_bonus: u16,
    /// Reentrancy protection guard
    pub reentrancy_guard: bool,
    /// Pending admin for two-step transfer
    pub pending_admin: Pubkey,
    /// Timestamp when admin transfer was initiated
    pub admin_transfer_timestamp: i64,
    /// Bump seed for PDA
    pub bump: u8,
    /// Reserved for future upgrades
    pub _reserved: [u8; 32],
}

impl ProtocolState {
    pub const LEN: usize = 8 + // discriminator
        32 + // admin
        32 + // buyback_wallet
        32 + // operations_wallet
        1 + // paused
        8 + // total_loans_created
        8 + // total_sol_borrowed
        8 + // total_fees_earned
        8 + // active_loans_count
        2 + // protocol_fee_bps
        2 + // treasury_fee_bps
        2 + // buyback_fee_bps
        2 + // operations_fee_bps
        8 + // treasury_balance
        2 + // _deprecated_liquidation_bonus
        1 + // reentrancy_guard
        32 + // pending_admin
        8 + // admin_transfer_timestamp
        1 + // bump
        32; // _reserved
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
    /// Deprecated field - kept for account compatibility
    pub _deprecated_liquidation_bonus: u16,
    /// Minimum loan amount in lamports
    pub min_loan_amount: u64,
    /// Maximum loan amount in lamports
    pub max_loan_amount: u64,
    /// Number of active loans for this token
    pub active_loans_count: u64,
    /// Total trading volume for analytics
    pub total_volume: u64,
    /// Total SOL currently borrowed against this token (for exposure tracking)
    pub total_active_borrowed: u64,
    /// Whether this is the protocol's own token (always gets 50% LTV)
    pub is_protocol_token: bool,
    /// Bump seed for PDA
    pub bump: u8,
    /// Reserved for future use
    pub _reserved: [u8; 32],
}

impl TokenConfig {
    pub const LEN: usize = 8 + // discriminator
        32 + // mint
        1 + // tier
        1 + // enabled
        32 + // pool_address
        1 + // pool_type
        2 + // ltv_bps
        2 + // _deprecated_liquidation_bonus
        8 + // min_loan_amount
        8 + // max_loan_amount
        8 + // active_loans_count
        8 + // total_volume
        8 + // total_active_borrowed
        1 + // is_protocol_token
        1 + // bump
        32; // _reserved
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
    /// Reserved for future use
    pub _reserved: [u8; 32],
}

impl Loan {
    pub const LEN: usize = 8 + // discriminator
        32 + // borrower
        32 + // token_mint
        8 + // collateral_amount
        8 + // sol_borrowed
        8 + // entry_price
        8 + // liquidation_price
        8 + // created_at
        8 + // due_at
        1 + // status
        8 + // index
        1 + // bump
        32; // _reserved
}

/// User exposure tracking account
/// Tracks total borrowed amount per user to enforce 30% treasury limit
#[account]
#[derive(Default)]
pub struct UserExposure {
    /// User's wallet address
    pub user: Pubkey,
    /// Total SOL currently borrowed by this user
    pub total_borrowed: u64,
    /// Number of active loans
    pub active_loans_count: u64,
    /// Historical total borrowed (for analytics)
    pub lifetime_borrowed: u64,
    /// Number of loans repaid successfully
    pub loans_repaid: u64,
    /// Number of loans liquidated
    pub loans_liquidated: u64,
    /// Bump seed for PDA
    pub bump: u8,
    /// Reserved for future use
    pub _reserved: [u8; 32],
}

impl UserExposure {
    pub const LEN: usize = 8 +  // discriminator
        32 + // user
        8 +  // total_borrowed
        8 +  // active_loans_count
        8 +  // lifetime_borrowed
        8 +  // loans_repaid
        8 +  // loans_liquidated
        1 +  // bump
        32;  // _reserved
}

/// Pool type enum for different AMM protocols
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
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
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
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
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
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

// Note: SEEDS are already defined above at lines 4-14, removing duplicates

/// Staking pool with epoch-based rewards
#[account]
pub struct StakingPool {
    /// Authority (admin) who can update config
    pub authority: Pubkey,
    
    /// The governance token mint that users stake
    pub staking_token_mint: Pubkey,
    
    /// PDA that holds staked tokens
    pub staking_vault: Pubkey,
    
    /// PDA that holds SOL rewards
    pub reward_vault: Pubkey,
    
    // === Epoch Configuration ===
    
    /// Current epoch number
    pub current_epoch: u64,
    
    /// Duration of each epoch in seconds (e.g., 300 for 5 minutes)
    pub epoch_duration: i64,
    
    /// Timestamp when current epoch started
    pub epoch_start_time: i64,
    
    // === Staking State ===
    
    /// Total tokens staked currently
    pub total_staked: u64,
    
    /// Total staked that is eligible for current epoch rewards
    /// (users who were staked since before current epoch started)
    pub current_epoch_eligible_stake: u64,
    
    // === Reward Accumulator (KEY CHANGE) ===
    
    /// Accumulated reward per token (scaled by REWARD_PRECISION)
    /// Increases each epoch: += (epoch_rewards * PRECISION) / eligible_stake
    pub reward_per_token_accumulated: u128,
    
    /// Rewards accumulated for current epoch (to be added to accumulator when epoch ends)
    pub current_epoch_rewards: u64,
    
    // === Historical Tracking ===
    
    /// Total SOL rewards distributed all-time
    pub total_rewards_distributed: u64,
    
    /// Total SOL rewards deposited all-time
    pub total_rewards_deposited: u64,
    
    /// Total number of completed epochs
    pub total_epochs_completed: u64,
    
    // === State Flags ===
    
    /// Whether staking is paused
    pub paused: bool,
    
    /// Bump seed for PDA
    pub bump: u8,
    
    /// Reserved for future upgrades
    pub _reserved: [u8; 64],
}

impl StakingPool {
    pub const LEN: usize = 8 +  // discriminator
        32 +    // authority
        32 +    // staking_token_mint
        32 +    // staking_vault
        32 +    // reward_vault
        8 +     // current_epoch
        8 +     // epoch_duration
        8 +     // epoch_start_time
        8 +     // total_staked
        8 +     // current_epoch_eligible_stake
        16 +    // reward_per_token_accumulated (u128)
        8 +     // current_epoch_rewards
        8 +     // total_rewards_distributed
        8 +     // total_rewards_deposited
        8 +     // total_epochs_completed
        1 +     // paused
        1 +     // bump
        64;     // _reserved
}

/// Individual user's stake position
#[account]
pub struct UserStake {
    /// Owner of this stake
    pub owner: Pubkey,
    
    /// The staking pool this belongs to
    pub pool: Pubkey,
    
    /// Amount of tokens currently staked
    pub staked_amount: u64,
    
    /// Epoch when user staked (or last re-staked)
    /// User becomes eligible at epoch AFTER this one
    pub stake_start_epoch: u64,
    
    /// Reward per token snapshot - set when user BECOMES ELIGIBLE
    /// This is their "starting point" for reward calculations
    pub reward_per_token_snapshot: u128,
    
    /// Whether the snapshot has been initialized
    /// (set to true at the end of stake_start_epoch)
    pub snapshot_initialized: bool,
    
    /// Last epoch for which user claimed rewards (for tracking)
    pub last_claimed_epoch: u64,
    
    /// Total rewards claimed all-time (for UI/tracking)
    pub total_rewards_claimed: u64,
    
    /// Timestamp of first stake
    pub first_stake_time: i64,
    
    /// Bump seed for PDA
    pub bump: u8,
    
    /// Reserved for future upgrades
    pub _reserved: [u8; 32],
}

impl UserStake {
    pub const LEN: usize = 8 +  // discriminator
        32 +    // owner
        32 +    // pool
        8 +     // staked_amount
        8 +     // stake_start_epoch
        16 +    // reward_per_token_snapshot (u128)
        1 +     // snapshot_initialized
        8 +     // last_claimed_epoch
        8 +     // total_rewards_claimed
        8 +     // first_stake_time
        1 +     // bump
        32;     // _reserved
}

/// Historical record of each epoch's rewards
/// Stored separately to allow claiming old epochs
#[account]
pub struct EpochRewardRecord {
    /// The epoch this record is for
    pub epoch: u64,
    
    /// Total rewards distributed this epoch
    pub total_rewards: u64,
    
    /// Total eligible stake during this epoch
    pub total_eligible_stake: u64,
    
    /// Timestamp when epoch ended
    pub ended_at: i64,
    
    /// Bump seed
    pub bump: u8,
}

impl EpochRewardRecord {
    pub const LEN: usize = 8 +  // discriminator
        8 +     // epoch
        8 +     // total_rewards
        8 +     // total_eligible_stake
        8 +     // ended_at
        1;      // bump
}

/// Fee receiver account for collecting pumpfun creator fees
#[account]
pub struct FeeReceiver {
    /// Authority who can update config
    pub authority: Pubkey,
    
    /// Treasury wallet (40% of creator fees)
    pub treasury_wallet: Pubkey,
    
    /// Operations wallet (20% of creator fees) - RENAMED from dev_wallet
    pub operations_wallet: Pubkey,
    
    /// Staking reward vault PDA (40% of creator fees)
    pub staking_reward_vault: Pubkey,
    
    /// Fee splits in basis points (must sum to 10000)
    pub treasury_split_bps: u16,      // Default: 4000 (40%)
    pub staking_split_bps: u16,       // Default: 4000 (40%)
    pub operations_split_bps: u16,    // Default: 2000 (20%)
    
    /// Total fees received all-time
    pub total_fees_received: u64,
    
    /// Total fees distributed all-time
    pub total_fees_distributed: u64,
    
    /// Bump seed
    pub bump: u8,
    
    /// Reserved
    pub _reserved: [u8; 32],
}

impl FeeReceiver {
    pub const LEN: usize = 8 +  // discriminator
        32 +    // authority
        32 +    // treasury_wallet
        32 +    // operations_wallet (renamed from dev_wallet)
        32 +    // staking_reward_vault
        2 +     // treasury_split_bps
        2 +     // staking_split_bps
        2 +     // operations_split_bps
        8 +     // total_fees_received
        8 +     // total_fees_distributed
        1 +     // bump
        32;     // _reserved
}