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

/// Accept admin transfer context
#[derive(Accounts)]
pub struct AcceptAdminTransfer<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_STATE_SEED],
        bump = protocol_state.bump,
        constraint = protocol_state.pending_admin == new_admin.key() @ LendingError::Unauthorized
    )]
    pub protocol_state: Account<'info, ProtocolState>,
    
    pub new_admin: Signer<'info>,
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
    
    
    Ok(())
}

/// Resume protocol operations
pub fn resume_handler(ctx: Context<AdminControl>) -> Result<()> {
    let protocol_state = &mut ctx.accounts.protocol_state;
    
    protocol_state.paused = false;
    
    
    Ok(())
}


/// Initiate admin transfer (starts 48h timelock)
pub fn initiate_admin_transfer_handler(ctx: Context<AdminControl>, new_admin: Pubkey) -> Result<()> {
    let protocol_state = &mut ctx.accounts.protocol_state;
    let clock = Clock::get()?;
    
    require!(new_admin != Pubkey::default(), LendingError::InvalidAdminAddress);
    require!(new_admin != protocol_state.admin, LendingError::InvalidAdminAddress);
    
    protocol_state.pending_admin = new_admin;
    protocol_state.admin_transfer_timestamp = clock.unix_timestamp;
    
    
    Ok(())
}

/// Accept admin transfer (after timelock expires)
pub fn accept_admin_transfer_handler(ctx: Context<AcceptAdminTransfer>) -> Result<()> {
    let protocol_state = &mut ctx.accounts.protocol_state;
    let clock = Clock::get()?;
    
    let time_elapsed = clock.unix_timestamp - protocol_state.admin_transfer_timestamp;
    require!(time_elapsed >= ADMIN_TRANSFER_DELAY, LendingError::AdminTransferTooEarly);
    
    let _old_admin = protocol_state.admin;
    protocol_state.admin = protocol_state.pending_admin;
    protocol_state.pending_admin = Pubkey::default();
    protocol_state.admin_transfer_timestamp = 0;
    
    
    Ok(())
}

/// Cancel pending admin transfer (current admin only)
pub fn cancel_admin_transfer_handler(ctx: Context<AdminControl>) -> Result<()> {
    let protocol_state = &mut ctx.accounts.protocol_state;
    
    require!(protocol_state.pending_admin != Pubkey::default(), LendingError::NoPendingAdminTransfer);
    
    protocol_state.pending_admin = Pubkey::default();
    protocol_state.admin_transfer_timestamp = 0;
    
    
    Ok(())
}

/// Update authorized liquidator context
#[derive(Accounts)]
pub struct UpdateLiquidator<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_STATE_SEED],
        bump = protocol_state.bump,
        constraint = protocol_state.admin == admin.key() @ LendingError::Unauthorized
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    pub admin: Signer<'info>,
}

/// Update authorized liquidator (admin only)
pub fn update_liquidator_handler(
    ctx: Context<UpdateLiquidator>,
    new_liquidator: Pubkey,
) -> Result<()> {
    require!(
        new_liquidator != Pubkey::default(),
        LendingError::InvalidLiquidatorAddress
    );
    
    ctx.accounts.protocol_state.authorized_liquidator = new_liquidator;
    
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
    
    
    Ok(())
}

/// Update wallet addresses (admin only)
pub fn update_wallets_handler(
    ctx: Context<AdminControl>,
    new_buyback_wallet: Option<Pubkey>,
    new_operations_wallet: Option<Pubkey>,
) -> Result<()> {
    let protocol_state = &mut ctx.accounts.protocol_state;
    
    if let Some(buyback) = new_buyback_wallet {
        protocol_state.buyback_wallet = buyback;
    }
    
    if let Some(operations) = new_operations_wallet {
        protocol_state.operations_wallet = operations;
    }
    
    Ok(())
}


/// Blacklist/unblacklist token context
#[derive(Accounts)]
pub struct BlacklistToken<'info> {
    #[account(
        seeds = [PROTOCOL_STATE_SEED],
        bump = protocol_state.bump,
        constraint = protocol_state.admin == admin.key() @ LendingError::Unauthorized
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    #[account(
        mut,
        seeds = [TOKEN_CONFIG_SEED, token_config.mint.as_ref()],
        bump = token_config.bump
    )]
    pub token_config: Account<'info, TokenConfig>,

    pub admin: Signer<'info>,
}

/// Blacklist a token (admin only) - blocks new loans
pub fn blacklist_token_handler(ctx: Context<BlacklistToken>) -> Result<()> {
    ctx.accounts.token_config.blacklisted = true;
    Ok(())
}

/// Remove token from blacklist (admin only)
pub fn unblacklist_token_handler(ctx: Context<BlacklistToken>) -> Result<()> {
    ctx.accounts.token_config.blacklisted = false;
    Ok(())
}

/// Update price authority context
#[derive(Accounts)]
pub struct UpdatePriceAuthority<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_STATE_SEED],
        bump = protocol_state.bump,
        constraint = protocol_state.admin == admin.key() @ LendingError::Unauthorized
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    pub admin: Signer<'info>,
}

/// Update price authority (admin only)
pub fn update_price_authority_handler(
    ctx: Context<UpdatePriceAuthority>,
    new_price_authority: Pubkey,
) -> Result<()> {
    require!(
        new_price_authority != Pubkey::default(),
        LendingError::InvalidPriceAuthority
    );
    
    ctx.accounts.protocol_state.price_authority = new_price_authority;
    
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
    
    
    // Note: In a production emergency drain, you would also want to:
    // 1. Drain all token vaults (passed via remaining_accounts)
    // 2. Emit detailed emergency events
    // 3. Have multi-sig requirements
    // 4. Implement timelock delays
    
    Ok(())
}