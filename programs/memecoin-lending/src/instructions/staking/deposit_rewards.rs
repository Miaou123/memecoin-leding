use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::*;
use crate::error::LendingError;

#[derive(Accounts)]
pub struct DepositRewards<'info> {
    #[account(
        mut,
        seeds = [STAKING_POOL_SEED],
        bump = staking_pool.bump
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    #[account(
        mut,
        seeds = [REWARD_VAULT_SEED],
        bump
    )]
    pub reward_vault: SystemAccount<'info>,
    
    #[account(mut)]
    pub depositor: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn deposit_rewards_handler(ctx: Context<DepositRewards>, amount: u64) -> Result<()> {
    require!(amount > 0, LendingError::InvalidAmount);
    
    let staking_pool = &mut ctx.accounts.staking_pool;
    
    // Transfer SOL to reward vault
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.depositor.to_account_info(),
                to: ctx.accounts.reward_vault.to_account_info(),
            },
        ),
        amount,
    )?;
    
    // Add to current epoch's rewards
    staking_pool.current_epoch_rewards = staking_pool.current_epoch_rewards
        .checked_add(amount)
        .ok_or(LendingError::MathOverflow)?;
    
    staking_pool.total_rewards_deposited = staking_pool.total_rewards_deposited
        .checked_add(amount)
        .ok_or(LendingError::MathOverflow)?;
    
    
    Ok(())
}