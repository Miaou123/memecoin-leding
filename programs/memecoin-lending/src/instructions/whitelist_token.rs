use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::LendingError;

#[derive(Accounts)]
#[instruction(tier: u8)]
pub struct WhitelistToken<'info> {
    #[account(
        seeds = [PROTOCOL_STATE_SEED],
        bump = protocol_state.bump,
        constraint = !protocol_state.paused @ LendingError::ProtocolPaused,
        constraint = protocol_state.admin == admin.key() @ LendingError::Unauthorized
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    #[account(
        init,
        payer = admin,
        space = TokenConfig::LEN,
        seeds = [TOKEN_CONFIG_SEED, token_mint.key().as_ref()],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,

    pub token_mint: Account<'info, anchor_spl::token::Mint>,

    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<WhitelistToken>, tier: u8, pool_address: Pubkey) -> Result<()> {
    let token_config = &mut ctx.accounts.token_config;
    
    // Validate tier
    let token_tier = match tier {
        0 => TokenTier::Bronze,
        1 => TokenTier::Silver,
        2 => TokenTier::Gold,
        _ => return Err(LendingError::InvalidTokenTier.into()),
    };

    // Validate pool address
    if pool_address == Pubkey::default() {
        return Err(LendingError::InvalidPoolAddress.into());
    }

    // Set default parameters based on tier
    let (ltv_bps, interest_rate_bps, liquidation_bonus_bps, min_loan, max_loan) = match token_tier {
        TokenTier::Bronze => (6000, 1500, 800, 100_000_000, 5_000_000_000), // 60% LTV, 15% APR
        TokenTier::Silver => (7000, 1200, 600, 50_000_000, 10_000_000_000),  // 70% LTV, 12% APR
        TokenTier::Gold => (8000, 1000, 500, 10_000_000, 50_000_000_000),   // 80% LTV, 10% APR
    };

    // Initialize token config
    token_config.mint = ctx.accounts.token_mint.key();
    token_config.tier = token_tier;
    token_config.enabled = true;
    token_config.pool_address = pool_address;
    token_config.ltv_bps = ltv_bps;
    token_config.interest_rate_bps = interest_rate_bps;
    token_config.liquidation_bonus_bps = liquidation_bonus_bps;
    token_config.min_loan_amount = min_loan;
    token_config.max_loan_amount = max_loan;
    token_config.bump = ctx.bumps.token_config;

    msg!("Token whitelisted: {} (tier: {:?})", ctx.accounts.token_mint.key(), token_tier);
    
    Ok(())
}