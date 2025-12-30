use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::*;

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
    
    /// The governance token mint
    pub staking_token_mint: Account<'info, Mint>,
    
    /// PDA vault to hold staked tokens
    #[account(
        init,
        payer = authority,
        associated_token::mint = staking_token_mint,
        associated_token::authority = staking_vault_authority,
    )]
    pub staking_vault: Account<'info, TokenAccount>,
    
    /// CHECK: PDA authority for staking vault
    #[account(
        seeds = [STAKING_VAULT_SEED],
        bump
    )]
    pub staking_vault_authority: AccountInfo<'info>,
    
    /// PDA to hold SOL rewards
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
    target_pool_balance: u64,
    base_emission_rate: u64,
    max_emission_rate: u64,
    min_emission_rate: u64,
) -> Result<()> {
    let staking_pool = &mut ctx.accounts.staking_pool;
    let clock = Clock::get()?;
    
    staking_pool.authority = ctx.accounts.authority.key();
    staking_pool.staking_token_mint = ctx.accounts.staking_token_mint.key();
    staking_pool.staking_vault = ctx.accounts.staking_vault.key();
    staking_pool.reward_vault = ctx.accounts.reward_vault.key();
    staking_pool.total_staked = 0;
    staking_pool.reward_per_token_stored = 0;
    staking_pool.last_update_time = clock.unix_timestamp;
    staking_pool.target_pool_balance = target_pool_balance;
    staking_pool.base_emission_rate = base_emission_rate;
    staking_pool.max_emission_rate = max_emission_rate;
    staking_pool.min_emission_rate = min_emission_rate;
    staking_pool.total_rewards_distributed = 0;
    staking_pool.total_rewards_deposited = 0;
    staking_pool.paused = false;
    staking_pool.bump = ctx.bumps.staking_pool;
    
    msg!("Staking pool initialized for mint: {}", staking_pool.staking_token_mint);
    msg!("Target balance: {} lamports, Base rate: {} lamports/sec", 
         target_pool_balance, base_emission_rate);
    
    Ok(())
}