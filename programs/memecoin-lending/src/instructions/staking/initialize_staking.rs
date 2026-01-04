use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::*;
use crate::error::LendingError;

#[derive(Accounts)]
pub struct InitializeStaking<'info> {
    #[account(
        init,
        payer = authority,
        space = StakingPool::LEN,
        seeds = [STAKING_POOL_SEED],
        bump
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    pub staking_token_mint: Account<'info, Mint>,
    
    /// CHECK: PDA for staking vault authority
    #[account(
        seeds = [STAKING_VAULT_SEED],
        bump
    )]
    pub staking_vault_authority: AccountInfo<'info>,
    
    #[account(
        init,
        payer = authority,
        associated_token::mint = staking_token_mint,
        associated_token::authority = staking_vault_authority,
    )]
    pub staking_vault: Account<'info, TokenAccount>,
    
    /// CHECK: PDA for reward vault (holds SOL)
    #[account(
        mut,
        seeds = [REWARD_VAULT_SEED],
        bump
    )]
    pub reward_vault: SystemAccount<'info>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_staking_handler(
    ctx: Context<InitializeStaking>,
    epoch_duration: i64,
) -> Result<()> {
    require!(epoch_duration >= 60, LendingError::InvalidEpochDuration); // Min 1 minute
    require!(epoch_duration <= 604800, LendingError::InvalidEpochDuration); // Max 1 week
    
    let clock = Clock::get()?;
    let staking_pool = &mut ctx.accounts.staking_pool;
    
    // Basic config
    staking_pool.authority = ctx.accounts.authority.key();
    staking_pool.staking_token_mint = ctx.accounts.staking_token_mint.key();
    staking_pool.staking_vault = ctx.accounts.staking_vault.key();
    staking_pool.reward_vault = ctx.accounts.reward_vault.key();
    
    // Epoch config
    staking_pool.current_epoch = 1;
    staking_pool.epoch_duration = epoch_duration;
    staking_pool.epoch_start_time = clock.unix_timestamp;
    
    // Staking state
    staking_pool.total_staked = 0;
    staking_pool.current_epoch_eligible_stake = 0;
    
    // Current epoch rewards
    staking_pool.current_epoch_rewards = 0;
    
    // Last epoch distribution tracking
    staking_pool.last_epoch_rewards = 0;
    staking_pool.last_epoch_eligible_stake = 0;
    staking_pool.last_epoch_distributed = 0;
    
    // Stats
    staking_pool.total_rewards_distributed = 0;
    staking_pool.total_rewards_deposited = 0;
    staking_pool.total_epochs_completed = 0;
    
    // Flags
    staking_pool.paused = false;
    staking_pool.bump = ctx.bumps.staking_pool;
    
    msg!(
        "Initialized staking pool. Token: {}. Epoch duration: {}s. Direct distribution mode.",
        staking_pool.staking_token_mint,
        epoch_duration
    );
    
    Ok(())
}