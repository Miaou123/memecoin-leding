use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::Token;
use crate::state::*;
use crate::error::LendingError;
use crate::utils::*;

/// Admin control context (pause/resume/update admin)
#[derive(Accounts)]
pub struct AdminControl<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_STATE_SEED],
        bump = protocol_state.bump,
        constraint = protocol_state.admin == admin.key() @ LendingError::Unauthorized
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    pub admin: Signer<'info>,
}

/// Withdraw treasury context
#[derive(Accounts)]
pub struct WithdrawTreasury<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_STATE_SEED],
        bump = protocol_state.bump,
        constraint = protocol_state.admin == admin.key() @ LendingError::Unauthorized
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump
    )]
    pub treasury: SystemAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Emergency drain context
#[derive(Accounts)]
pub struct EmergencyDrain<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_STATE_SEED],
        bump = protocol_state.bump,
        constraint = protocol_state.admin == admin.key() @ LendingError::Unauthorized
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump
    )]
    pub treasury: SystemAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// Token accounts to drain (variable)
    /// In practice, this would be passed as remaining_accounts
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Pause protocol operations
pub fn pause_handler(ctx: Context<AdminControl>) -> Result<()> {
    let protocol_state = &mut ctx.accounts.protocol_state;
    
    protocol_state.paused = true;
    
    msg!("Protocol paused by admin: {}", ctx.accounts.admin.key());
    
    Ok(())
}

/// Resume protocol operations
pub fn resume_handler(ctx: Context<AdminControl>) -> Result<()> {
    let protocol_state = &mut ctx.accounts.protocol_state;
    
    protocol_state.paused = false;
    
    msg!("Protocol resumed by admin: {}", ctx.accounts.admin.key());
    
    Ok(())
}

/// Update protocol admin
pub fn update_admin_handler(ctx: Context<AdminControl>, new_admin: Pubkey) -> Result<()> {
    let protocol_state = &mut ctx.accounts.protocol_state;
    
    // Validate new admin address
    if new_admin == Pubkey::default() {
        return Err(LendingError::InvalidAdminAddress.into());
    }
    
    let old_admin = protocol_state.admin;
    protocol_state.admin = new_admin;
    
    msg!("Admin updated from {} to {}", old_admin, new_admin);
    
    Ok(())
}

/// Withdraw SOL from treasury
pub fn withdraw_treasury_handler(ctx: Context<WithdrawTreasury>, amount: u64) -> Result<()> {
    let protocol_state = &mut ctx.accounts.protocol_state;
    
    // Check treasury has sufficient balance
    let treasury_balance = ctx.accounts.treasury.lamports();
    if treasury_balance < amount {
        return Err(LendingError::InsufficientTreasuryBalance.into());
    }

    // Ensure we don't withdraw funds needed for active loans
    // In a production system, you'd track reserved funds separately
    let reserved_for_loans = protocol_state.total_sol_borrowed;
    let available_balance = SafeMath::sub(treasury_balance, reserved_for_loans)?;
    
    if amount > available_balance {
        return Err(LendingError::InsufficientTreasuryBalance.into());
    }

    // Transfer SOL from treasury to admin using CPI with PDA signer
    let treasury_bump = ctx.bumps.treasury;
    let treasury_seeds: &[&[u8]] = &[TREASURY_SEED, &[treasury_bump]];
    let treasury_signer_seeds = &[treasury_seeds];

    system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.treasury.to_account_info(),
                to: ctx.accounts.admin.to_account_info(),
            },
            treasury_signer_seeds,
        ),
        amount,
    )?;

    // Treasury balance is tracked by the actual lamport balance of the treasury account
    // No need to track it separately in protocol_state
    
    msg!("Treasury withdrawal: {} SOL to admin {}", amount, ctx.accounts.admin.key());
    
    Ok(())
}

/// Update wallet addresses (admin only)
pub fn update_wallets_handler(
    ctx: Context<AdminControl>,
    new_admin: Option<Pubkey>,
    new_buyback_wallet: Option<Pubkey>,
    new_operations_wallet: Option<Pubkey>,
) -> Result<()> {
    let protocol_state = &mut ctx.accounts.protocol_state;
    
    if let Some(admin) = new_admin {
        if admin == Pubkey::default() {
            return Err(LendingError::InvalidAdminAddress.into());
        }
        protocol_state.admin = admin;
        msg!("Admin updated to: {}", admin);
    }
    
    if let Some(buyback) = new_buyback_wallet {
        protocol_state.buyback_wallet = buyback;
        msg!("Buyback wallet updated to: {}", buyback);
    }
    
    if let Some(operations) = new_operations_wallet {
        protocol_state.operations_wallet = operations;
        msg!("Operations wallet updated to: {}", operations);
    }
    
    Ok(())
}

/// Update liquidation bonus percentage
pub fn update_liquidation_bonus_handler(
    ctx: Context<AdminControl>, 
    new_bonus_bps: u16
) -> Result<()> {
    let protocol_state = &mut ctx.accounts.protocol_state;
    
    // Validate liquidation bonus (max 20%)
    if new_bonus_bps > 2000 {
        return Err(LendingError::InvalidLiquidationBonus.into());
    }
    
    protocol_state.liquidation_bonus_bps = new_bonus_bps;
    
    msg!("Liquidation bonus updated to {} bps", new_bonus_bps);
    
    Ok(())
}

/// Emergency drain all funds (in case of critical vulnerability)
pub fn emergency_drain_handler(ctx: Context<EmergencyDrain>) -> Result<()> {
    let protocol_state = &mut ctx.accounts.protocol_state;
    
    // Set protocol to paused
    protocol_state.paused = true;
    
    // Transfer all SOL from treasury to admin using CPI with PDA signer
    let treasury_balance = ctx.accounts.treasury.lamports();
    if treasury_balance > 0 {
        let treasury_bump = ctx.bumps.treasury;
        let treasury_seeds: &[&[u8]] = &[TREASURY_SEED, &[treasury_bump]];
        let treasury_signer_seeds = &[treasury_seeds];

        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.treasury.to_account_info(),
                    to: ctx.accounts.admin.to_account_info(),
                },
                treasury_signer_seeds,
            ),
            treasury_balance,
        )?;
    }

    // Reset protocol state tracking
    protocol_state.total_sol_borrowed = 0;
    protocol_state.total_fees_earned = 0;
    
    msg!("EMERGENCY DRAIN: {} SOL drained to admin {}", treasury_balance, ctx.accounts.admin.key());
    
    // Note: In a production emergency drain, you would also want to:
    // 1. Drain all token vaults (passed via remaining_accounts)
    // 2. Emit detailed emergency events
    // 3. Have multi-sig requirements
    // 4. Implement timelock delays
    
    Ok(())
}