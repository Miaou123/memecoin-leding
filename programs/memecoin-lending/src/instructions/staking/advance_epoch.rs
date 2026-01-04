use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::LendingError;

#[derive(Accounts)]
pub struct AdvanceEpoch<'info> {
    #[account(
        mut,
        seeds = [STAKING_POOL_SEED],
        bump = staking_pool.bump
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    // Anyone can call - permissionless
    pub caller: Signer<'info>,
}

/// Advance to next epoch - anyone can call when time has passed
/// This moves current_epoch_rewards to last_epoch_rewards for distribution
pub fn advance_epoch_handler(ctx: Context<AdvanceEpoch>) -> Result<()> {
    let clock = Clock::get()?;
    let pool = &mut ctx.accounts.staking_pool;
    
    // Check if epoch should advance
    let epoch_end_time = pool.epoch_start_time + pool.epoch_duration;
    require!(
        clock.unix_timestamp >= epoch_end_time,
        LendingError::EpochNotEnded
    );
    
    // Note: We no longer block epoch advancement based on distribution status
    // This allows epochs to continue even if the vault is empty
    // Any undistributed rewards are effectively forfeited when we advance
    
    // Log any undistributed rewards being forfeited
    let forfeited = pool.last_epoch_rewards.saturating_sub(pool.last_epoch_distributed);
    if forfeited > 0 {
        msg!(
            "⚠️ Advancing epoch with {} lamports undistributed (forfeited)",
            forfeited
        );
    }
    
    // Move current epoch data to last_epoch for distribution
    pool.last_epoch_rewards = pool.current_epoch_rewards;
    pool.last_epoch_eligible_stake = pool.current_epoch_eligible_stake;
    pool.last_epoch_distributed = 0;
    
    // Advance to next epoch
    let old_epoch = pool.current_epoch;
    pool.current_epoch = pool.current_epoch
        .checked_add(1)
        .ok_or(LendingError::MathOverflow)?;
    pool.epoch_start_time = epoch_end_time; // Start from when last epoch ended
    pool.total_epochs_completed = pool.total_epochs_completed
        .checked_add(1)
        .ok_or(LendingError::MathOverflow)?;
    
    // Reset current epoch counters
    pool.current_epoch_rewards = 0;
    pool.current_epoch_eligible_stake = pool.total_staked; // All stakers now eligible
    
    msg!(
        "Advanced from epoch {} to {}. Rewards to distribute: {} lamports to {} eligible stake",
        old_epoch,
        pool.current_epoch,
        pool.last_epoch_rewards,
        pool.last_epoch_eligible_stake
    );
    
    Ok(())
}