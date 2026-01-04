use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::error::LendingError;
use super::epoch_helpers::{maybe_advance_epoch, maybe_initialize_user_snapshot};

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(
        mut,
        seeds = [STAKING_POOL_SEED],
        bump = staking_pool.bump,
        constraint = !staking_pool.paused @ LendingError::StakingPaused
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    #[account(
        init_if_needed,
        payer = user,
        space = UserStake::LEN,
        seeds = [USER_STAKE_SEED, staking_pool.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_stake: Account<'info, UserStake>,
    
    #[account(
        mut,
        constraint = staking_vault.mint == staking_pool.staking_token_mint @ LendingError::InvalidTokenAccount
    )]
    pub staking_vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = user_token_account.mint == staking_pool.staking_token_mint @ LendingError::InvalidTokenAccount,
        constraint = user_token_account.owner == user.key() @ LendingError::InvalidTokenAccount
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn stake_handler(ctx: Context<Stake>, amount: u64) -> Result<()> {
    require!(amount > 0, LendingError::InvalidAmount);
    
    let clock = Clock::get()?;
    let staking_pool = &mut ctx.accounts.staking_pool;
    let user_stake = &mut ctx.accounts.user_stake;
    
    // Auto-advance epoch if needed (this updates reward_per_token_accumulated)
    maybe_advance_epoch(staking_pool, clock.unix_timestamp)?;
    
    // Check if this is a new stake or existing
    let is_new_stake = user_stake.owner == Pubkey::default();
    let was_zero_stake = user_stake.staked_amount == 0;
    
    if is_new_stake {
        // Brand new user
        user_stake.owner = ctx.accounts.user.key();
        user_stake.pool = staking_pool.key();
        user_stake.staked_amount = 0;
        user_stake.stake_start_epoch = staking_pool.current_epoch;
        user_stake.reward_per_token_snapshot = 0;
        user_stake.snapshot_initialized = false;
        user_stake.last_claimed_epoch = staking_pool.current_epoch;
        user_stake.total_rewards_claimed = 0;
        user_stake.first_stake_time = clock.unix_timestamp;
        user_stake.bump = ctx.bumps.user_stake;
    } else if was_zero_stake {
        // Re-staking after full unstake - reset (anti-gaming)
        user_stake.stake_start_epoch = staking_pool.current_epoch;
        user_stake.reward_per_token_snapshot = 0;
        user_stake.snapshot_initialized = false;
        user_stake.last_claimed_epoch = staking_pool.current_epoch;
    } else {
        // Adding to existing stake - check if snapshot needs initialization
        maybe_initialize_user_snapshot(user_stake, staking_pool)?;
    }
    
    // Update user stake amount
    user_stake.staked_amount = user_stake.staked_amount
        .checked_add(amount)
        .ok_or(LendingError::MathOverflow)?;
    
    // Update pool totals
    staking_pool.total_staked = staking_pool.total_staked
        .checked_add(amount)
        .ok_or(LendingError::MathOverflow)?;
    
    // If user was already eligible (snapshot initialized), add to eligible stake
    if user_stake.snapshot_initialized {
        staking_pool.current_epoch_eligible_stake = staking_pool.current_epoch_eligible_stake
            .checked_add(amount)
            .ok_or(LendingError::MathOverflow)?;
    }
    
    // Transfer tokens to vault
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.staking_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;
    
    msg!(
        "Staked {} tokens. User total: {}. Pool total: {}. Start epoch: {}. Eligible: {}",
        amount,
        user_stake.staked_amount,
        staking_pool.total_staked,
        user_stake.stake_start_epoch,
        user_stake.snapshot_initialized
    );
    
    Ok(())
}