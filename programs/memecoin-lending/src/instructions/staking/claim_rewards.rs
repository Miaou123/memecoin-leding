use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::LendingError;
use crate::utils::SafeMath;

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
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
        seeds = [REWARD_VAULT_SEED],
        bump
    )]
    pub reward_vault: SystemAccount<'info>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn claim_rewards_handler(ctx: Context<ClaimRewards>) -> Result<()> {
    let clock = Clock::get()?;
    let staking_pool = &mut ctx.accounts.staking_pool;
    let user_stake = &mut ctx.accounts.user_stake;
    let reward_vault_balance = ctx.accounts.reward_vault.lamports();
    
    // Update global state
    let current_reward_per_token = calculate_reward_per_token(
        staking_pool,
        reward_vault_balance,
        clock.unix_timestamp,
    )?;
    staking_pool.reward_per_token_stored = current_reward_per_token;
    staking_pool.last_update_time = clock.unix_timestamp;
    
    // Calculate total rewards
    let new_rewards = calculate_pending_rewards(user_stake, current_reward_per_token)?;
    let total_rewards = SafeMath::add(user_stake.pending_rewards, new_rewards)?;
    
    require!(total_rewards > 0, LendingError::NoRewardsToClaim);
    require!(
        ctx.accounts.reward_vault.lamports() >= total_rewards,
        LendingError::InsufficientRewardBalance
    );
    
    // Reset user rewards
    user_stake.pending_rewards = 0;
    user_stake.reward_per_token_paid = current_reward_per_token;
    
    // Update pool stats
    staking_pool.total_rewards_distributed = SafeMath::add(
        staking_pool.total_rewards_distributed,
        total_rewards,
    )?;
    
    // Transfer SOL rewards to user
    **ctx.accounts.reward_vault.to_account_info().try_borrow_mut_lamports()? -= total_rewards;
    **ctx.accounts.user.to_account_info().try_borrow_mut_lamports()? += total_rewards;
    
    msg!("Claimed {} lamports in rewards", total_rewards);
    
    Ok(())
}

// Include helper functions (same as stake.rs)
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