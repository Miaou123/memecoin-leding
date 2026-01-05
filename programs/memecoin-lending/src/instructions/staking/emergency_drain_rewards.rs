use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use crate::state::*;
use crate::error::LendingError;

#[derive(Accounts)]
pub struct EmergencyDrainRewards<'info> {
    #[account(
        mut,
        seeds = [b"staking_pool"],
        bump,
        has_one = authority @ LendingError::Unauthorized
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    #[account(
        mut,
        seeds = [b"reward_vault"],
        bump
    )]
    /// CHECK: This is the reward vault PDA
    pub reward_vault: AccountInfo<'info>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn emergency_drain_rewards_handler(ctx: Context<EmergencyDrainRewards>) -> Result<()> {
    let staking_pool = &ctx.accounts.staking_pool;
    let reward_vault = &ctx.accounts.reward_vault;
    let authority = &ctx.accounts.authority;
    
    // Require staking to be paused for emergency drain
    require!(staking_pool.paused, LendingError::StakingNotPaused);
    
    // Get current balance
    let vault_balance = reward_vault.lamports();
    
    if vault_balance == 0 {
        return Err(LendingError::InsufficientRewardBalance.into());
    }
    
    // Leave minimum rent-exempt balance
    let rent = Rent::get()?;
    let min_balance = rent.minimum_balance(0);
    let drain_amount = vault_balance.saturating_sub(min_balance);
    
    if drain_amount == 0 {
        return Ok(());
    }
    
    
    // Transfer SOL from reward vault to authority
    let bump = ctx.bumps.reward_vault;
    let seeds = &[
        b"reward_vault".as_ref(),
        &[bump],
    ];
    let signer = &[&seeds[..]];
    
    let cpi_context = CpiContext::new_with_signer(
        ctx.accounts.system_program.to_account_info(),
        Transfer {
            from: reward_vault.to_account_info(),
            to: authority.to_account_info(),
        },
        signer,
    );
    
    transfer(cpi_context, drain_amount)?;
    
    
    Ok(())
}