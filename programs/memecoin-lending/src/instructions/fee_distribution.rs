use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::LendingError;
use crate::utils::SafeMath;

pub const BPS_DIVISOR: u64 = 10000;

#[derive(Accounts)]
pub struct InitializeFeeReceiver<'info> {
    #[account(
        init,
        payer = authority,
        space = FeeReceiver::LEN,
        seeds = [FEE_RECEIVER_SEED],
        bump
    )]
    pub fee_receiver: Account<'info, FeeReceiver>,
    
    /// CHECK: Treasury wallet
    pub treasury_wallet: AccountInfo<'info>,
    
    /// CHECK: Dev wallet
    pub dev_wallet: AccountInfo<'info>,
    
    #[account(
        seeds = [REWARD_VAULT_SEED],
        bump
    )]
    pub staking_reward_vault: SystemAccount<'info>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn initialize_fee_receiver_handler(
    ctx: Context<InitializeFeeReceiver>,
    treasury_split_bps: u16,
    staking_split_bps: u16,
    dev_split_bps: u16,
) -> Result<()> {
    require!(
        treasury_split_bps + staking_split_bps + dev_split_bps == 10000,
        LendingError::InvalidFeeSplit
    );
    
    let fee_receiver = &mut ctx.accounts.fee_receiver;
    
    fee_receiver.authority = ctx.accounts.authority.key();
    fee_receiver.treasury_wallet = ctx.accounts.treasury_wallet.key();
    fee_receiver.dev_wallet = ctx.accounts.dev_wallet.key();
    fee_receiver.staking_reward_vault = ctx.accounts.staking_reward_vault.key();
    fee_receiver.treasury_split_bps = treasury_split_bps;
    fee_receiver.staking_split_bps = staking_split_bps;
    fee_receiver.dev_split_bps = dev_split_bps;
    fee_receiver.total_fees_received = 0;
    fee_receiver.total_fees_distributed = 0;
    fee_receiver.bump = ctx.bumps.fee_receiver;
    
    msg!("Fee receiver initialized: treasury={}%, staking={}%, dev={}%",
         treasury_split_bps / 100,
         staking_split_bps / 100,
         dev_split_bps / 100);
    
    Ok(())
}

#[derive(Accounts)]
pub struct DistributeCreatorFees<'info> {
    #[account(
        mut,
        seeds = [FEE_RECEIVER_SEED],
        bump = fee_receiver.bump
    )]
    pub fee_receiver: Account<'info, FeeReceiver>,
    
    /// CHECK: Treasury receives 50%
    #[account(
        mut,
        constraint = treasury_wallet.key() == fee_receiver.treasury_wallet
    )]
    pub treasury_wallet: AccountInfo<'info>,
    
    /// CHECK: Dev receives 25%
    #[account(
        mut,
        constraint = dev_wallet.key() == fee_receiver.dev_wallet
    )]
    pub dev_wallet: AccountInfo<'info>,
    
    /// Staking rewards receive 25%
    #[account(
        mut,
        constraint = staking_reward_vault.key() == fee_receiver.staking_reward_vault
    )]
    pub staking_reward_vault: SystemAccount<'info>,
    
    /// Anyone can call this to distribute accumulated fees
    pub caller: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn distribute_creator_fees_handler(ctx: Context<DistributeCreatorFees>) -> Result<()> {
    let fee_receiver = &mut ctx.accounts.fee_receiver;
    
    // Get current balance of fee receiver PDA
    let fee_receiver_info = fee_receiver.to_account_info();
    let current_balance = fee_receiver_info.lamports();
    
    // Keep rent-exempt minimum
    let rent = Rent::get()?;
    let min_balance = rent.minimum_balance(FeeReceiver::LEN);
    
    let distributable = current_balance.saturating_sub(min_balance);
    require!(distributable > 0, LendingError::InsufficientTreasuryBalance);
    
    // Calculate splits
    let treasury_amount = SafeMath::mul_div(
        distributable,
        fee_receiver.treasury_split_bps as u64,
        BPS_DIVISOR,
    )?;
    let staking_amount = SafeMath::mul_div(
        distributable,
        fee_receiver.staking_split_bps as u64,
        BPS_DIVISOR,
    )?;
    let dev_amount = distributable
        .saturating_sub(treasury_amount)
        .saturating_sub(staking_amount);
    
    // Transfer to treasury (50%)
    **fee_receiver_info.try_borrow_mut_lamports()? -= treasury_amount;
    **ctx.accounts.treasury_wallet.try_borrow_mut_lamports()? += treasury_amount;
    
    // Transfer to staking rewards (25%)
    **fee_receiver_info.try_borrow_mut_lamports()? -= staking_amount;
    **ctx.accounts.staking_reward_vault.try_borrow_mut_lamports()? += staking_amount;
    
    // Transfer to dev (25%)
    **fee_receiver_info.try_borrow_mut_lamports()? -= dev_amount;
    **ctx.accounts.dev_wallet.try_borrow_mut_lamports()? += dev_amount;
    
    // Update stats
    fee_receiver.total_fees_distributed = SafeMath::add(
        fee_receiver.total_fees_distributed,
        distributable,
    )?;
    
    msg!(
        "Distributed {} lamports: treasury={}, staking={}, dev={}",
        distributable,
        treasury_amount,
        staking_amount,
        dev_amount
    );
    
    Ok(())
}