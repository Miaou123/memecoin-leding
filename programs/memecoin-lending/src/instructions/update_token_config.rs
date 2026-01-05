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

pub fn update_token_config_handler(
    ctx: Context<UpdateTokenConfig>,
    enabled: Option<bool>,
    ltv_bps: Option<u16>,
) -> Result<()> {
    let token_config = &mut ctx.accounts.token_config;
    
    // Update enabled status
    if let Some(enabled_value) = enabled {
        token_config.enabled = enabled_value;
    }

    // Update LTV ratio with validation
    if let Some(ltv_value) = ltv_bps {
        if ltv_value > 9000 { // Max 90% LTV
            return Err(LendingError::LtvTooHigh.into());
        }
        token_config.ltv_bps = ltv_value;
    }

    
    Ok(())
}