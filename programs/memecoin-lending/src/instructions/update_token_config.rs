use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::LendingError;

#[derive(Accounts)]
pub struct UpdateTokenConfig<'info> {
    #[account(
        seeds = [PROTOCOL_STATE_SEED],
        bump = protocol_state.bump,
        constraint = !protocol_state.paused @ LendingError::ProtocolPaused,
        constraint = protocol_state.admin == admin.key() @ LendingError::Unauthorized
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    #[account(
        mut,
        seeds = [TOKEN_CONFIG_SEED, token_config.mint.as_ref()],
        bump = token_config.bump
    )]
    pub token_config: Account<'info, TokenConfig>,

    pub admin: Signer<'info>,
}

pub fn handler(
    ctx: Context<UpdateTokenConfig>,
    enabled: Option<bool>,
    ltv_bps: Option<u16>,
    interest_rate_bps: Option<u16>,
) -> Result<()> {
    let token_config = &mut ctx.accounts.token_config;
    
    // Update enabled status
    if let Some(enabled_value) = enabled {
        token_config.enabled = enabled_value;
        msg!("Token {} enabled status updated to: {}", token_config.mint, enabled_value);
    }

    // Update LTV ratio with validation
    if let Some(ltv_value) = ltv_bps {
        if ltv_value > 9000 { // Max 90% LTV
            return Err(LendingError::LtvTooHigh.into());
        }
        token_config.ltv_bps = ltv_value;
        msg!("Token {} LTV updated to: {} bps", token_config.mint, ltv_value);
    }

    // Update interest rate with validation
    if let Some(interest_value) = interest_rate_bps {
        if interest_value > 5000 { // Max 50% APR
            return Err(LendingError::InterestRateTooHigh.into());
        }
        token_config.interest_rate_bps = interest_value;
        msg!("Token {} interest rate updated to: {} bps", token_config.mint, interest_value);
    }
    
    Ok(())
}