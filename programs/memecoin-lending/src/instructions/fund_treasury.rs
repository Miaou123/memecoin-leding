use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::*;
use crate::error::LendingError;
use crate::utils::*;

#[derive(Accounts)]
pub struct FundTreasury<'info> {
    #[account(
        mut,
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

    // Need to make protocol_state mutable
    let protocol_state = &mut ctx.accounts.protocol_state;

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
    
    // Track the deposit
    protocol_state.treasury_balance = SafeMath::add(protocol_state.treasury_balance, amount)?;
    
    msg!("Treasury funded with {} lamports by {}", amount, ctx.accounts.funder.key());
    Ok(())
}