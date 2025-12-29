use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::LendingError;

#[derive(Accounts)]
pub struct UpdateStakingConfig<'info> {
    #[account(
        mut,
        seeds = [STAKING_POOL_SEED],
        bump = staking_pool.bump,
        constraint = staking_pool.authority == authority.key() @ LendingError::Unauthorized
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    pub authority: Signer<'info>,
}

pub fn update_staking_config_handler(
    ctx: Context<UpdateStakingConfig>,
    target_pool_balance: Option<u64>,
    base_emission_rate: Option<u64>,
    max_emission_rate: Option<u64>,
    min_emission_rate: Option<u64>,
    paused: Option<bool>,
) -> Result<()> {
    let staking_pool = &mut ctx.accounts.staking_pool;
    
    if let Some(target) = target_pool_balance {
        staking_pool.target_pool_balance = target;
        msg!("Updated target pool balance to: {}", target);
    }
    
    if let Some(base_rate) = base_emission_rate {
        staking_pool.base_emission_rate = base_rate;
        msg!("Updated base emission rate to: {}", base_rate);
    }
    
    if let Some(max_rate) = max_emission_rate {
        require!(max_rate >= staking_pool.min_emission_rate, LendingError::InvalidFeeConfiguration);
        staking_pool.max_emission_rate = max_rate;
        msg!("Updated max emission rate to: {}", max_rate);
    }
    
    if let Some(min_rate) = min_emission_rate {
        require!(min_rate <= staking_pool.max_emission_rate, LendingError::InvalidFeeConfiguration);
        staking_pool.min_emission_rate = min_rate;
        msg!("Updated min emission rate to: {}", min_rate);
    }
    
    if let Some(pause_state) = paused {
        staking_pool.paused = pause_state;
        msg!("Staking pool paused: {}", pause_state);
    }
    
    Ok(())
}