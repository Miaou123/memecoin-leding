use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::error::LendingError;
use crate::utils::SafeMath;

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
        constraint = staking_vault.key() == staking_pool.staking_vault
    )]
    pub staking_vault: Account<'info, TokenAccount>,
    
    /// CHECK: Vault authority PDA
    #[account(
        seeds = [STAKING_VAULT_SEED],
        bump
    )]
    pub staking_vault_authority: AccountInfo<'info>,
    
    #[account(
        mut,
        constraint = user_token_account.owner == user.key(),
        constraint = user_token_account.mint == staking_pool.staking_token_mint
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(
        seeds = [REWARD_VAULT_SEED],
        bump
    )]
    pub reward_vault: SystemAccount<'info>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}

pub fn unstake_handler(ctx: Context<Unstake>, amount: u64) -> Result<()> {
    let user_stake = &ctx.accounts.user_stake;
    require!(amount > 0, LendingError::InvalidLoanAmount);
    require!(user_stake.staked_amount >= amount, LendingError::InsufficientStakeBalance);
    
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
    
    // Update user pending rewards
    let pending = calculate_pending_rewards(user_stake, current_reward_per_token)?;
    user_stake.pending_rewards = SafeMath::add(user_stake.pending_rewards, pending)?;
    user_stake.reward_per_token_paid = current_reward_per_token;
    
    // Update balances
    user_stake.staked_amount = SafeMath::sub(user_stake.staked_amount, amount)?;
    staking_pool.total_staked = SafeMath::sub(staking_pool.total_staked, amount)?;
    
    // Transfer tokens back to user
    let vault_bump = ctx.bumps.staking_vault_authority;
    let vault_seeds = &[STAKING_VAULT_SEED, &[vault_bump]];
    let signer = &[&vault_seeds[..]];
    
    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.staking_vault.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.staking_vault_authority.to_account_info(),
        },
        signer,
    );
    token::transfer(transfer_ctx, amount)?;
    
    msg!("Unstaked {} tokens. Remaining: {}", amount, user_stake.staked_amount);
    
    Ok(())
}

// Include the same helper functions as in stake.rs
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