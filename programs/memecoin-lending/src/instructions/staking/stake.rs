use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::error::LendingError;
use crate::utils::SafeMath;

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
        constraint = staking_vault.key() == staking_pool.staking_vault
    )]
    pub staking_vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = user_token_account.owner == user.key(),
        constraint = user_token_account.mint == staking_pool.staking_token_mint
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    /// Reward vault for calculating current emission
    #[account(
        seeds = [REWARD_VAULT_SEED],
        bump
    )]
    pub reward_vault: SystemAccount<'info>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn stake_handler(ctx: Context<Stake>, amount: u64) -> Result<()> {
    require!(amount > 0, LendingError::InvalidLoanAmount);
    
    let clock = Clock::get()?;
    let staking_pool = &mut ctx.accounts.staking_pool;
    let user_stake = &mut ctx.accounts.user_stake;
    let reward_vault_balance = ctx.accounts.reward_vault.lamports();
    
    // Update global reward state
    let current_reward_per_token = calculate_reward_per_token(
        staking_pool,
        reward_vault_balance,
        clock.unix_timestamp,
    )?;
    staking_pool.reward_per_token_stored = current_reward_per_token;
    staking_pool.last_update_time = clock.unix_timestamp;
    
    // Update user rewards before changing stake
    if user_stake.staked_amount > 0 {
        let pending = calculate_pending_rewards(user_stake, current_reward_per_token)?;
        user_stake.pending_rewards = SafeMath::add(user_stake.pending_rewards, pending)?;
    }
    
    // Initialize user stake if new
    if user_stake.owner == Pubkey::default() {
        user_stake.owner = ctx.accounts.user.key();
        user_stake.pool = staking_pool.key();
        user_stake.stake_timestamp = clock.unix_timestamp;
        user_stake.bump = ctx.bumps.user_stake;
    }
    
    // Update user state
    user_stake.staked_amount = SafeMath::add(user_stake.staked_amount, amount)?;
    user_stake.reward_per_token_paid = current_reward_per_token;
    
    // Update pool total
    staking_pool.total_staked = SafeMath::add(staking_pool.total_staked, amount)?;
    
    // Transfer tokens to vault
    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.staking_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        },
    );
    token::transfer(transfer_ctx, amount)?;
    
    msg!("Staked {} tokens. Total staked: {}", amount, staking_pool.total_staked);
    
    Ok(())
}

/// Calculate current reward per token based on time elapsed and emission rate
fn calculate_reward_per_token(
    pool: &StakingPool,
    reward_vault_balance: u64,
    current_time: i64,
) -> Result<u128> {
    if pool.total_staked == 0 {
        return Ok(pool.reward_per_token_stored);
    }
    
    let time_elapsed = (current_time - pool.last_update_time) as u64;
    if time_elapsed == 0 {
        return Ok(pool.reward_per_token_stored);
    }
    
    // Calculate dynamic emission rate based on pool balance
    let emission_rate = calculate_emission_rate(pool, reward_vault_balance);
    
    // rewards_to_distribute = emission_rate * time_elapsed
    let rewards_to_distribute = SafeMath::mul(emission_rate, time_elapsed)?;
    
    // reward_per_token_increment = (rewards * PRECISION) / total_staked
    let reward_increment = SafeMath::mul_div_u128(
        rewards_to_distribute as u128,
        REWARD_PRECISION,
        pool.total_staked as u128,
    )?;
    
    Ok(SafeMath::add_u128(pool.reward_per_token_stored, reward_increment)?)
}

/// Calculate emission rate based on reward vault balance
fn calculate_emission_rate(pool: &StakingPool, reward_vault_balance: u64) -> u64 {
    if pool.target_pool_balance == 0 {
        return pool.base_emission_rate;
    }
    
    // ratio = vault_balance / target_balance
    // emission = base_rate * ratio
    let emission = (pool.base_emission_rate as u128)
        .saturating_mul(reward_vault_balance as u128)
        .saturating_div(pool.target_pool_balance as u128) as u64;
    
    // Clamp to min/max
    emission.clamp(pool.min_emission_rate, pool.max_emission_rate)
}

/// Calculate pending rewards for a user
fn calculate_pending_rewards(user_stake: &UserStake, current_reward_per_token: u128) -> Result<u64> {
    let reward_diff = current_reward_per_token
        .checked_sub(user_stake.reward_per_token_paid)
        .ok_or(LendingError::MathUnderflow)?;
    
    let rewards = (user_stake.staked_amount as u128)
        .checked_mul(reward_diff)
        .ok_or(LendingError::MathOverflow)?
        .checked_div(REWARD_PRECISION)
        .ok_or(LendingError::DivisionByZero)? as u64;
    
    Ok(rewards)
}