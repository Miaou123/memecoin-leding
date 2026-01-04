use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::LendingError;
use super::epoch_helpers::{maybe_advance_epoch, maybe_initialize_user_snapshot, calculate_pending_rewards};

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
    
    // Auto-advance epoch if needed (distributes pending rewards)
    maybe_advance_epoch(staking_pool, clock.unix_timestamp)?;
    
    // Initialize snapshot if user just became eligible
    maybe_initialize_user_snapshot(user_stake, staking_pool)?;
    
    // Calculate pending rewards using the accumulator
    let pending_rewards = calculate_pending_rewards(user_stake, staking_pool)?;
    
    if pending_rewards == 0 {
        msg!("No rewards to claim. Eligible: {}", user_stake.snapshot_initialized);
        return Ok(());
    }
    
    // Verify vault has enough balance
    let vault_balance = ctx.accounts.reward_vault.lamports();
    let claimable = pending_rewards.min(vault_balance);
    
    require!(claimable > 0, LendingError::InsufficientRewardBalance);
    
    // Update user's snapshot to current (they've now "claimed up to" current RPT)
    user_stake.reward_per_token_snapshot = staking_pool.reward_per_token_accumulated;
    user_stake.last_claimed_epoch = staking_pool.current_epoch;
    user_stake.total_rewards_claimed = user_stake.total_rewards_claimed
        .checked_add(claimable)
        .ok_or(LendingError::MathOverflow)?;
    
    // Update pool stats
    staking_pool.total_rewards_distributed = staking_pool.total_rewards_distributed
        .checked_add(claimable)
        .ok_or(LendingError::MathOverflow)?;
    
    // Transfer SOL rewards to user
    **ctx.accounts.reward_vault.to_account_info().try_borrow_mut_lamports()? -= claimable;
    **ctx.accounts.user.to_account_info().try_borrow_mut_lamports()? += claimable;
    
    msg!(
        "Claimed {} lamports. User snapshot updated to RPT: {}. Total claimed: {}",
        claimable,
        user_stake.reward_per_token_snapshot,
        user_stake.total_rewards_claimed
    );
    
    Ok(())
}