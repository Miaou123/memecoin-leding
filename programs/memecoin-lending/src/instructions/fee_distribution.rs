use anchor_lang::prelude::*;
use crate::state::*;
use crate::error::LendingError;
use crate::utils::SafeMath;
use crate::utils::BPS_DIVISOR;

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
    
    /// CHECK: Treasury wallet (receives 40%)
    pub treasury_wallet: AccountInfo<'info>,
    
    /// CHECK: Operations wallet (receives 20%) - RENAMED from dev_wallet
    pub operations_wallet: AccountInfo<'info>,
    
    /// Staking reward vault (receives 40%)
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
    operations_split_bps: u16,
) -> Result<()> {
    // Validate splits sum to 100%
    require!(
        treasury_split_bps as u32 + staking_split_bps as u32 + operations_split_bps as u32 == 10000,
        LendingError::InvalidFeeSplit
    );
    
    let fee_receiver = &mut ctx.accounts.fee_receiver;
    
    fee_receiver.authority = ctx.accounts.authority.key();
    fee_receiver.treasury_wallet = ctx.accounts.treasury_wallet.key();
    fee_receiver.operations_wallet = ctx.accounts.operations_wallet.key(); // RENAMED
    fee_receiver.staking_reward_vault = ctx.accounts.staking_reward_vault.key();
    fee_receiver.treasury_split_bps = treasury_split_bps;
    fee_receiver.staking_split_bps = staking_split_bps;
    fee_receiver.operations_split_bps = operations_split_bps;
    fee_receiver.total_fees_received = 0;
    fee_receiver.total_fees_distributed = 0;
    fee_receiver.bump = ctx.bumps.fee_receiver;
    
    msg!("Fee receiver initialized (staker-focused split):");
    msg!("  Treasury:   {}%", treasury_split_bps / 100);
    msg!("  Staking:    {}%", staking_split_bps / 100);
    msg!("  Operations: {}%", operations_split_bps / 100);
    
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
    
    /// CHECK: Treasury receives configured % (default 40%)
    #[account(
        mut,
        constraint = treasury_wallet.key() == fee_receiver.treasury_wallet @ LendingError::Unauthorized
    )]
    pub treasury_wallet: AccountInfo<'info>,
    
    /// CHECK: Operations receives configured % (default 20%) - RENAMED
    #[account(
        mut,
        constraint = operations_wallet.key() == fee_receiver.operations_wallet @ LendingError::Unauthorized
    )]
    pub operations_wallet: AccountInfo<'info>,
    
    /// Staking rewards receive configured % (default 40%)
    #[account(
        mut,
        constraint = staking_reward_vault.key() == fee_receiver.staking_reward_vault @ LendingError::Unauthorized
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
    
    // Calculate splits based on configured percentages
    // Default: Treasury 40%, Staking 40%, Operations 20%
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
    
    // Operations gets remainder to avoid rounding issues
    let operations_amount = distributable
        .saturating_sub(treasury_amount)
        .saturating_sub(staking_amount);
    
    // Transfer to treasury (40%)
    **fee_receiver_info.try_borrow_mut_lamports()? -= treasury_amount;
    **ctx.accounts.treasury_wallet.try_borrow_mut_lamports()? += treasury_amount;
    
    // Transfer to staking rewards (40%)
    **fee_receiver_info.try_borrow_mut_lamports()? -= staking_amount;
    **ctx.accounts.staking_reward_vault.try_borrow_mut_lamports()? += staking_amount;
    
    // Transfer to operations (20%)
    **fee_receiver_info.try_borrow_mut_lamports()? -= operations_amount;
    **ctx.accounts.operations_wallet.try_borrow_mut_lamports()? += operations_amount;
    
    // Update stats
    fee_receiver.total_fees_distributed = SafeMath::add(
        fee_receiver.total_fees_distributed,
        distributable,
    )?;
    
    msg!(
        "Distributed {} lamports from creator fees (staker-focused):",
        distributable
    );
    msg!("  Treasury ({}%):   {} lamports", fee_receiver.treasury_split_bps / 100, treasury_amount);
    msg!("  Staking ({}%):    {} lamports", fee_receiver.staking_split_bps / 100, staking_amount);
    msg!("  Operations ({}%): {} lamports", fee_receiver.operations_split_bps / 100, operations_amount);
    
    Ok(())
}