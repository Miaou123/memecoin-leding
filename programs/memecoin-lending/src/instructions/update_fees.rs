use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::LendingError;

#[derive(Accounts)]
pub struct UpdateFees<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_STATE_SEED],
        bump = protocol_state.bump,
        constraint = protocol_state.admin == admin.key() @ LendingError::Unauthorized
    )]
    pub protocol_state: Account<'info, ProtocolState>,
    
    pub admin: Signer<'info>,
}

pub fn update_fees_handler(
    ctx: Context<UpdateFees>,
    protocol_fee_bps: Option<u16>,
    treasury_fee_bps: Option<u16>,
    buyback_fee_bps: Option<u16>,
    operations_fee_bps: Option<u16>,
) -> Result<()> {
    let protocol_state = &mut ctx.accounts.protocol_state;
    
    if let Some(fee) = protocol_fee_bps {
        require!(fee <= 500, LendingError::InvalidFeeConfiguration); // Max 5%
        protocol_state.protocol_fee_bps = fee;
    }
    
    // If updating liquidation splits, validate they sum to 10000
    let treasury = treasury_fee_bps.unwrap_or(protocol_state.treasury_fee_bps);
    let buyback = buyback_fee_bps.unwrap_or(protocol_state.buyback_fee_bps);
    let operations = operations_fee_bps.unwrap_or(protocol_state.operations_fee_bps);
    
    require!(
        treasury + buyback + operations == 10000,
        LendingError::InvalidFeeConfiguration
    );
    
    protocol_state.treasury_fee_bps = treasury;
    protocol_state.buyback_fee_bps = buyback;
    protocol_state.operations_fee_bps = operations;
    
    msg!("Fees updated: protocol={}, treasury={}, buyback={}, operations={}", 
         protocol_state.protocol_fee_bps, treasury, buyback, operations);
    
    Ok(())
}