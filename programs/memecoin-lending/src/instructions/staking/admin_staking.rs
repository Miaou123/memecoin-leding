use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::LendingError;

// === Pause Staking ===

#[derive(Accounts)]
pub struct PauseStaking<'info> {
    #[account(
        mut,
        seeds = [STAKING_POOL_SEED],
        bump = staking_pool.bump,
        has_one = authority @ LendingError::Unauthorized
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    pub authority: Signer<'info>,
}

pub fn pause_staking_handler(ctx: Context<PauseStaking>) -> Result<()> {
    ctx.accounts.staking_pool.paused = true;
    msg!("Staking paused by admin");
    Ok(())
}

pub fn resume_staking_handler(ctx: Context<PauseStaking>) -> Result<()> {
    ctx.accounts.staking_pool.paused = false;
    msg!("Staking resumed by admin");
    Ok(())
}

// === Update Epoch Duration ===

#[derive(Accounts)]
pub struct UpdateEpochDuration<'info> {
    #[account(
        mut,
        seeds = [STAKING_POOL_SEED],
        bump = staking_pool.bump,
        has_one = authority @ LendingError::Unauthorized
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    pub authority: Signer<'info>,
}

pub fn update_epoch_duration_handler(ctx: Context<UpdateEpochDuration>, new_duration: i64) -> Result<()> {
    require!(new_duration >= 60, LendingError::InvalidEpochDuration); // Min 1 minute
    require!(new_duration <= 604800, LendingError::InvalidEpochDuration); // Max 1 week
    
    ctx.accounts.staking_pool.epoch_duration = new_duration;
    msg!("Epoch duration updated to {} seconds", new_duration);
    Ok(())
}

// === Force Advance Epoch ===

#[derive(Accounts)]
pub struct ForceAdvanceEpoch<'info> {
    #[account(
        mut,
        seeds = [STAKING_POOL_SEED],
        bump = staking_pool.bump,
        has_one = authority @ LendingError::Unauthorized
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    pub authority: Signer<'info>,
}

pub fn force_advance_epoch_handler(ctx: Context<ForceAdvanceEpoch>) -> Result<()> {
    let pool = &mut ctx.accounts.staking_pool;
    let clock = Clock::get()?;
    
    pool.current_epoch = pool.current_epoch.checked_add(1).ok_or(LendingError::MathOverflow)?;
    pool.epoch_start_time = clock.unix_timestamp;
    pool.total_epochs_completed = pool.total_epochs_completed.checked_add(1).ok_or(LendingError::MathOverflow)?;
    pool.current_epoch_eligible_stake = pool.total_staked;
    pool.current_epoch_rewards = 0;
    
    msg!("Force advanced to epoch {} by admin", pool.current_epoch);
    Ok(())
}

// === Emergency Withdraw ===

#[derive(Accounts)]
pub struct EmergencyWithdraw<'info> {
    #[account(
        mut,
        seeds = [STAKING_POOL_SEED],
        bump = staking_pool.bump,
        has_one = authority @ LendingError::Unauthorized
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    #[account(
        mut,
        seeds = [REWARD_VAULT_SEED],
        bump
    )]
    pub reward_vault: SystemAccount<'info>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn emergency_withdraw_handler(ctx: Context<EmergencyWithdraw>) -> Result<()> {
    let vault_balance = ctx.accounts.reward_vault.lamports();
    
    require!(vault_balance > 0, LendingError::InsufficientRewardBalance);
    
    // Pause staking during emergency
    ctx.accounts.staking_pool.paused = true;
    
    // Leave minimum rent-exempt balance
    let rent = Rent::get()?;
    let min_balance = rent.minimum_balance(0);
    let drain_amount = vault_balance.saturating_sub(min_balance);
    
    if drain_amount == 0 {
        msg!("No SOL to withdraw (only rent-exempt balance remains)");
        return Ok(());
    }
    
    // Transfer SOL from reward vault to admin
    **ctx.accounts.reward_vault.to_account_info().try_borrow_mut_lamports()? -= drain_amount;
    **ctx.accounts.authority.to_account_info().try_borrow_mut_lamports()? += drain_amount;
    
    msg!("Emergency withdraw: {} lamports to admin. Staking paused.", drain_amount);
    Ok(())
}