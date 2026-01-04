use anchor_lang::prelude::*;

pub mod error;
pub mod instructions;
pub mod state;
pub mod utils;
pub mod swap;
pub mod events;

use instructions::*;

declare_id!("46YbCjkHDPYWWNZZEPsvWeLweFtzmPEeCnDP87zDTZFU");

#[program]
pub mod memecoin_lending {
    use super::*;

    /// Initialize the protocol with admin and wallet addresses
    pub fn initialize(
        ctx: Context<Initialize>,
        admin: Pubkey,
        buyback_wallet: Pubkey,
        operations_wallet: Pubkey,
    ) -> Result<()> {
        instructions::initialize::initialize_handler(ctx, admin, buyback_wallet, operations_wallet)
    }

    /// Whitelist a new token for lending
    pub fn whitelist_token(
        ctx: Context<WhitelistToken>,
        tier: u8,
        pool_address: Pubkey,
        pool_type: u8,
        min_loan_amount: u64,
        max_loan_amount: u64,
        is_protocol_token: bool,
    ) -> Result<()> {
        instructions::whitelist_token::whitelist_token_handler(ctx, tier, pool_address, pool_type, min_loan_amount, max_loan_amount, is_protocol_token)
    }

    /// Update token configuration parameters
    pub fn update_token_config(
        ctx: Context<UpdateTokenConfig>,
        enabled: Option<bool>,
        ltv_bps: Option<u16>,
    ) -> Result<()> {
        instructions::update_token_config::update_token_config_handler(ctx, enabled, ltv_bps)
    }

    /// Create a new collateralized loan
    pub fn create_loan(
        ctx: Context<CreateLoan>,
        collateral_amount: u64,
        duration_seconds: u64,
    ) -> Result<()> {
        instructions::create_loan::create_loan_handler(ctx, collateral_amount, duration_seconds)
    }

    /// Repay an active loan
    pub fn repay_loan(ctx: Context<RepayLoan>) -> Result<()> {
        instructions::repay_loan::repay_loan_handler(ctx)
    }

    /// Liquidate a loan - sells collateral and splits proceeds
    /// For PumpFun tokens: uses PumpFun bonding curve
    /// For other tokens: uses Jupiter aggregator
    pub fn liquidate<'info>(
        ctx: Context<'_, '_, 'info, 'info, Liquidate<'info>>,
        min_sol_output: u64,
        jupiter_swap_data: Option<Vec<u8>>, // None for PumpFun, Some for Jupiter
    ) -> Result<()> {
        instructions::liquidate::liquidate_handler(ctx, min_sol_output, jupiter_swap_data)
    }

    /// Pause protocol operations (admin only)
    pub fn pause_protocol(ctx: Context<AdminControl>) -> Result<()> {
        instructions::admin::pause_handler(ctx)
    }

    /// Resume protocol operations (admin only)
    pub fn resume_protocol(ctx: Context<AdminControl>) -> Result<()> {
        instructions::admin::resume_handler(ctx)
    }

    /// Emergency admin update (requires protocol to be paused)
    pub fn update_admin(ctx: Context<AdminControl>, new_admin: Pubkey) -> Result<()> {
        instructions::admin::update_admin_handler(ctx, new_admin)
    }

    /// Initiate admin transfer with 48h timelock
    pub fn initiate_admin_transfer(ctx: Context<AdminControl>, new_admin: Pubkey) -> Result<()> {
        instructions::admin::initiate_admin_transfer_handler(ctx, new_admin)
    }

    /// Accept admin transfer after timelock
    pub fn accept_admin_transfer(ctx: Context<AcceptAdminTransfer>) -> Result<()> {
        instructions::admin::accept_admin_transfer_handler(ctx)
    }

    /// Cancel pending admin transfer
    pub fn cancel_admin_transfer(ctx: Context<AdminControl>) -> Result<()> {
        instructions::admin::cancel_admin_transfer_handler(ctx)
    }

    /// Withdraw treasury funds (admin only)
    pub fn withdraw_treasury(ctx: Context<WithdrawTreasury>, amount: u64) -> Result<()> {
        instructions::admin::withdraw_treasury_handler(ctx, amount)
    }


    /// Emergency drain (admin only)
    pub fn emergency_drain(ctx: Context<EmergencyDrain>) -> Result<()> {
        instructions::admin::emergency_drain_handler(ctx)
    }

    /// Fund the treasury with SOL
    pub fn fund_treasury(ctx: Context<FundTreasury>, amount: u64) -> Result<()> {
        instructions::fund_treasury::fund_treasury_handler(ctx, amount)
    }

    /// Update fee configuration (admin only)
    pub fn update_fees(
        ctx: Context<UpdateFees>,
        protocol_fee_bps: Option<u16>,
        treasury_fee_bps: Option<u16>,
        buyback_fee_bps: Option<u16>,
        operations_fee_bps: Option<u16>,
    ) -> Result<()> {
        instructions::update_fees::update_fees_handler(ctx, protocol_fee_bps, treasury_fee_bps, buyback_fee_bps, operations_fee_bps)
    }

    /// Update wallet addresses (admin only)
    pub fn update_wallets(
        ctx: Context<AdminControl>,
        new_admin: Option<Pubkey>,
        new_buyback_wallet: Option<Pubkey>,
        new_operations_wallet: Option<Pubkey>,
    ) -> Result<()> {
        instructions::admin::update_wallets_handler(ctx, new_admin, new_buyback_wallet, new_operations_wallet)
    }
    /// Initialize epoch-based staking pool
    pub fn initialize_staking(
        ctx: Context<InitializeStaking>,
        epoch_duration: i64,
    ) -> Result<()> {
        instructions::staking::initialize_staking::initialize_staking_handler(ctx, epoch_duration)
    }

    /// Stake governance tokens
    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        instructions::staking::stake::stake_handler(ctx, amount)
    }

    /// Unstake governance tokens
    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        instructions::staking::unstake::unstake_handler(ctx, amount)
    }

    /// Claim staking rewards (SOL)
    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        instructions::staking::claim_rewards::claim_rewards_handler(ctx)
    }

    /// Deposit SOL rewards to pool (admin/fee distribution)
    pub fn deposit_rewards(ctx: Context<DepositRewards>, amount: u64) -> Result<()> {
        instructions::staking::deposit_rewards::deposit_rewards_handler(ctx, amount)
    }

    /// Pause staking (admin only)
    pub fn pause_staking(ctx: Context<PauseStaking>) -> Result<()> {
        instructions::staking::admin_staking::pause_staking_handler(ctx)
    }

    /// Resume staking (admin only)
    pub fn resume_staking(ctx: Context<PauseStaking>) -> Result<()> {
        instructions::staking::admin_staking::resume_staking_handler(ctx)
    }

    /// Update epoch duration (admin only)
    pub fn update_epoch_duration(ctx: Context<UpdateEpochDuration>, new_duration: i64) -> Result<()> {
        instructions::staking::admin_staking::update_epoch_duration_handler(ctx, new_duration)
    }

    /// Force advance to next epoch (admin only)
    pub fn force_advance_epoch(ctx: Context<ForceAdvanceEpoch>) -> Result<()> {
        instructions::staking::admin_staking::force_advance_epoch_handler(ctx)
    }

    /// Emergency withdraw all rewards (admin only)
    pub fn emergency_withdraw(ctx: Context<EmergencyWithdraw>) -> Result<()> {
        instructions::staking::admin_staking::emergency_withdraw_handler(ctx)
    }

    /// Initialize fee receiver for creator fees (40/40/20 staker-focused split)
    pub fn initialize_fee_receiver(
        ctx: Context<InitializeFeeReceiver>,
        treasury_split_bps: u16,
        staking_split_bps: u16,
        operations_split_bps: u16,  // Renamed from dev_split_bps
    ) -> Result<()> {
        instructions::fee_distribution::initialize_fee_receiver_handler(
            ctx,
            treasury_split_bps,
            staking_split_bps,
            operations_split_bps,
        )
    }

    /// Distribute accumulated creator fees
    pub fn distribute_creator_fees(ctx: Context<DistributeCreatorFees>) -> Result<()> {
        instructions::fee_distribution::distribute_creator_fees_handler(ctx)
    }

    /// Emergency drain staking reward vault (admin only)
    pub fn emergency_drain_rewards(ctx: Context<EmergencyDrainRewards>) -> Result<()> {
        instructions::staking::emergency_drain_rewards::emergency_drain_rewards_handler(ctx)
    }
}