use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::LendingError;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = ProtocolState::LEN,
        seeds = [PROTOCOL_STATE_SEED],
        bump
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    /// Protocol treasury account (PDA)
    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump
    )]
    pub treasury: SystemAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<Initialize>, admin: Pubkey) -> Result<()> {
    let protocol_state = &mut ctx.accounts.protocol_state;
    
    // Validate admin address
    if admin == Pubkey::default() {
        return Err(LendingError::InvalidAdminAddress.into());
    }

    // Initialize protocol state
    protocol_state.admin = admin;
    protocol_state.paused = false;
    protocol_state.total_loans_created = 0;
    protocol_state.total_sol_borrowed = 0;
    protocol_state.total_interest_earned = 0;
    protocol_state.treasury_balance = 0;
    protocol_state.protocol_fee_bps = 50; // 0.5%
    protocol_state.liquidation_bonus_bps = 500; // 5%
    protocol_state.bump = ctx.bumps.protocol_state;

    msg!("Protocol initialized with admin: {}", admin);
    
    Ok(())
}