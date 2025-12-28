use anchor_lang::prelude::*;

pub mod error;
pub mod instructions;
pub mod state;
pub mod utils;

use instructions::*;

declare_id!("11111111111111111111111111111112");

#[program]
pub mod memecoin_lending {
    use super::*;

    /// Initialize the protocol with admin
    pub fn initialize(ctx: Context<Initialize>, admin: Pubkey) -> Result<()> {
        instructions::initialize::handler(ctx, admin)
    }

    /// Whitelist a new token for lending
    pub fn whitelist_token(
        ctx: Context<WhitelistToken>,
        tier: u8,
        pool_address: Pubkey,
    ) -> Result<()> {
        instructions::whitelist_token::handler(ctx, tier, pool_address)
    }

    /// Update token configuration parameters
    pub fn update_token_config(
        ctx: Context<UpdateTokenConfig>,
        enabled: Option<bool>,
        ltv_bps: Option<u16>,
        interest_rate_bps: Option<u16>,
    ) -> Result<()> {
        instructions::update_token_config::handler(ctx, enabled, ltv_bps, interest_rate_bps)
    }

    /// Create a new collateralized loan
    pub fn create_loan(
        ctx: Context<CreateLoan>,
        collateral_amount: u64,
        duration_seconds: u64,
    ) -> Result<()> {
        instructions::create_loan::handler(ctx, collateral_amount, duration_seconds)
    }

    /// Repay an active loan
    pub fn repay_loan(ctx: Context<RepayLoan>) -> Result<()> {
        instructions::repay_loan::handler(ctx)
    }

    /// Liquidate a loan (time or price based)
    pub fn liquidate(ctx: Context<Liquidate>) -> Result<()> {
        instructions::liquidate::handler(ctx)
    }

    /// Pause protocol operations (admin only)
    pub fn pause_protocol(ctx: Context<AdminControl>) -> Result<()> {
        instructions::admin::pause_handler(ctx)
    }

    /// Resume protocol operations (admin only)
    pub fn resume_protocol(ctx: Context<AdminControl>) -> Result<()> {
        instructions::admin::resume_handler(ctx)
    }

    /// Update protocol admin (admin only)
    pub fn update_admin(ctx: Context<AdminControl>, new_admin: Pubkey) -> Result<()> {
        instructions::admin::update_admin_handler(ctx, new_admin)
    }

    /// Withdraw treasury funds (admin only)
    pub fn withdraw_treasury(ctx: Context<WithdrawTreasury>, amount: u64) -> Result<()> {
        instructions::admin::withdraw_treasury_handler(ctx, amount)
    }

    /// Update liquidation bonus (admin only)
    pub fn update_liquidation_bonus(
        ctx: Context<AdminControl>,
        new_bonus_bps: u16,
    ) -> Result<()> {
        instructions::admin::update_liquidation_bonus_handler(ctx, new_bonus_bps)
    }

    /// Emergency drain (admin only)
    pub fn emergency_drain(ctx: Context<EmergencyDrain>) -> Result<()> {
        instructions::admin::emergency_drain_handler(ctx)
    }
}