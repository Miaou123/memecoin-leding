use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::*;
use crate::error::LendingError;

#[derive(Accounts)]
pub struct FundTreasury<'info> {
    #[account(
        seeds = [PROTOCOL_STATE_SEED],
        bump = protocol_state.bump
    )]
    pub protocol_state: Account<'info, ProtocolState>,
    
    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump
    )]
    pub treasury: SystemAccount<'info>,
    
    #[account(mut)]
    pub funder: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn fund_treasury_handler(ctx: Context<FundTreasury>, amount: u64) -> Result<()> {
    require!(amount > 0, LendingError::InvalidLoanAmount);

    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.funder.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
            },
        ),
        amount,
    )?;
    
    // Note: We don't track treasury_balance in protocol_state anymore
    // to avoid desync issues. Always use ctx.accounts.treasury.lamports()
    // for the actual balance.
    
    Ok(())
}