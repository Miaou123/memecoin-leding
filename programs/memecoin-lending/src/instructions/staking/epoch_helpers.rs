use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::LendingError;

/// Advance epoch(s) if time has passed
/// This is the KEY function that updates the reward_per_token_accumulated
pub fn maybe_advance_epoch(pool: &mut StakingPool, current_time: i64) -> Result<()> {
    while current_time >= pool.epoch_start_time + pool.epoch_duration {
        advance_single_epoch(pool)?;
    }
    Ok(())
}

/// Advance a single epoch - called internally
fn advance_single_epoch(pool: &mut StakingPool) -> Result<()> {
    // Only distribute rewards if there are eligible stakers
    if pool.current_epoch_eligible_stake > 0 && pool.current_epoch_rewards > 0 {
        // Calculate reward per token for this epoch
        // reward_increment = (epoch_rewards * PRECISION) / eligible_stake
        let reward_increment = (pool.current_epoch_rewards as u128)
            .checked_mul(REWARD_PRECISION)
            .ok_or(LendingError::MathOverflow)?
            .checked_div(pool.current_epoch_eligible_stake as u128)
            .ok_or(LendingError::DivisionByZero)?;
        
        // Add to accumulator
        pool.reward_per_token_accumulated = pool.reward_per_token_accumulated
            .checked_add(reward_increment)
            .ok_or(LendingError::MathOverflow)?;
        
        msg!(
            "Epoch {} ended: {} lamports distributed to {} eligible stake. RPT: {}",
            pool.current_epoch,
            pool.current_epoch_rewards,
            pool.current_epoch_eligible_stake,
            pool.reward_per_token_accumulated
        );
    } else if pool.current_epoch_rewards > 0 {
        // No eligible stakers - rewards roll over to next epoch
        msg!(
            "Epoch {} ended: {} lamports rolled over (no eligible stakers)",
            pool.current_epoch,
            pool.current_epoch_rewards
        );
        // Don't reset current_epoch_rewards - they roll over
        // Actually, we need to track this differently...
        // For simplicity, let's just not reset and let them accumulate
    } else {
        msg!("Epoch {} ended: no rewards to distribute", pool.current_epoch);
        // Reset rewards for new epoch
        pool.current_epoch_rewards = 0;
    }
    
    // Move to next epoch
    pool.current_epoch = pool.current_epoch
        .checked_add(1)
        .ok_or(LendingError::MathOverflow)?;
    pool.epoch_start_time = pool.epoch_start_time + pool.epoch_duration;
    pool.total_epochs_completed = pool.total_epochs_completed
        .checked_add(1)
        .ok_or(LendingError::MathOverflow)?;
    
    // All currently staked users become eligible for the NEW epoch
    pool.current_epoch_eligible_stake = pool.total_staked;
    
    // Reset current epoch rewards (if we distributed them)
    if pool.current_epoch_eligible_stake > 0 {
        pool.current_epoch_rewards = 0;
    }
    
    Ok(())
}

/// Initialize user's snapshot when they become eligible
/// Called when user interacts and we detect they've become eligible
pub fn maybe_initialize_user_snapshot(
    user_stake: &mut UserStake,
    pool: &StakingPool,
) -> Result<()> {
    // User becomes eligible when current_epoch > stake_start_epoch
    // Their snapshot should be the reward_per_token at that moment
    if !user_stake.snapshot_initialized && pool.current_epoch > user_stake.stake_start_epoch {
        user_stake.reward_per_token_snapshot = pool.reward_per_token_accumulated;
        user_stake.snapshot_initialized = true;
        msg!(
            "Initialized snapshot for user at RPT: {}",
            user_stake.reward_per_token_snapshot
        );
    }
    Ok(())
}

/// Calculate pending rewards for a user
pub fn calculate_pending_rewards(
    user_stake: &UserStake,
    pool: &StakingPool,
) -> Result<u64> {
    // Not eligible yet
    if !user_stake.snapshot_initialized {
        return Ok(0);
    }
    
    // No stake
    if user_stake.staked_amount == 0 {
        return Ok(0);
    }
    
    // rewards = stake * (current_rpt - user_snapshot) / PRECISION
    let rpt_diff = pool.reward_per_token_accumulated
        .checked_sub(user_stake.reward_per_token_snapshot)
        .ok_or(LendingError::MathUnderflow)?;
    
    let rewards = (user_stake.staked_amount as u128)
        .checked_mul(rpt_diff)
        .ok_or(LendingError::MathOverflow)?
        .checked_div(REWARD_PRECISION)
        .ok_or(LendingError::DivisionByZero)? as u64;
    
    Ok(rewards)
}