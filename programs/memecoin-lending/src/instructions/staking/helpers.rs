use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::LendingError;
use crate::utils::SafeMath;

/// Calculate current reward per token based on time elapsed and emission rate
pub fn calculate_reward_per_token(
    pool: &StakingPool,
    reward_vault_balance: u64,
    current_time: i64,
) -> Result<u128> {
    if pool.total_staked == 0 {
        return Ok(pool.reward_per_token_stored);
    }
    
    let time_elapsed = (current_time - pool.last_update_time).max(0) as u64;
    if time_elapsed == 0 {
        return Ok(pool.reward_per_token_stored);
    }
    
    let emission_rate = calculate_emission_rate(pool, reward_vault_balance);
    let rewards_to_distribute = SafeMath::mul(emission_rate, time_elapsed)?;
    
    let reward_increment = SafeMath::mul_div_u128(
        rewards_to_distribute as u128,
        REWARD_PRECISION,
        pool.total_staked as u128,
    )?;
    
    Ok(SafeMath::add_u128(pool.reward_per_token_stored, reward_increment)?)
}

/// Calculate emission rate based on reward vault balance
pub fn calculate_emission_rate(pool: &StakingPool, reward_vault_balance: u64) -> u64 {
    if pool.target_pool_balance == 0 {
        return pool.base_emission_rate;
    }
    
    let emission = (pool.base_emission_rate as u128)
        .saturating_mul(reward_vault_balance as u128)
        .saturating_div(pool.target_pool_balance as u128) as u64;
    
    emission.clamp(pool.min_emission_rate, pool.max_emission_rate)
}

/// Calculate pending rewards for a user
pub fn calculate_pending_rewards(user_stake: &UserStake, current_reward_per_token: u128) -> Result<u64> {
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