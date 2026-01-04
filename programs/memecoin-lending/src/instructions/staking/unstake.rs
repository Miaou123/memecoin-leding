use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::error::LendingError;
use super::epoch_helpers::{maybe_advance_epoch, maybe_initialize_user_snapshot};

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(
        mut,
        seeds = [STAKING_POOL_SEED],
        bump = staking_pool.bump
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    #[account(
        mut,
        seeds = [USER_STAKE_SEED, staking_pool.key().as_ref(), user.key().as_ref()],
        bump = user_stake.bump,
        constraint = user_stake.owner == user.key() @ LendingError::Unauthorized
    )]
    pub user_stake: Account<'info, UserStake>,
    
    #[account(
        mut,
        constraint = staking_vault.mint == staking_pool.staking_token_mint @ LendingError::InvalidTokenAccount
    )]
    pub staking_vault: Account<'info, TokenAccount>,
    
    /// CHECK: PDA authority for staking vault
    #[account(
        seeds = [STAKING_VAULT_SEED],
        bump
    )]
    pub staking_vault_authority: AccountInfo<'info>,
    
    #[account(
        mut,
        constraint = user_token_account.mint == staking_pool.staking_token_mint @ LendingError::InvalidTokenAccount,
        constraint = user_token_account.owner == user.key() @ LendingError::InvalidTokenAccount
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}

pub fn unstake_handler(ctx: Context<Unstake>, amount: u64) -> Result<()> {
    require!(amount > 0, LendingError::InvalidAmount);
    
    let clock = Clock::get()?;
    let staking_pool = &mut ctx.accounts.staking_pool;
    let user_stake = &mut ctx.accounts.user_stake;
    
    require!(user_stake.staked_amount >= amount, LendingError::InsufficientStakedBalance);
    
    // Auto-advance epoch if needed
    maybe_advance_epoch(staking_pool, clock.unix_timestamp)?;
    
    // Initialize snapshot if user just became eligible
    maybe_initialize_user_snapshot(user_stake, staking_pool)?;
    
    // Check if user was eligible (affects current_epoch_eligible_stake)
    let was_eligible = user_stake.snapshot_initialized;
    
    // Update amounts
    user_stake.staked_amount = user_stake.staked_amount
        .checked_sub(amount)
        .ok_or(LendingError::MathUnderflow)?;
    
    staking_pool.total_staked = staking_pool.total_staked
        .checked_sub(amount)
        .ok_or(LendingError::MathUnderflow)?;
    
    // If user was eligible, reduce eligible stake
    // This means they LOSE current epoch rewards proportionally (anti-gaming)
    if was_eligible {
        staking_pool.current_epoch_eligible_stake = staking_pool.current_epoch_eligible_stake
            .saturating_sub(amount);
    }
    
    // If fully unstaked, reset for anti-gaming
    if user_stake.staked_amount == 0 {
        user_stake.stake_start_epoch = staking_pool.current_epoch;
        user_stake.reward_per_token_snapshot = 0;
        user_stake.snapshot_initialized = false;
        msg!("Fully unstaked. User must wait full epoch to earn again.");
    }
    
    // Transfer tokens back to user
    let seeds = &[STAKING_VAULT_SEED, &[ctx.bumps.staking_vault_authority]];
    let signer_seeds = &[&seeds[..]];
    
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.staking_vault.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.staking_vault_authority.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;
    
    msg!(
        "Unstaked {} tokens. User remaining: {}. Pool total: {}",
        amount,
        user_stake.staked_amount,
        staking_pool.total_staked
    );
    
    Ok(())
}